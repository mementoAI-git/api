import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {
  getOnboardingDetails,
  skipOnboarding,
} from '../../src/module/api/user/service';
import Persona from '../../src/module/database/model/persona';
import User from '../../src/module/database/model/user';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('skipping onboarding keeps the answers given so far', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('saves the answers and returns them for the next attempt', async () => {
    const user = await createUserFixture();

    const result = await skipOnboarding(user.id, {
      self_description: '  I care about my family.  ',
      join_reasons: ['memory_preservation', 'memory_preservation'],
      current_priority: ['identity_self', 'passions_interests'],
      motivationType: 'preserver',
    });

    expect(result.data.onboarding_status).toBe('skipped');
    expect((await User.findById(user.id))?.onboarding_status).toBe('skipped');
    const {data} = await getOnboardingDetails(user.id);
    expect(data.persona).toMatchObject({
      self_description: 'I care about my family.',
      join_reasons: ['memory_preservation'],
      current_priority: ['identity_self', 'passions_interests'],
      motivation: 'preserver',
    });
  });

  it('keeps earlier answers when a later skip has fewer', async () => {
    const user = await createUserFixture();
    await skipOnboarding(user.id, {
      self_description: 'About me',
      join_reasons: ['life_record'],
    });

    await skipOnboarding(user.id, {join_reasons: ['explorer']});

    const persona = await Persona.findOne({user: user.id}).lean();
    expect(persona?.self_description).toBe('About me');
    expect(persona?.join_reasons).toEqual(['explorer']);
  });

  it('still skips when the answers are malformed, dropping the bad values', async () => {
    const user = await createUserFixture();

    await skipOnboarding(user.id, {
      self_description: 42,
      join_reasons: 'life_record',
      current_priority: ['identity_self', {}, ''],
    } as never);

    expect((await User.findById(user.id))?.onboarding_status).toBe('skipped');
    const persona = await Persona.findOne({user: user.id}).lean();
    expect(persona?.self_description).toBeUndefined();
    expect(persona?.join_reasons ?? []).toEqual([]);
    expect(persona?.current_priority).toEqual(['identity_self']);
  });

  it('caps the introduction at the onboarding limit', async () => {
    const user = await createUserFixture();
    await skipOnboarding(user.id, {self_description: 'a'.repeat(2500)});
    const persona = await Persona.findOne({user: user.id}).lean();
    expect(persona?.self_description).toHaveLength(2000);
  });

  it('leaves a completed onboarding alone', async () => {
    const user = await createUserFixture({onboarding_status: 'completed'});
    const result = await skipOnboarding(user.id, {self_description: 'Late'});
    expect(result.data.onboarding_status).toBe('completed');
    expect(await Persona.findOne({user: user.id})).toBeNull();
  });
});
