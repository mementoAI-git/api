import {body, param} from 'express-validator';
import {OAUTH_PROVIDERS} from '../../../utils/constant';

const providerValidator = param('provider')
  .notEmpty()
  .withMessage('Provider is required')
  .isIn(Object.keys(OAUTH_PROVIDERS))
  .withMessage('Provider is not supported');

export const emailValidator = body('email')
  .notEmpty()
  .withMessage('Email address is required')
  .isEmail()
  .withMessage('Invalid email address')
  .toLowerCase();

export default {
  generateOauthUrl: providerValidator,
  authorization: [
    providerValidator,
    body('code').optional().isString(),
    body('id_token').optional().isString(),
    body().custom(body => {
      if (!body.code && !body.id_token) {
        throw new Error('Either authorization code or id_token is required');
      }
      return true;
    }),
    body('user')
      .optional()
      .custom(value => typeof value === 'string' || typeof value === 'object')
      .withMessage('Invalid Apple user data'),
  ],
  login: [
    emailValidator,
    body('password').notEmpty().withMessage('Password is required'),
    body('remember_for_30_days').optional().default(false).toBoolean(),
  ],
  register: [
    emailValidator,
    body('first_name').notEmpty().withMessage('First name is required'),
    body('last_name').notEmpty().withMessage('Last name is required'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isLength({min: 6})
      .withMessage('Password must be at least 6 characters'),
    body('delivery')
      .optional()
      .isIn(['link', 'code'])
      .withMessage('Invalid delivery format'),
  ],
  sendLink: [
    emailValidator,
    body('type')
      .notEmpty()
      .withMessage('Link type is required')
      .default('reset')
      .isIn(['reset', 'verify'])
      .withMessage('Invalid request type'),
    body('delivery')
      .optional()
      .isIn(['reset', 'verify', 'link', 'code'])
      .withMessage('Invalid delivery format'),
  ],
  verifyEmail: [
    body('token')
      .notEmpty()
      .withMessage('Verification code is required')
      .custom(
        value =>
          /^\d{6}$/.test(String(value).trim()) ||
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            String(value).trim(),
          ),
      )
      .withMessage('Invalid token or code'),
    body('email')
      .optional()
      .isEmail()
      .withMessage('Invalid email address')
      .toLowerCase(),
    body('type')
      .optional()
      .isIn(['verify', 'reset'])
      .withMessage('Invalid type'),
  ],
  setPassword: [
    body('token')
      .notEmpty()
      .withMessage('Verification code is required')
      .custom(
        value =>
          /^\d{6}$/.test(String(value).trim()) ||
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            String(value).trim(),
          ),
      )
      .withMessage('Invalid token or code'),
    body('email')
      .optional()
      .isEmail()
      .withMessage('Invalid email address')
      .toLowerCase(),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isStrongPassword()
      .withMessage('Password must be strong'),
  ],
  refreshToken: [
    body('refresh_token').notEmpty().withMessage('Refresh token is required'),
  ],
  sendInviteCode: body('email')
    .optional({nullable: true})
    .default(null)
    .isEmail()
    .withMessage('Invalid email address')
    .toLowerCase(),
  verify2FALogin: [
    body('two_fa_token')
      .notEmpty()
      .withMessage('2FA session token is required'),
    body('code')
      .notEmpty()
      .withMessage('2FA code is required')
      .isLength({min: 6, max: 6})
      .withMessage('Code must be 6 digits'),
  ],
  completePasskeyRegistration: [
    body('response').notEmpty().withMessage('WebAuthn response is required'),
    body('device_name').optional().isString(),
  ],
  completePasskeyLogin: [
    body('challenge_id').notEmpty().withMessage('Challenge ID is required'),
    body('response').notEmpty().withMessage('WebAuthn response is required'),
  ],
};
