import 'dotenv/config';
import {
  connectMongodb,
  default as mongoose,
} from '../module/database/connection';
import StaffAccount from '../module/database/model/staff-account';
import StaffSession from '../module/database/model/staff-session';
import StaffAudit from '../module/database/model/staff-audit';
import {provisionStaff} from '../module/api/staff/provision';

async function main() {
  // Read secrets through stdin, never argv (process listings) or terminal output.
  if (process.stdin.isTTY)
    throw new Error(
      'Pipe provisioning JSON from a secure source into stdin. See agents/staff-console.md.',
    );
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 8192)
      throw new Error('Provisioning input is too large');
  }
  const data: unknown = JSON.parse(input);
  await connectMongodb();
  // Production uses autoIndex:false; provisioning must enforce unique identities.
  await Promise.all([
    StaffAccount.createIndexes(),
    StaffSession.createIndexes(),
    StaffAudit.createIndexes(),
  ]);
  await provisionStaff(data);
  process.stdout.write(
    'Staff account updated. No customer account was modified.\n',
  );
}
main()
  .catch(() => {
    // Driver errors can contain document values; never print provisioning errors verbatim.
    process.stderr.write(
      'Staff provisioning failed. Check input, enrollment code, configuration and database connectivity.\n',
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
