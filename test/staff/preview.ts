// Disposable verification server: never connects to the application's configured DB.
import '../setup';
import express from 'express';
import speakeasy from 'speakeasy';
import {connectTestDatabase, closeTestDatabase} from '../helpers/database';
import routes from '../../src/module/api/staff/routes';
import errorHandler from '../../src/middleware/error-handler';
import {provisionStaff} from '../../src/module/api/staff/provision';
import StaffAccount from '../../src/module/database/model/staff-account';
import {createUserFixture} from '../helpers/factories';
import Subscription from '../../src/module/database/model/subscription';
import Usage from '../../src/module/database/model/usage';
import {FeatureDefinition} from '../../src/module/database/model/feature-flag';
async function main() {
  process.env.STAFF_ORIGIN = 'http://localhost:5174';
  process.env.STAFF_TOTP_KEY = 'a'.repeat(64);
  await connectTestDatabase();
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  await provisionStaff({
    operation: 'create',
    email: 'operator@example.com',
    password: 'a long test-only staff password',
    totpSecret: secret,
    code: speakeasy.totp({secret, encoding: 'base32'}),
    permissions: [
      'flags:read',
      'flags:write',
      'accounts:read',
      'operations:read',
    ],
  });
  await StaffAccount.updateOne({}, {$set: {last_totp_step: -1}});
  await FeatureDefinition.create([
    {
      key: 'memory.create',
      domain: 'memory',
      description: 'Create and preserve a new memory.',
      default_value: true,
    },
    {
      key: 'billing.checkout',
      domain: 'billing',
      description: 'Start a subscription checkout.',
      default_value: false,
    },
    {
      key: 'chat.voice',
      domain: 'chat',
      description: 'Talk with Memento using your voice.',
      default_value: true,
    },
  ]);
  const customer = await createUserFixture({
    email: 'customer@example.com',
    first_name: 'Alex',
    last_name: 'Morgan',
    onboarding_status: 'completed',
  });
  await Subscription.create({
    user_id: String(customer._id),
    tier: 'pro',
    status: 'past_due',
    payment_provider: 'apple',
    current_period_end: new Date(Date.now() + 86400000),
  });
  await Usage.create({
    user_id: String(customer._id),
    storage_used_bytes: 128000000,
    storage_reserved_bytes: 32000000,
  });
  const app = express();
  app.use(express.json());
  app.use('/staff', routes);
  app.use(errorHandler);
  const server = app.listen(5014, '127.0.0.1', () =>
    process.stdout.write('Disposable staff verification API ready on 5014\n'),
  );
  const stop = () => server.close(() => void closeTestDatabase());
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
void main();
