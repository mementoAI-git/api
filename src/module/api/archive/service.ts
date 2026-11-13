import {ZipArchive} from 'archiver';
import {type Readable} from 'stream';
import {createReadStream, createWriteStream} from 'fs';
import {mkdtemp, rm, stat} from 'fs/promises';
import {tmpdir} from 'os';
import {join} from 'path';
import ArchiveExport from '../../database/model/archive-export';
import Capsule from '../../database/model/capsule';
import File from '../../database/model/file';
import Memory from '../../database/model/memory';
import User from '../../database/model/user';
import {NotFoundException} from '../../../utils/service-error';
import * as storage from '../../../services/storage';
import {generatePresignedUrl, uploadToS3} from '../../../services/storage/s3';
import {queueArchiveExport} from '../../../services/queues/system';
import mail from '../../mail';

const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

export async function createArchiveExport(userId: string) {
  const existing = await ArchiveExport.findOne({
    user_id: userId,
    status: {$in: ['pending', 'processing']},
  }).sort({created_at: -1});
  const job =
    existing ??
    (await ArchiveExport.create({
      user_id: userId,
      status: 'pending',
      expires_at: new Date(Date.now() + EXPORT_TTL_MS),
    }));
  await queueArchiveExport(job.id);
  return {message: 'Archive export queued', data: publicExport(job)};
}

/** Queue an archive whose download link is emailed to the owner when ready. */
export async function requestArchiveExportByEmail(userId: string) {
  const job = await ArchiveExport.create({
    user_id: userId,
    status: 'pending',
    email_on_complete: true,
    expires_at: new Date(Date.now() + EXPORT_TTL_MS),
  });
  await queueArchiveExport(job.id);
  return job.id as string;
}

export async function getArchiveExport(userId: string, exportId: string) {
  const job = await ArchiveExport.findOne({_id: exportId, user_id: userId});
  if (!job) throw new NotFoundException('Archive export not found');
  return {message: 'Archive export fetched', data: publicExport(job)};
}

export async function getArchiveDownload(userId: string, exportId: string) {
  const job = await ArchiveExport.findOne({
    _id: exportId,
    user_id: userId,
    status: 'complete',
    expires_at: {$gt: new Date()},
  }).select('+object_key');
  if (!job?.object_key) throw new NotFoundException('Archive is not ready');
  return {
    message: 'Archive download ready',
    data: {
      url: await generatePresignedUrl(job.object_key, 15 * 60),
      filename: `memento-archive-${exportId}.zip`,
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    },
  };
}

function publicExport(job: InstanceType<typeof ArchiveExport>) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    warnings: job.warnings,
    error: job.error,
    expires_at: job.expires_at,
  };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'attachment';
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function buildArchiveExport(exportId: string): Promise<void> {
  const job = await ArchiveExport.findById(exportId);
  if (!job || job.status === 'complete') return;
  await job.updateOne({$set: {status: 'processing', error: null}});
  let temporaryDirectory: string | null = null;
  try {
    const [user, stories, capsules] = await Promise.all([
      User.findById(job.user_id)
        .select('email first_name last_name nickname')
        .lean(),
      Memory.find({user: job.user_id, type: 'story', status: {$ne: 'deleted'}})
        .sort({created_at: 1})
        .lean(),
      Capsule.find({user: job.user_id}).sort({created_at: 1}).lean(),
    ]);
    if (!user) throw new NotFoundException('Archive owner not found');
    const attachmentIds = [
      ...stories.flatMap(story => story.attachments ?? []),
      ...capsules.flatMap(capsule => capsule.attachments ?? []),
    ].map(String);
    const files = await File.find({
      _id: {$in: [...new Set(attachmentIds)]},
      user: job.user_id,
      deleted: {$ne: true},
    }).lean();
    const warnings: string[] = [];
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'memento-archive-'));
    const archivePath = join(temporaryDirectory, `${job.id}.zip`);
    const output = createWriteStream(archivePath);
    const finished = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
    });
    const archive = new ZipArchive({zlib: {level: 6}});
    archive.on('warning', error => warnings.push(error.message));
    archive.on('error', error => output.destroy(error));
    archive.pipe(output);

    const manifest = {
      version: 1,
      exported_at: new Date().toISOString(),
      owner: {
        id: job.user_id,
        email: user.email,
        name: [user.first_name, user.last_name].filter(Boolean).join(' '),
      },
      stories,
      capsules,
      attachments: files.map(file => ({
        id: String(file._id),
        name: file.name,
        type: file.type,
        size: file.size,
      })),
    };
    archive.append(JSON.stringify(manifest, null, 2), {name: 'manifest.json'});
    stories.forEach((story, index) =>
      archive.append(JSON.stringify(story, null, 2), {
        name: `stories/${String(index + 1).padStart(4, '0')}-${story._id}.json`,
      }),
    );
    capsules.forEach((capsule, index) =>
      archive.append(JSON.stringify(capsule, null, 2), {
        name: `capsules/${String(index + 1).padStart(4, '0')}-${capsule._id}.json`,
      }),
    );
    archive.append(
      `<!doctype html><html><head><meta charset="utf-8"><title>Memento Archive</title></head><body><h1>Memento Archive</h1><p>${stories.length} stories · ${capsules.length} capsules</p>${stories
        .map(
          story =>
            `<article><h2>${htmlEscape(story.title || 'Untitled')}</h2>${story.body || ''}</article>`,
        )
        .join('')}</body></html>`,
      {name: 'index.html'},
    );

    let exportedAttachments = 0;
    for (const file of files) {
      try {
        const response = await storage.getFile(
          file.name,
          undefined,
          file.provider,
          file.type,
        );
        archive.append(response.Body as Readable, {
          name: `attachments/${String(file._id)}-${safeName(file.name)}`,
        });
        exportedAttachments += 1;
      } catch {
        warnings.push(`Attachment ${file._id} could not be included.`);
      }
    }
    const missingCount = new Set(attachmentIds).size - files.length;
    if (missingCount > 0) {
      warnings.push(`${missingCount} attachment record(s) were unavailable.`);
    }
    await job.updateOne({
      $set: {
        progress: {
          stories_total: stories.length,
          stories_exported: stories.length,
          capsules_total: capsules.length,
          capsules_exported: capsules.length,
          attachments_total: new Set(attachmentIds).size,
          attachments_exported: exportedAttachments,
        },
      },
    });
    await archive.finalize();
    await finished;
    const objectKey = `exports/${job.user_id}/${job.id}.zip`;
    const archiveSize = (await stat(archivePath)).size;
    await uploadToS3(
      objectKey,
      createReadStream(archivePath),
      'application/zip',
      {user_id: job.user_id, export_id: job.id},
      'primary',
      archiveSize,
    );
    const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
    await job.updateOne({
      $set: {
        status: 'complete',
        object_key: objectKey,
        warnings,
        expires_at: expiresAt,
      },
    });
    if (job.email_on_complete && user.email) {
      // The owner is signed out (account deletion), so the link is pre-signed
      // for the archive's lifetime instead of going through the app.
      await mail.sendArchiveExport({
        email: user.email,
        name: user.first_name || user.nickname || '',
        url: await generatePresignedUrl(objectKey, EXPORT_TTL_MS / 1000),
        expires_at: expiresAt,
      });
    }
  } catch (error) {
    await job.updateOne({
      $set: {
        status: 'failed',
        error: (error instanceof Error ? error.message : String(error)).slice(
          0,
          500,
        ),
      },
    });
    throw error;
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, {recursive: true, force: true});
    }
  }
}
