import File from '../../module/database/model/file';
import {
  createUploadedVideoThumbnailArtifact,
  getVideoProcessingAvailability,
} from '../../services/storage/video-processing';
import {createUploadedAudioThumbnailArtifact} from '../../services/storage/audio-processing';
import {getVideoThumbnailUrl} from '../../services/storage/cloudinary';
import {logger} from '../../utils';

export default async function processAttachmentThumbnail(job: {
  data: {fileId: string};
}) {
  const {fileId} = job.data;
  const file = await File.findById(fileId);

  if (!file) {
    logger.warn({fileId}, 'Attachment thumbnail job skipped: file not found');
    return;
  }

  if (file.type?.startsWith('audio/')) {
    try {
      const artifact = await createUploadedAudioThumbnailArtifact({
        name: file.name,
        provider: file.provider,
        type: file.type,
      });
      await file.updateOne({
        thumbnail: artifact.thumbnailUrl ?? file.thumbnail ?? null,
        duration: file.duration ?? artifact.duration ?? undefined,
        status: 'ready',
      });
    } catch (error) {
      await file.updateOne({status: 'failed'});
      logger.error({fileId, err: error}, 'Audio thumbnail processing failed');
    }
    return;
  }

  if (!file.type?.startsWith('video/')) {
    await file.updateOne({status: 'ready'});
    return;
  }

  const processingAvailable = await getVideoProcessingAvailability();
  if (!processingAvailable) {
    const fileJson = file.toJSON() as {url?: string};
    const fallbackThumbnail = getVideoThumbnailUrl(fileJson.url || '');
    if (fallbackThumbnail) {
      await file.updateOne({thumbnail: fallbackThumbnail, status: 'ready'});
      logger.warn(
        {fileId},
        'Attachment thumbnail worker used Cloudinary fallback because ffmpeg/ffprobe are unavailable',
      );
      return;
    }

    await file.updateOne({status: 'failed', thumbnail: null});
    logger.warn(
      {fileId},
      'Attachment thumbnail job failed: ffmpeg/ffprobe runtime unavailable',
    );
    return;
  }

  try {
    const artifact = await createUploadedVideoThumbnailArtifact({
      name: file.name,
      provider: file.provider,
      type: file.type,
    });
    await file.updateOne({
      thumbnail: artifact.thumbnailUrl,
      width: artifact.width ?? undefined,
      height: artifact.height ?? undefined,
      duration: file.duration ?? artifact.duration ?? undefined,
      status: 'ready',
    });
  } catch (error) {
    const fileJson = file.toJSON() as {url?: string};
    const fallbackThumbnail = getVideoThumbnailUrl(fileJson.url || '');
    if (fallbackThumbnail) {
      await file.updateOne({thumbnail: fallbackThumbnail, status: 'ready'});
      logger.warn(
        {fileId, err: error},
        'Attachment thumbnail worker fell back to Cloudinary thumbnail after artifact generation failure',
      );
      return;
    }

    await file.updateOne({status: 'failed', thumbnail: null});
    logger.warn(
      {fileId, err: error},
      'Attachment thumbnail job failed during artifact generation',
    );
  }
}
