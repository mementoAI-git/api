import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

const {generateText} = vi.hoisted(() => ({generateText: vi.fn()}));
vi.mock('../../src/services/ai', () => ({default: {generateText}}));

import Persona from '../../src/module/database/model/persona';
import {summarizePersona} from '../../src/workers/summarizarion/personal';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

const updated = new Date('2026-11-01T10:00:00Z');

/** A persona whose notes changed since they were last consolidated, loaded as the nightly job loads it. */
async function personaWithNewNotes() {
  const user = await createUserFixture();
  const created = await Persona.create({
    user: user.id,
    important_notes: [
      'Has a sister',
      'Has a sister named Ada',
      'Lives in Lagos',
    ],
    key_preferences: ['Likes short replies'],
    last_update: {important_notes: updated},
    last_summarized: {key_preferences: new Date('2026-10-01T00:00:00Z')},
  });
  // Not lean: the job works on full documents, whose per-field dates are Maps.
  return (await Persona.findById(created._id))!;
}

describe('nightly persona summarization', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    generateText.mockReset();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('saves the consolidated notes and when they were consolidated', async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        summarized_items: ['Has a sister named Ada', 'Lives in Lagos'],
      }),
    );
    const persona = await personaWithNewNotes();

    await summarizePersona(persona);

    const saved = (await Persona.findById(persona._id).lean())!;
    expect(saved.important_notes).toEqual([
      'Has a sister named Ada',
      'Lives in Lagos',
    ]);
    expect(saved.last_summarized?.important_notes).toBeInstanceOf(Date);
    // Other fields' timestamps survive; untouched fields are not rewritten.
    expect(saved.last_summarized?.key_preferences).toEqual(
      new Date('2026-10-01T00:00:00Z'),
    );
    expect(saved.key_preferences).toEqual(['Likes short replies']);
    expect(generateText).toHaveBeenCalledOnce();
  });

  it('keeps the notes when the model fails', async () => {
    generateText.mockRejectedValue(new Error('provider down'));
    const persona = await personaWithNewNotes();

    await summarizePersona(persona);

    const saved = (await Persona.findById(persona._id).lean())!;
    expect(saved.important_notes).toHaveLength(3);
    expect(saved.last_summarized?.important_notes).toBeUndefined();
  });

  it('does not consolidate the same notes again until they change', async () => {
    generateText.mockResolvedValue(
      JSON.stringify({summarized_items: ['Has a sister named Ada']}),
    );
    const persona = await personaWithNewNotes();
    await summarizePersona(persona);

    await summarizePersona((await Persona.findById(persona._id))!);

    expect(generateText).toHaveBeenCalledOnce();
  });
});
