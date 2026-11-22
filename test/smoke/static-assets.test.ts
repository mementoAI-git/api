import request from 'supertest';
import {describe, expect, it} from 'vitest';
import {createTestApp} from '../helpers/app';

// Emails load their logo and backdrop from /assets. The release ships only
// build/, so these must resolve from the compiled app's own folder.
describe('static assets', () => {
  it.each(['memento-icon.png', 'email-backdrop.png'])(
    'serves the email image %s',
    async file => {
      const response = await request(createTestApp()).get(
        `/assets/images/${file}`,
      );
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
    },
  );
});
