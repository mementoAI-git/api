import {describe, expect, it} from 'vitest';
import {buildLiveSessionDescriptor} from '../../src/module/api/ai/live-session-config';

describe('Gemini Live session descriptor', () => {
  it('returns the exact model and resolved voice used by token constraints', () => {
    expect(
      buildLiveSessionDescriptor('gemini-3.8-live', {
        id: 'denver',
        name: 'Fenrir',
        provider: 'gemini',
      }),
    ).toEqual({
      model: 'gemini-3.8-live',
      voice: {id: 'denver', name: 'Fenrir', provider: 'gemini'},
    });
  });
});
