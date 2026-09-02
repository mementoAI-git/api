import {body, query} from 'express-validator';
import {isValidObjectId} from 'mongoose';

function isRecipient(value: unknown): boolean {
  if (typeof value === 'string') {
    return isValidObjectId(value) || /^\S+@\S+\.\S+$/.test(value);
  }
  if (!value || typeof value !== 'object') return false;
  const recipient = value as {beneficiary_id?: unknown; email?: unknown};
  return Boolean(
    (typeof recipient.beneficiary_id === 'string' &&
      isValidObjectId(recipient.beneficiary_id)) ||
      (typeof recipient.email === 'string' &&
        /^\S+@\S+\.\S+$/.test(recipient.email)),
  );
}

export default {
  createCapsule: [
    body('recipients').optional().isArray().withMessage('Invalid recipients'),
    body('recipients.*')
      .optional()
      .custom(isRecipient)
      .withMessage('Invalid recipient'),
    body('title').optional().isString().isLength({max: 300}),
    body('body').optional().isString().isLength({max: 100000}),
    body('status').optional().isIn(['draft', 'scheduled']),
    body('schedule_date')
      .optional()
      .isISO8601()
      .withMessage('Invalid schedule date, it must be in ISO 8601 format'),
    body('attachments')
      .optional()
      .isArray()
      .withMessage('Attachments must be an array'),
    body('attachments.*')
      .optional()
      .isMongoId()
      .withMessage('Each attachment must be a valid ID'),
    body('memories')
      .optional()
      .isArray()
      .withMessage('Memories must be an array'),
    body('memories.*')
      .optional()
      .isMongoId()
      .withMessage('Each memory must be a valid ID'),
  ],
  updateCapsule: [
    body('recipients')
      .optional()
      .isArray()
      .withMessage('Recipients must be an array'),
    body('recipients.*')
      .optional()
      .custom(isRecipient)
      .withMessage('Each recipient must be a valid beneficiary ID or email'),
    body('schedule_date')
      .optional()
      .isISO8601()
      .withMessage('Schedule date must be in ISO 8601 format'),
    body('attachments')
      .optional()
      .isArray()
      .withMessage('Attachments must be an array of strings'),
    body('memories')
      .optional()
      .isArray()
      .withMessage('Memories must be an array'),
    body('memories.*')
      .optional()
      .isMongoId()
      .withMessage('Each memory must be a valid ID'),
    body('status')
      .optional()
      .isIn(['scheduled', 'draft', 'pause'])
      .withMessage('Invalid status'),
    body('style').optional().isObject(),
  ],
  externalTokenExchange: [
    body('token').isString().isLength({min: 32, max: 256}),
  ],
  getCapsules: [
    query('status')
      .optional()
      .isIn(['scheduled', 'draft', 'delivered', 'failed', 'pause', 'received'])
      .withMessage(
        'Invalid status. Must be one of: scheduled, draft, delivered, failed, pause, received',
      ),
  ],
};
