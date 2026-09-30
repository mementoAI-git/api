import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import dayjs from 'dayjs';
import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import {
  formatTranscriptLines,
  getRecentConversationLines,
} from '../../src/module/api/ai/voice/transcript-context';
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';

async function seedConversation() {
  const user = await createUserFixture();
  const memory = await Memory.create({
    user: user.id,
    type: 'conversation',
    status: 'save',
  });
  return {user, memory};
}

describe('getRecentConversationLines', () => {
  beforeAll(connectTestDatabase);
  afterEach(clearTestDatabase);
  afterAll(closeTestDatabase);

  it('returns speaker-labelled lines oldest first', async () => {
    const {user, memory} = await seedConversation();
    const t0 = dayjs().subtract(1, 'hour');
    await Message.create([
      {
        user: user.id,
        memory: memory.id,
        role: 'user',
        text: 'I miss home',
        created_at: t0.toDate(),
      },
      {
        user: user.id,
        memory: memory.id,
        role: 'ai',
        text: 'Which part?',
        created_at: t0.add(1, 's').toDate(),
      },
    ]);

    const lines = await getRecentConversationLines(user.id, memory.id);

    expect(lines).toEqual([
      {speaker: 'Host', text: 'I miss home'},
      {speaker: 'Memento', text: 'Which part?'},
    ]);
    expect(formatTranscriptLines(lines)).toBe(
      'Host: I miss home\nMemento: Which part?',
    );
  });

  it('expands legacy single-blob voice transcripts into turns', async () => {
    const {user, memory} = await seedConversation();
    await Message.create({
      user: user.id,
      memory: memory.id,
      role: 'ai',
      is_voice: true,
      duration: 60,
      text: [
        'Voice call completed (01:00)',
        '',
        '--- Transcript ---',
        'You: I was thinking about home.',
        'Memento: What part of home feels most vivid?',
      ].join('\n'),
    });

    const lines = await getRecentConversationLines(user.id, memory.id);

    expect(lines).toEqual([
      {speaker: 'Host', text: 'I was thinking about home.'},
      {speaker: 'Memento', text: 'What part of home feels most vivid?'},
    ]);
  });

  it('keeps only the newest maxLines lines and never reads other users', async () => {
    const {user, memory} = await seedConversation();
    const other = await createUserFixture();
    const t0 = dayjs().subtract(1, 'hour');
    await Message.create(
      Array.from({length: 30}, (_, i) => ({
        user: user.id,
        memory: memory.id,
        role: i % 2 === 0 ? 'user' : 'ai',
        text: `line ${i}`,
        created_at: t0.add(i, 's').toDate(),
      })),
    );
    await Message.create({
      user: other.id,
      memory: memory.id,
      role: 'user',
      text: 'intruder',
    });

    const lines = await getRecentConversationLines(user.id, memory.id, 5);

    expect(lines.map(l => l.text)).toEqual([
      'line 25',
      'line 26',
      'line 27',
      'line 28',
      'line 29',
    ]);
  });

  it('clips very long messages', async () => {
    const {user, memory} = await seedConversation();
    await Message.create({
      user: user.id,
      memory: memory.id,
      role: 'user',
      text: 'a'.repeat(2000),
    });

    const [line] = await getRecentConversationLines(user.id, memory.id);

    expect(line.text.length).toBeLessThanOrEqual(601);
  });
});
