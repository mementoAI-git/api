import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongodb } from '../module/database/connection';
import File from '../module/database/model/file';
import { 
  getVideoProcessingAvailability,
  createUploadedVideoThumbnailArtifact 
} from '../services/storage/video-processing';
import { logger } from '../utils';

async function runVerification() {
  logger.info('Starting Thumbnail Extraction Verification...');
  
  try {
    await connectMongodb();
    logger.info('MongoDB connected');
    
    const available = await getVideoProcessingAvailability();
    logger.info(`FFmpeg/FFprobe availability: ${available}`);
    
    if (!available) {
      logger.warn('Video processing is NOT available (ffmpeg/ffprobe missing).');
    }

    // Try to find the specific video file from the logs or any recent video file
    let file = await File.findOne({ name: '6be6mc688pzwgrmk_260815014313.mp4' });
    
    if (!file) {
      logger.info('Specific file not found, looking for any recent video file...');
      file = await File.findOne({ type: { $regex: '^video/' } }).sort({ created_at: -1 });
    }

    if (!file) {
      logger.error('No video files found in the database to test extraction against.');
      process.exit(1);
    }
    
    logger.info(`Found video file for testing: ${file.name} (Provider: ${file.provider || 's3'})`);

    if (available) {
      logger.info('Attempting to create uploaded video thumbnail artifact...');
      
      const artifact = await createUploadedVideoThumbnailArtifact({
        name: file.name,
        provider: file.provider,
        type: file.type || 'video/mp4'
      });
      
      logger.info('Extraction Success! Artifact metadata:');
      console.log(JSON.stringify(artifact, null, 2));
    }
    
  } catch (error) {
    logger.error({ err: error }, 'Verification encountered an error');
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from DB. Verification finished.');
  }
}

runVerification().catch(console.error);
