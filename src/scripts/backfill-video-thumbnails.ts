import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../module/database/connection';
import File from '../module/database/model/file';
import {queueAttachmentThumbnailProcessing} from '../services/queues/system';
import {logger} from '../utils';
import {EXCLUDED_STORAGE_PROVIDER} from '../utils/constant';
import readline from 'readline';

async function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve =>
    rl.question(query, ans => {
      rl.close();
      resolve(ans);
    }),
  );
}

async function runBackfill() {
  logger.info('Starting Video Thumbnail Backfill Script...');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const autoYes = args.includes('--yes') || args.includes('-y');

  try {
    await connectMongodb();
    logger.info('MongoDB connected');

    // Find active videos with missing thumbnails or stuck in processing status
    const videos = await File.find({
      type: {$regex: '^video/'},
      deleted: {$ne: true},
      provider: {$ne: EXCLUDED_STORAGE_PROVIDER},
      $or: [{thumbnail: null}, {thumbnail: ''}, {status: 'processing'}],
    });

    if (!videos || videos.length === 0) {
      logger.info('No videos found that require thumbnail backfilling.');
      return;
    }

    logger.info(`Found ${videos.length} videos requiring thumbnails.`);

    // Print a few examples
    const examples = videos.slice(0, 5).map(v => ({id: v.id, name: v.name}));
    logger.info({examples}, 'Sample videos to be backfilled:');

    if (!autoYes) {
      const answer = await askQuestion(
        '\nDo you want to queue these videos for background thumbnail generation via BullMQ? (y/N): ',
      );

      if (answer.toLowerCase() !== 'y') {
        logger.info('Aborting backfill operation.');
        return;
      }
    } else {
      logger.info('\nAuto-accepting via --yes flag.');
    }

    logger.info('Queueing jobs...');

    let queuedCount = 0;
    for (const video of videos) {
      const queued = await queueAttachmentThumbnailProcessing(video.id);
      if (queued) {
        queuedCount++;
      } else {
        logger.error({fileId: video.id}, 'Failed to enqueue job for video');
      }
    }

    logger.info(`Successfully queued ${queuedCount}/${videos.length} jobs.`);
    logger.info(
      'The background workers will begin processing these shortly. You can monitor progress on the BullMQ dashboard (/queues).',
    );
  } catch (error) {
    logger.error({err: error}, 'Backfill encountered an error');
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from DB. Script finished.');
    // eslint-disable-next-line n/no-process-exit
    process.exit(0);
  }
}

runBackfill().catch(console.error);
