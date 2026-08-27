import mongoose from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';

let mongoServer: MongoMemoryServer | null = null;

export async function connectTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), {autoIndex: true});
}

export async function clearTestDatabase(): Promise<void> {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map(collection => collection.deleteMany({})));
}

export async function closeTestDatabase(): Promise<void> {
  await mongoose.disconnect();
  await mongoServer?.stop();
  mongoServer = null;
}
