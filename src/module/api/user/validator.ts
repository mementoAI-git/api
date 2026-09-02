import {body} from 'express-validator';

export default {
  setPassword: [
    body('new_password')
      .notEmpty()
      .withMessage('New Password is required')
      .isLength({min: 6})
      .withMessage('New Password must be at least 6 characters'),
    body('current_password').optional().isString(),
    body('old_password').optional().isString(),
    body().custom((_value, {req}) => {
      const current = req.body.current_password;
      const legacy = req.body.old_password;
      if (!current && !legacy) throw new Error('Current Password is required');
      if (current && legacy && current !== legacy) {
        throw new Error('Password fields conflict');
      }
      req.body.current_password = current || legacy;
      return true;
    }),
  ],
  profile: [
    body('first_name').optional().isString().isLength({max: 100}),
    body('last_name').optional().isString().isLength({max: 100}),
    body('fullname').optional().isString().isLength({min: 2, max: 200}),
    body('nickname').optional().isString().isLength({max: 100}),
    body('phone_number').optional().isString().isLength({max: 40}),
    body('gender').optional().isString().isLength({max: 50}),
    body('dob').optional().isISO8601(),
    body('country').optional().isString().isLength({max: 100}),
    body('bg_music').optional({nullable: true}).isString(),
    body('chat_voice').optional({nullable: true}).isString(),
    body('chat_voice_provider').optional().isString(),
    body('location').optional().isString().isLength({max: 200}),
    body('push_token')
      .optional()
      .isString()
      .trim()
      .isLength({min: 1, max: 4096}),
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
