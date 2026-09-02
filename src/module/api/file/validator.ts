import {body, param} from 'express-validator';

export default {
  refreshAccess: [
    param('id').isMongoId().withMessage('Invalid file ID'),
    body('memory_id').optional().isMongoId().withMessage('Invalid memory ID'),
    body('capsule_id').optional().isMongoId().withMessage('Invalid capsule ID'),
  ],
};
