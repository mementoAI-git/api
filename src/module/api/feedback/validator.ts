import {body} from 'express-validator';

export default {
  createFeedback: [
    body('message').notEmpty().withMessage('Message is required'),
    body('type').notEmpty().withMessage('Type is required'),
  ],
};
