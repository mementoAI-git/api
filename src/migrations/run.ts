import {connectMongodb} from '../module/database/connection';
import {getMigrationStatus, migrateUp} from '.';

async function main(): Promise<void> {
  const command = process.argv[2] || 'up';
  await connectMongodb();

  if (command === 'up') {
    console.log(JSON.stringify(await migrateUp(), null, 2));
    return;
  }
  if (command === 'status') {
    console.log(JSON.stringify(await getMigrationStatus(), null, 2));
    return;
  }

  throw new Error(`Unknown migration command: ${command}`);
}

void main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const mongoose = await import('../module/database/connection');
    await mongoose.default.disconnect();
  });
