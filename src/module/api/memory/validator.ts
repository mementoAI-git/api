import {body, param} from 'express-validator';

export const deleteMemoryValidator = [
  param('id')
    .notEmpty()
    .withMessage('Memory ID is required')
    .isMongoId()
    .withMessage('Invalid memory ID'),
  body('delete_permanently')
    .optional()
    .isBoolean()
    .withMessage('delete_permanently must be a boolean')
    .toBoolean(),
];

export default {
  quickCapture: [
    body('body').optional().isString().withMessage('Body must be a string'),
    body('attachments')
      .optional({nullable: true})
      .customSanitizer(value => {
        if (value === null || value === undefined || value === '') return [];
        if (typeof value === 'string') {
          return value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        }
        return value;
      })
      .isArray()
      .withMessage('Attachments must be an array'),
    body('attachments.*')
      .optional()
      .isMongoId()
      .withMessage('Each attachment must be a valid Mongo ID'),
    body('beneficiaries')
      .optional({nullable: true})
      .customSanitizer(value => {
        if (value === null || value === undefined || value === '') return [];
        if (typeof value === 'string') {
          return value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        }
        return value;
      })
      .isArray()
      .withMessage('Beneficiaries must be an array'),
    body('beneficiaries.*')
      .optional()
      .isMongoId()
      .withMessage('Each beneficiary must be a valid Mongo ID'),
    body('transcript_uncertain')
      .optional()
      .isBoolean()
      .withMessage('transcript_uncertain must be a boolean')
      .toBoolean(),
    body('capture_client_id')
      .optional()
      .isString()
      .withMessage('capture_client_id must be a string'),
    body('prompt_type')
      .optional()
      .isIn(['static', 'ai-generated'])
      .withMessage('prompt_type must be static or ai-generated'),
    body('prompt_id')
      .optional()
      .isMongoId()
      .withMessage('prompt_id must be a valid Mongo ID'),
    body('prompt_text')
      .optional()
      .isString()
      .isLength({max: 500})
      .withMessage('prompt_text must be a string'),
    body('reflection_day_key')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('reflection_day_key must be YYYY-MM-DD'),
    body('visibility')
      .optional()
      .isIn(['private'])
      .withMessage("visibility must be 'private' for quick capture"),
  ],
  createMemory: [
    body('title')
      .notEmpty()
      .withMessage('Title is required')
      .optional()
      .bail()
      .isString()
      .withMessage('Title must be a string'),
    body('level')
      .optional()
      .isInt({min: 1})
      .withMessage('Level must be a positive integer')
      .toInt(),
    body('attachments')
      .optional({nullable: true})
      .customSanitizer(value => {
        if (typeof value === 'string') return value.split(',');
        return value;
      })
      .isArray()
      .withMessage('Attachments must be an array'),
    body('attachments.*')
      .optional()
      .isMongoId()
      .withMessage('Each attachment must be a valid Mongo ID'),
    body('tags')
      .optional({nullable: true})
      .customSanitizer(value => {
        if (typeof value === 'string') return value.split(',');
        return value;
      })
      .isArray()
      .withMessage('Tags must be an array'),
    body('tags.*')
      .optional()
      .isString()
      .withMessage('Each tag must be a string'),
    body('visibility')
      .optional()
      .isIn(['private', 'everyone'])
      .withMessage("visibility must be 'private' or 'everyone'"),
  ],
  updateMemory: [
    param('id')
      .notEmpty()
      .withMessage('Memory ID is required')
      .isMongoId()
      .withMessage('Invalid memory ID'),
    body('status')
      .optional()
      .isIn(['save'])
      .withMessage("Status must be 'save'"),
    body('attachments')
      .optional({nullable: true})
      .customSanitizer(value => {
        if (typeof value === 'string') return value.split(',');
        return value;
      })
      .isArray()
      .withMessage('Attachments must be an array'),
    body('attachments.*')
      .optional()
      .isMongoId()
      .withMessage('Each attachment must be a valid Mongo ID'),
    body('tags')
      .optional({nullable: true})
      .customSanitizer(value => {
        if (typeof value === 'string') return value.split(',');
        return value;
      })
      .isArray()
      .withMessage('Tags must be an array'),
    body('tags.*')
      .optional()
      .isString()
      .withMessage('Each tag must be a string'),
    body('level')
      .optional()
      .isInt({min: 1})
      .withMessage('Level must be a positive integer')
      .toInt(),
    body('title').optional().isString().withMessage('Title must be a string'),
    body('body').optional().isString().withMessage('Body must be a string'),
    body('visibility')
      .optional()
      .isIn(['private', 'everyone'])
      .withMessage("visibility must be 'private' or 'everyone'"),
  ],
  removeFileFromMemory: [
    param('id')
      .notEmpty()
      .withMessage('file id is required')
      .isMongoId()
      .withMessage('invalid file id'),
  ],
  detachFileFromMemory: [
    param('memoryId').isMongoId().withMessage('Invalid memory ID'),
    param('fileId').isMongoId().withMessage('Invalid file ID'),
  ],
  publicMemory: [param('id').isMongoId().withMessage('Invalid memory ID')],
  addMessageToMemory: [
    body('messages').notEmpty().withMessage('Messages are reqired'),
    body('messages.*.text').notEmpty().withMessage('Text is reqired'),
    body('messages.*.role').notEmpty().withMessage('Role is reqired'),
    body('messages.*.is_voice')
      .optional()
      .isBoolean()
      .withMessage('Is voice must be a boolean'),
    body('messages.*.duration')
      .optional()
      .isInt({min: 0})
      .withMessage('Duration must be a positive integer'),
    body('memory_id').optional().isMongoId().withMessage('Invalid memory id'),
    body('session_id')
      .if(body('memory_id').not().exists())
      .notEmpty()
      .withMessage('Session id is required.')
      .isString()
      .withMessage('Session id must be a string'),
  ],
  deleteMemory: [
    param('id')
      .notEmpty()
      .withMessage('Memory ID is required')
      .isMongoId()
      .withMessage('Invalid memory ID'),
    body('delete_permanently')
      .optional()
      .isBoolean()
      .withMessage('delete_permanently must be a boolean')
      .toBoolean(),
  ],
};
