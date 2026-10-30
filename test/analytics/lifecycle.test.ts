import {beforeEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  enabled: true,
  events: new Map<string, Record<string, unknown>>(),
  receipts: [] as Array<Record<string, unknown>>,
  messages: [] as Array<Record<string, unknown>>,
  beneficiary: null as Record<string, unknown> | null,
  fail: false,
  currentUserExists: false,
}));
vi.mock('../../src/services/growth-analytics', () => ({
  isGrowthAnalyticsEnabled: () => state.enabled,
  readGrowthAnalyticsConfig: () => ({
    identitySecret: 'test-only-identity-secret',
  }),
  recordGrowthEvent: vi.fn(async (event: {key: string}) => {
    if (state.fail) throw new Error('unavailable');
    if (!state.events.has(event.key)) state.events.set(event.key, event);
  }),
}));
vi.mock('../../src/module/database/model/growth-invitation', () => ({
  default: {
    findOneAndUpdate: vi.fn(
      async (
        filter: {_id: string},
        update: {
          $setOnInsert: Record<string, unknown>;
          $set: Record<string, unknown>;
        },
      ) => {
        if (state.fail) throw new Error('unavailable');
        let receipt = state.receipts.find(row => row._id === filter._id);
        if (!receipt) {
          receipt = {_id: filter._id, ...update.$setOnInsert};
          state.receipts.push(receipt);
        }
        Object.assign(receipt, update.$set);
        return receipt;
      },
    ),
    find: vi.fn((filter: {invitee_key: string; sent_at: {$lte: Date}}) => ({
      sort: () => ({
        lean: async () =>
          state.receipts.filter(
            row =>
              row.invitee_key === filter.invitee_key &&
              !row.existing_user &&
              new Date(row.sent_at as Date) <= filter.sent_at.$lte,
          ),
      }),
    })),
  },
}));
vi.mock('../../src/module/database/model/beneficiary', () => ({
  default: {
    findOne: vi.fn(async (filter: {due_at: {$gte: Date}}) => {
      const b = state.beneficiary;
      return b &&
        ['pending', 'accepted'].includes(String(b.status)) &&
        new Date(b.due_at as Date) >= filter.due_at.$gte
        ? b
        : null;
    }),
  },
}));
vi.mock('../../src/module/database/model/user', () => ({
  default: {
    exists: vi.fn(async () =>
      state.currentUserExists ? {_id: 'existing-account'} : null,
    ),
  },
}));
vi.mock('../../src/module/database/model/message', () => ({
  default: {
    find: vi.fn(() => ({
      select: () => ({
        sort: () => ({
          lean: async () =>
            state.messages.map((row, index) => ({...row, _id: String(index)})),
        }),
      }),
    })),
  },
}));
import {
  accountCreated,
  completedExchanges,
  connectionActivated,
  connectionEngaged,
  conversationPersisted,
  invitationDelivered,
  memoryCaptured,
  recipientKey,
} from '../../src/services/growth-events';
import GrowthInvitation from '../../src/module/database/model/growth-invitation';
import Message from '../../src/module/database/model/message';
import User from '../../src/module/database/model/user';

const events = (name: string) =>
  [...state.events.values()].filter(row => row.event === name);
