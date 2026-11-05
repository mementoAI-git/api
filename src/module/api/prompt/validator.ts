import {body} from 'express-validator';

export default {
  reflectionConversation: [
    body('prompt_type').isIn(['static', 'ai-generated']),
    body('reflection_day_key')
      .isISO8601({strict: true})
      .matches(/^\d{4}-\d{2}-\d{2}$/),
    body('prompt_id').if(body('prompt_type').equals('static')).isMongoId(),
    body('prompt_text')
      .if(body('prompt_type').equals('ai-generated'))
      .isString()
      .trim()
      .isLength({min: 1, max: 4000}),
  ],
  replyPrompt: [
    body('prompt_id')
      .notEmpty()
      .withMessage('Prompt id is required')
      .isMongoId()
      .withMessage('Invalid promp id'),
  ],
  exploreQuestionFeedback: [
    body('status')
      .isIn(['skipped', 'not-relevant'])
      .withMessage('status must be skipped or not-relevant'),
  ],
};
