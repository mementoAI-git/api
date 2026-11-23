import {describe, expect, it} from 'vitest';

import {
  CONFIRMATION_WINDOW_MS,
  confirmationCode,
  isConfirmed,
} from '../../src/module/api/ai/voice/confirmation';

const SECRET = 'test-secret';
const T0 = 1_800_000_000_000;

describe('voice action confirmation', () => {
  const args = {name: 'Emeka', email: 'emeka@example.com'};

  it('accepts the code it issued for the same host, action and details', () => {
    const code = confirmationCode('user-1', 'add_connection', args, T0, SECRET);
    expect(code).toMatch(/^[A-Z2-7]{8}$/);
    expect(
      isConfirmed(
        'user-1',
        'add_connection',
        {...args, confirmation: code},
        T0 + 1_000,
        SECRET,
      ),
    ).toBe(true);
  });

  it('ignores case and surrounding spaces in the details and the code', () => {
    const code = confirmationCode('user-1', 'add_connection', args, T0, SECRET);
    expect(
      isConfirmed(
        'user-1',
        'add_connection',
        {
          name: ' emeka ',
          email: 'EMEKA@example.com',
          confirmation: ` ${code.toLowerCase()} `,
        },
        T0,
        SECRET,
      ),
    ).toBe(true);
  });

  it('rejects the code once the details change, so a read-back cannot be swapped', () => {
    const code = confirmationCode('user-1', 'add_connection', args, T0, SECRET);
    expect(
      isConfirmed(
        'user-1',
        'add_connection',
        {...args, email: 'other@example.com', confirmation: code},
        T0,
        SECRET,
      ),
    ).toBe(false);
  });

  it('rejects it for another host or another action', () => {
    const code = confirmationCode('user-1', 'add_connection', args, T0, SECRET);
    expect(
      isConfirmed(
        'user-2',
        'add_connection',
        {...args, confirmation: code},
        T0,
        SECRET,
      ),
    ).toBe(false);
    expect(
      isConfirmed(
        'user-1',
        'delete_story',
        {...args, confirmation: code},
        T0,
        SECRET,
      ),
    ).toBe(false);
  });

  it('expires after a few minutes', () => {
    const code = confirmationCode('user-1', 'add_connection', args, T0, SECRET);
    expect(
      isConfirmed(
        'user-1',
        'add_connection',
        {...args, confirmation: code},
        T0 + CONFIRMATION_WINDOW_MS,
        SECRET,
      ),
    ).toBe(true);
    expect(
      isConfirmed(
        'user-1',
        'add_connection',
        {...args, confirmation: code},
        T0 + 3 * CONFIRMATION_WINDOW_MS,
        SECRET,
      ),
    ).toBe(false);
  });

  it('is not confirmed without a code', () => {
    expect(isConfirmed('user-1', 'add_connection', args, T0, SECRET)).toBe(
      false,
    );
  });
});