beforeEach(() => {
  state.enabled = true;
  state.events.clear();
  state.receipts = [];
  state.messages = [];
  state.beneficiary = null;
  state.fail = false;
  state.currentUserExists = false;
  vi.clearAllMocks();
});
describe('authoritative growth lifecycle', () => {
  it('normalizes recipient identities without sending content and deduplicates resend and recreated invite', async () => {
    const invite = {
      id: 'beneficiary-1',
      email: ' Friend@Example.com ',
      benefactor: 'inviter',
    };
    await invitationDelivered(invite, false);
    await invitationDelivered({...invite, id: 'beneficiary-2'}, false);
    await invitationDelivered(
      {...invite, benefactor: 'another-inviter'},
      false,
    );
    expect(events('growth_invitation_sent')).toHaveLength(2);
    expect(state.receipts).toHaveLength(2);
    expect(state.receipts[0].invitee_key).toBe(state.receipts[1].invitee_key);
    expect(recipientKey(invite.email)).toBe(recipientKey('friend@example.com'));
    expect(JSON.stringify([...state.events.values()])).not.toMatch(
      /example|Friend|email|beneficiary-1/,
    );
  });

  it('classifies a first successfully tracked resend from current account existence and preserves original receipts', async () => {
    state.currentUserExists = true;
    await invitationDelivered(
      {
        id: 'stale-null-user',
        email: 'existing@example.com',
        benefactor: 'inviter',
      },
      false,
    );
    expect(events('growth_invitation_sent')[0]).toMatchObject({
      properties: {existing_user: true},
    });
    state.currentUserExists = false;
    await invitationDelivered(
      {id: 'original', email: 'new@example.com', benefactor: 'inviter'},
      false,
    );
    state.currentUserExists = true;
    await invitationDelivered(
      {id: 'original', email: 'new@example.com', benefactor: 'inviter'},
      false,
    );
    expect(
      state.receipts.find(row => row.beneficiary_id === 'original')
        .existing_user,
    ).toBe(false);
  });
  it('joins an ordinary signup to successful prior invitations once using the shared user ID', async () => {
    await invitationDelivered(
      {id: 'invite', email: 'friend@example.com', benefactor: 'inviter'},
      false,
    );
    state.beneficiary = {
      email: 'friend@example.com',
      status: 'pending',
      due_at: new Date(Date.now() + 100000),
    };
    const user = {
      _id: 'account',
      email: 'FRIEND@example.com',
      created_at: new Date(),
    };
    await accountCreated(user, 'email');
    await accountCreated(user, 'oauth');
    expect(events('growth_account_created')).toHaveLength(1);
    expect(events('growth_account_created')[0]).toMatchObject({
      distinctId: 'account',
      timestamp: user.created_at,
      properties: {acquisition_source: 'invitation', inviter_id: 'inviter'},
    });
    expect(events('growth_invitation_converted')).toHaveLength(1);
  });
  it('excludes existing users and expired or undelivered invitations from conversion', async () => {
    await invitationDelivered(
      {id: 'invite', email: 'existing@example.com', benefactor: 'inviter'},
      true,
    );
    state.beneficiary = {
      email: 'existing@example.com',
      status: 'pending',
      due_at: new Date(Date.now() + 100000),
    };
    await accountCreated(
      {_id: 'new-account', email: 'existing@example.com'},
      'email',
    );
    expect(events('growth_invitation_converted')).toHaveLength(0);
    expect(events('growth_account_created')[0]).toMatchObject({
      properties: {acquisition_source: 'organic'},
    });
    state.beneficiary.due_at = new Date(0);
    await invitationDelivered(
      {id: 'second', email: 'expired@example.com', benefactor: 'inviter'},
      false,
    );
    await accountCreated(
      {_id: 'expired', email: 'expired@example.com'},
      'email',
    );
    expect(events('growth_invitation_converted')).toHaveLength(0);
  });
  it('tracks validated referrals without fabricating an emailed invitation', async () => {
    await accountCreated(
      {
        _id: 'account',
        email: 'friend@example.com',
        referred_by: 'server-validated-inviter',
      },
      'oauth',
    );
    expect(events('growth_account_created')[0]).toMatchObject({
      properties: {
        acquisition_source: 'referral',
        inviter_id: 'server-validated-inviter',
      },
    });
    expect(events('growth_invitation_sent')).toHaveLength(0);
  });
  it('counts saved stories, quick notes and reflections but excludes drafts and chat placeholders', async () => {
    await memoryCaptured('user', {id: 'draft', status: 'draft'});
    await memoryCaptured('user', {
      id: 'chat',
      status: 'save',
      type: 'conversation',
    });
    const reflection = {
      id: 'reflection',
      status: 'save',
      capture_source: 'quick',
      prompt: 'prompt',
    };
    await memoryCaptured('user', reflection);
    await memoryCaptured('user', reflection);
    await memoryCaptured('user', {
      id: 'ai-reflection',
      status: 'save',
      capture_source: 'quick',
      prompt_type: 'ai-generated',
    });
    await memoryCaptured('user', {id: 'story', status: 'save'});
    await memoryCaptured('user', {
      id: 'quick',
      status: 'save',
      capture_source: 'quick',
    });
    expect(events('growth_memory_captured')).toHaveLength(4);
    expect(events('growth_reflection_added')).toHaveLength(2);
    expect(events('growth_user_active')).toHaveLength(4);
  });
  it('requires three persisted completed exchanges and records later meaningful days', async () => {
    const at = (day: number) => new Date(`2026-10-${day}T12:00:00Z`);
    state.messages = [
      {role: 'user', created_at: at(10)},
      {role: 'ai', server_completed: true, created_at: at(10)},
      {role: 'user', created_at: at(10)},
      {role: 'ai', server_completed: true, created_at: at(10)},
    ];
    await conversationPersisted('user', 'conversation', 'text');
    expect(events('growth_conversation_meaningful')).toHaveLength(0);
    state.messages.push(
      {role: 'user', created_at: at(10)},
      {
        role: 'ai',
        server_completed: true,
        created_at: at(10),
        voice_interrupted: true,
      },
    );
    await conversationPersisted('user', 'conversation', 'voice');
    expect(events('growth_conversation_meaningful')).toHaveLength(0);
    state.messages.push(
      {role: 'user', created_at: at(10)},
      {
        role: 'ai',
        server_completed: true,
        created_at: at(10),
      },
    );
    await conversationPersisted('user', 'conversation', 'voice');
    await conversationPersisted('user', 'conversation', 'voice');
    expect(events('growth_conversation_meaningful')).toHaveLength(1);
    state.messages.push(
      {role: 'user', created_at: at(11)},
      {role: 'ai', server_completed: true, created_at: at(11)},
    );
    await conversationPersisted('user', 'conversation', 'voice');
    expect(events('growth_conversation_meaningful')).toHaveLength(2);
    expect(events('growth_user_active')).toHaveLength(2);
    expect(
      completedExchanges([
        {role: 'ai', server_completed: true},
        {role: 'user'},
        {role: 'user'},
        {role: 'ai', server_completed: true},
      ]).count,
    ).toBe(1);
  });

  it('keeps qualifying completions on both sides of an exact same-day retention boundary', async () => {
    const early = new Date('2026-10-29T10:00:00Z');
    state.messages = Array.from({length: 6}, (_, index) => ({
      role: index % 2 ? 'ai' : 'user',
      server_completed: index % 2 ? true : undefined,
      created_at: early,
    }));
    await conversationPersisted('user', 'conversation', 'text');
    const late = new Date('2026-10-29T13:00:00Z');
    state.messages.push(
      {role: 'user', created_at: late},
      {role: 'ai', server_completed: true, created_at: late},
    );
    await conversationPersisted('user', 'conversation', 'text');
    expect(events('growth_user_active').map(event => event.timestamp)).toEqual([
      early,
      late,
    ]);
  });
  it('records accepted and engaged connections for both participants idempotently', async () => {
    await connectionActivated('a', 'b');
    await connectionActivated('b', 'a');
    await connectionEngaged('a', 'b', 'source');
    await connectionEngaged('a', 'b', 'source');
    expect(events('growth_connection_activated')).toHaveLength(2);
    expect(events('growth_connection_engaged')).toHaveLength(2);
    expect(events('growth_connection_engaged')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          distinctId: 'a',
          properties: {connection_id: 'a:b', other_user_id: 'b'},
        }),
        expect.objectContaining({
          distinctId: 'b',
          properties: {connection_id: 'a:b', other_user_id: 'a'},
        }),
      ]),
    );
  });
  it('isolates storage and delivery failures and skips all queries when disabled', async () => {
    state.fail = true;
    await expect(
      invitationDelivered(
        {id: 'invite', email: 'friend@example.com', benefactor: 'inviter'},
        false,
      ),
    ).resolves.toBeUndefined();
    await expect(
      memoryCaptured('user', {id: 'memory', status: 'save'}),
    ).resolves.toBeUndefined();
    state.enabled = false;
    await invitationDelivered(
      {id: 'invite', email: 'friend@example.com', benefactor: 'inviter'},
      false,
    );
    await conversationPersisted('user', 'conversation', 'text');
    expect(GrowthInvitation.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(Message.find).not.toHaveBeenCalled();
    expect(User.exists).toHaveBeenCalledTimes(1);
  });
});
