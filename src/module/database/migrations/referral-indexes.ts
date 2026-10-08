import 'dotenv/config';
import mongoose from 'mongoose';
import {connectMongodb} from '../connection';
import User from '../model/user';

async function run() {
  await connectMongodb();
  try {
    await User.collection.createIndex(
      {referral_code: 1},
      {unique: true, sparse: true, name: 'referral_code_1'},
    );
    await User.collection.createIndex(
      {referred_by: 1},
      {name: 'referred_by_1'},
    );
    console.log('Referral indexes ready');
  } finally {
    await mongoose.disconnect();
  }
}
void run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
