import {describe, expect, it} from 'vitest';
import {validationResult} from 'express-validator';
import validator from '../../src/module/api/user/validator';

describe.each(['updateContext', 'completeOnboarding'] as const)(
  '%s introduction limit',
  endpoint => {
    it.each([1000, 2000, 2001])('validates %i characters', async length => {
      const request = {body: {self_description: 'a'.repeat(length)}};
      for (const rule of validator[endpoint]) await rule.run(request);
      expect(validationResult(request).isEmpty()).toBe(length <= 2000);
    });
  },
);
