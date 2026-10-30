import {Router} from 'express';
import {requireStaff, staffBoundary} from '../../../middleware/staff';
import rateLimiter from '../../../middleware/rate-limiter';
import * as operations from './operations-controller';
import * as auth from './controller';
import * as flags from '../feature-flag/controller';
import * as valid from './validator';
const router = Router();
router.use(staffBoundary);
router.post(
  '/login',
  rateLimiter(15, 30, 'staff-login:'),
  valid.validate(valid.loginSchema),
  auth.login,
);
router.get('/session', requireStaff(), auth.session);
router.post('/logout', requireStaff(), auth.logout);
router.get('/metrics', requireStaff('operations:read'), operations.metrics);
router.get('/operations', requireStaff('operations:read'), operations.summary);
router.get(
  '/accounts',
  requireStaff('accounts:read'),
  valid.validate(valid.accountListSchema, 'query'),
  operations.accounts,
);
router.get(
  '/accounts/:id',
  requireStaff('accounts:read'),
  valid.validateAccountId,
  operations.account,
);
const read = requireStaff('flags:read');
const write = requireStaff('flags:write');
router.get(
  '/feature-flags',
  read,
  valid.validate(valid.listSchema, 'query'),
  flags.listFlags,
);
router.get('/feature-flags/:key', read, valid.validateParams, flags.getFlag);
router.get(
  '/feature-flags/:key/audit',
  read,
  valid.validateParams,
  valid.validate(valid.listSchema.pick({limit: true}), 'query'),
  flags.audit,
);
router.put(
  '/feature-flags/:key/default',
  write,
  valid.validateParams,
  valid.validate(valid.valueSchema),
  flags.updateDefault,
);
router.put(
  '/feature-flags/:key/overrides/:scopeType/:scopeId',
  write,
  valid.validateParams,
  valid.validate(valid.overrideSchema),
  flags.upsertOverride,
);
router.delete(
  '/feature-flags/:key/overrides/:scopeType/:scopeId',
  write,
  valid.validateParams,
  valid.validate(valid.deleteSchema),
  flags.removeOverride,
);
router.put(
  '/feature-flags/:key/rollout/:scopeType/:scopeId',
  write,
  valid.validateParams,
  valid.validate(valid.rolloutSchema),
  flags.updateRollout,
);
router.post(
  '/feature-flags/bulk',
  write,
  valid.validate(valid.bulkSchema),
  flags.bulk,
);
export default router;
