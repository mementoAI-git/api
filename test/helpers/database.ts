import mongoose from 'mongoose';
import {MongoMemoryReplSet, MongoMemoryServer} from 'mongodb-memory-server';

let mongoServer: MongoMemoryServer | null = null;
let replicaSet: MongoMemoryReplSet | null = null;

export async function connectTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), {autoIndex: true});
}

export async function connectTestReplicaSet(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  replicaSet = await MongoMemoryReplSet.create({
    replSet: {count: 1, storageEngine: 'wiredTiger'},
  });
  await mongoose.connect(replicaSet.getUri(), {autoIndex: true});
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
}

export async function clearTestDatabase(): Promise<void> {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map(collection => collection.deleteMany({})));
}

export async function closeTestDatabase(): Promise<void> {
  await mongoose.disconnect();
  await mongoServer?.stop();
  await replicaSet?.stop();
  mongoServer = null;
  replicaSet = null;
}
