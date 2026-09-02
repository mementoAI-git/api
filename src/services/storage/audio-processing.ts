import {rm} from 'fs/promises';
import type {FileStorageProvider} from '../../module/database/model/file';
import {uploadToS3} from './s3';
import {resolvePublicFileUrl} from './public-url';
import {downloadToTempFile, extFromFileName} from './video-processing';
import {logger} from '../../utils';

export interface AudioThumbnailArtifactResult {
  duration: number | null;
  thumbnailKey: string | null;
  thumbnailUrl: string | null;
}

export async function createUploadedAudioThumbnailArtifact(file: {
  name: string;
  provider?: FileStorageProvider;
  type: string;
}): Promise<AudioThumbnailArtifactResult> {
  const sourceExt = extFromFileName(file.name, '.mp3');
  const inputPath = await downloadToTempFile(
    {
      key: file.name,
      provider: file.provider ?? 's3',
      mimeType: file.type,
    },
    sourceExt,
  );

  let duration: number | null = null;
  let thumbnailKey: string | null = null;
  let thumbnailUrl: string | null = null;

  try {
    const mm = await import('music-metadata');
    const metadata = await mm.parseFile(inputPath);

    if (metadata.format.duration) {
      duration = Number(metadata.format.duration);
    }

    const cover = mm.selectCover(metadata.common.picture);
    if (cover?.data && cover.data.length > 0) {
      const outputKey = `thumbnails/${file.name.replace(/\.[^.]+$/, '')}.jpg`;
      const upload = await uploadToS3(
        outputKey,
        Buffer.from(cover.data),
        'image/jpeg',
      );

      thumbnailKey = outputKey;
      thumbnailUrl = resolvePublicFileUrl(outputKey, upload.location);
    }

    return {
      duration,
      thumbnailKey,
      thumbnailUrl,
    };
  } catch (err) {
    logger.warn(
      {file: file.name, err},
      'Audio thumbnail/metadata extraction failed',
    );
    return {
      duration: null,
      thumbnailKey: null,
      thumbnailUrl: null,
    };
  } finally {
    await rm(inputPath, {force: true}).catch(err => {
      logger.error({inputPath, err}, 'Failed to remove audio temp input file');
    });
  }
}
