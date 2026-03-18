import mongoose from 'mongoose';
import { MONGODB_URL } from '../../utils/config';
import logger from '../../utils/logger';

async function migrateOnboardingStatus() {
  try {
    const db = mongoose.connection.db;
    if (!db) return;
    await db.collection('users').updateMany(
      { onboarding_status: { $exists: false }, onbaorded: true },
      { $set: { onboarding_status: 'completed' } }
    );
    await db.collection('users').updateMany(
      { onboarding_status: { $exists: false } },
      { $set: { onboarding_status: 'never' } }
    );
    await db.collection('users').updateMany({}, { $unset: { onbaorded: '' } });
    logger.info('User onboarding_status migration applied');
  } catch (e) {
    logger.warn(e, 'onboarding_status migration skipped or failed');
  }
}

export function connectMongodb() {
  mongoose.set('strictQuery', false);
  return mongoose
    .connect(MONGODB_URL as string, { autoIndex: false })
    .then(async () => {
      logger.info('MongoDB connected successfully...');
      await migrateOnboardingStatus();
    })
    .catch(err => {
      logger.error(err, 'MongoDB Error just occured');
      throw err;
    });
}

export const connection = mongoose.connection;

export default mongoose;
