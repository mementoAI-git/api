import {body, param} from 'express-validator';

const installationId = param('installationId')
  .isString()
  .trim()
  .isLength({min: 1, max: 200})
  .matches(/^[\x20-\x7e]+$/)
  .withMessage('Installation ID must be printable text');

export const registerPushDevice = [
  installationId,
  body('platform')
    .isIn(['ios', 'android', 'web'])
    .withMessage('Platform must be ios, android, or web'),
  body('push_token')
    .isString()
    .trim()
    .isLength({min: 1, max: 4096})
    .withMessage('Push token is required'),
];

export const disablePushDevice = [installationId];
