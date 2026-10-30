import {describe, expect, it} from 'vitest';
import {
  buildVoiceTools,
  parseVoiceClientCapabilities,
} from '../../src/module/api/ai/live-session-config';

const names = (options: Parameters<typeof buildVoiceTools>[0]) =>
  (buildVoiceTools(options)?.[0].functionDeclarations ?? []).map(d => d.name);

describe('screen fields capability', () => {
  it('offers look_at_screen and type_text only to builds that send it', () => {
    expect(names({screenControl: true})).not.toContain('type_text');
    expect(names({screenControl: true, screenFields: true})).toEqual(
      expect.arrayContaining(['look_at_screen', 'type_text', 'press_button']),
    );
    expect(names({screenFields: true})).toEqual([]);
  });

  it('parses the capability', () => {
    expect(
      parseVoiceClientCapabilities('screen_control,screen_fields').screenFields,
    ).toBe(true);
    expect(parseVoiceClientCapabilities('screen_control').screenFields).toBe(
      false,
    );
  });
});
