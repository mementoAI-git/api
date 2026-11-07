import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {prompts} from '../../src/utils';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

describe('chat system prompt: guided reflection', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('tells Memento to lead with follow-ups when the host asks to journal', async () => {
    const user = await createUserFixture();
    const text = await prompts.createSystemContext(user);

    expect(text).toContain('GUIDED REFLECTION (when the host invites it)');
    expect(text).toContain(
      'Inside a guided reflection, most replies should end with one follow-up question',
    );
    expect(text).toContain('Do not just say you can listen.');
  });

  it('tells Memento to state what a lookup found as fact', async () => {
    const user = await createUserFixture();
    const text = await prompts.createSystemContext(user);

    expect(text).toContain("FACTS ABOUT THE HOST'S ACCOUNT");
    expect(text).toContain(
      'say directly that they have not saved a story about it yet',
    );
  });
});
