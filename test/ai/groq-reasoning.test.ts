import {describe, expect, it} from 'vitest';
import {reasoningFor} from '../../src/services/ai/groq';

describe('reasoningFor', () => {
  it('asks gpt-oss models for low reasoning effort', () => {
    expect(reasoningFor('openai/gpt-oss-120b')).toEqual({
      reasoning_effort: 'low',
    });
  });

  it('sends nothing extra to other models', () => {
    expect(reasoningFor('llama-3.1-8b-instant')).toEqual({});
  });
});
