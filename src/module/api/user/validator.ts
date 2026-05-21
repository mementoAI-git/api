import {body} from 'express-validator';

export default {
  setPassword: [
    body('new_password')
      .notEmpty()
      .withMessage('New Password is required')
      .isStrongPassword()
      .withMessage('Password must be strong'),
    body('old_password').notEmpty().withMessage('Old Password is required'),
  ],
  verifyTOTP: body('token').notEmpty().withMessage('Token is required'),
  updateContext: [
    body('important_notes').optional().isArray(),
    body('key_preferences').optional().isArray(),
    body('conversation_history_summary').optional().isString(),
    body('emotional_state_trends').optional().isArray(),
    body('goals_and_aspirations').optional().isArray(),
    body('self_description').optional().isString().isLength({max: 500}),
    body('current_priority').optional().isArray(),
    body('current_priority.*').optional().isString().isLength({max: 200}),
    body('join_reasons').optional().isArray(),
  ],
  completeOnboarding: [
    body('self_description').optional().isString().isLength({max: 500}),
    body('current_priority').optional().isArray(),
    body('current_priority.*').optional().isString().isLength({max: 200}),
    body('dob').optional().isISO8601().toDate(),
    body('join_reasons').optional().isArray(),
    body('stepReached').optional().isInt({min: 1, max: 12}),
    body('lifeSituation').optional().isString(),
    body('lifeSituationDetail').optional().isString(),
    body('personalityTraits').optional().isArray(),
    body('memoryTreasures').optional().isArray(),
    body('chronotype').optional().isString(),
    body('sharingIntent').optional().isString(),
    body('motivationType').optional().isString(),
    body('motivationDetail').optional().isString(),
    body('skippedDeepPersonalization').optional().isBoolean(),
  ],
};
