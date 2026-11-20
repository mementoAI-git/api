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
    // A migration may load a module that opens Redis or a BullMQ queue (e.g. to
    // queue jobs); those handles keep Node alive and hang the deploy. Exit
    // explicitly once the work is done.
    process.exit(process.exitCode ?? 0); // eslint-disable-line n/no-process-exit
  });
