import mongoose from 'mongoose';
import { MONGODB_URL } from '../../utils/config';
import logger from '../../utils/logger';

export function connectMongodb() {
  mongoose.set('strictQuery', false);
  mongoose
    .connect(MONGODB_URL as string, { autoIndex: false })
    .then(() => logger.info('MongoDB connected successfully...'))
    .catch(err => logger.error(err, 'MongoDB Error just occured'));
}

export const connection = mongoose.connection;

export default mongoose;
