import {describe, expect, it} from 'vitest';
import {allowsSpeakerFullDuplex} from '../../src/module/api/ai/voice/device-policy';

describe('allowsSpeakerFullDuplex', () => {
  const denylist = ['sm-a115', 'redmi note 8'];

  it('allows unknown or missing models', () => {
    expect(allowsSpeakerFullDuplex(undefined, denylist)).toBe(true);
    expect(allowsSpeakerFullDuplex('  ', denylist)).toBe(true);
    expect(allowsSpeakerFullDuplex('Pixel 8', denylist)).toBe(true);
  });

  it('blocks exact and prefix matches, case-insensitively', () => {
    expect(allowsSpeakerFullDuplex('Redmi Note 8', denylist)).toBe(false);
    expect(allowsSpeakerFullDuplex('SM-A115F', denylist)).toBe(false);
  });

  it('allows everything when the denylist is empty', () => {
    expect(allowsSpeakerFullDuplex('SM-A115F', [])).toBe(true);
  });
});
