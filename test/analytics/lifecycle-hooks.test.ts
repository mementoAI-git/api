import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
vi.mock('../../src/services/growth-analytics', async importOriginal => ({
  ...(await importOriginal<
    typeof import('../../src/services/growth-analytics')
  >()),
  isGrowthAnalyticsEnabled: () => true,
  readGrowthAnalyticsConfig: () => ({identitySecret: 'test-only-secret'}),
  recordGrowthEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/enrichment', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/services/enrichment')>()),
  invalidateEnrichmentCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/queues/memory-search', () => ({
  queueMemorySearch: vi.fn(),
}));
vi.mock('../../src/module/api/ai/utils', () => ({
  updateMemoryTitle: vi.fn(),
  isSignificantMessage: () => false,
  triggerSummarization: vi.fn(),
}));
vi.mock('../../src/module/api/user/service', () => ({
  updateStreak: vi.fn().mockResolvedValue(undefined),
}));
import {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import {recordGrowthEvent} from '../../src/services/growth-analytics';
import {createMemory} from '../../src/module/api/memory/service';
import Group from '../../src/module/database/model/group';
import SharedSpace from '../../src/module/database/model/shared-space';
import {register} from '../../src/module/api/auth/service';
import User from '../../src/module/database/model/user';
import {handleStreaming} from '../../src/module/api/ai/service';
import {Response} from 'express';
import {recordVoiceTurns} from '../../src/module/api/ai/voice/turns';
import {
  acceptInvite,
  resendInvite,
} from '../../src/module/api/beneficiary/service';
import Memory from '../../src/module/database/model/memory';
import Message from '../../src/module/database/model/message';
import Beneficiary from '../../src/module/database/model/beneficiary';
import mail, {transport} from '../../src/module/mail';
import GrowthInvitation from '../../src/module/database/model/growth-invitation';
const recorded = (name: string) =>
  vi
    .mocked(recordGrowthEvent)
    .mock.calls.filter(([input]) => input.event === name);

describe('growth hooks on successful service persistence', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);

  it('counts persisted explicit and group sharing only for accepted, available pairs', async () => {
    const owner = await createUserFixture();
    const accepted = await createUserFixture();
    const blocked = await createUserFixture();
    const removed = await createUserFixture();
    const capsuleOnly = await createUserFixture();
    const documentsOnly = await createUserFixture();
    const relationships = await Beneficiary.insertMany([
      {
        benefactor: owner.id,
        user: accepted.id,
        email: accepted.email,
        status: 'accepted',
      },
      {
        benefactor: owner.id,
        user: blocked.id,
        email: blocked.email,
        status: 'accepted',
      },
      {
        benefactor: owner.id,
        user: removed.id,
        email: removed.email,
        status: 'removed',
      },
      {benefactor: owner.id, email: 'pending@example.com', status: 'pending'},
      {
        benefactor: owner.id,
        user: capsuleOnly.id,
        email: capsuleOnly.email,
        status: 'accepted',
        access_scope: 'capsules_only',
      },
      {
        benefactor: owner.id,
        user: documentsOnly.id,
        email: documentsOnly.email,
        status: 'accepted',
        access_scope: 'documents_only',
      },
    ]);
    await SharedSpace.create({
      _id: [owner.id, blocked.id].sort().join(':'),
      user_a: owner.id,
      user_b: blocked.id,
      blocked_by: [owner.id],
    });
    const group = await Group.create({
      user: owner.id,
      name: 'People',
      members: relationships.map(row => row.id),
    });
    const payload = {
      title: 'Private title',
      body: '',
      status: 'save',
      level: 1,
      tags: [],
      attachments: [],
      groups: [group.id],
      beneficiaries: [relationships[0].id],
    };
    await createMemory({...payload, status: 'draft'}, owner.id);
    expect(recorded('growth_connection_engaged')).toHaveLength(0);
    await createMemory(payload, owner.id);
    expect(recorded('growth_connection_engaged')).toHaveLength(2);
    expect(
      recorded('growth_connection_engaged')
        .map(([input]) => input.distinctId)
        .sort(),
    ).toEqual([owner.id, accepted.id].sort());
    expect(JSON.stringify(recorded('growth_connection_engaged'))).not.toMatch(
      /Private title|People|example.com/,
    );
  });
  it('records a newly persisted account once and isolates analytics failures from registration', async () => {
    vi.spyOn(mail, 'sendLink').mockResolvedValue({
      code: 'test-code',
      expires_at: new Date().toISOString(),
    });
    vi.mocked(recordGrowthEvent).mockRejectedValueOnce(
      new Error('analytics storage unavailable'),
    );
    const payload = {
      email: 'registered@example.com',
      first_name: 'New',
      last_name: 'User',
      password: 'Password1!',
    };
    await expect(register(payload)).resolves.toMatchObject({
      data: {requires_verification: true},
    });
    const user = await User.findOne({email: payload.email});
    expect(user).not.toBeNull();
    expect(recorded('growth_account_created')).toHaveLength(1);
    expect(recorded('growth_account_created')[0][0].distinctId).toBe(user.id);
    await expect(register(payload)).rejects.toThrow('already exists');
    expect(recorded('growth_account_created')).toHaveLength(1);
  });
  it('marks successful server streams and excludes persisted partial stream failures', async () => {
    const user = await createUserFixture();
    const memory = await Memory.create({
      user: user.id,
      type: 'conversation',
      title: 'Chat',
      status: 'save',
    });
    const initial = new Date(Date.now() - 10000);
    await Message.insertMany(
      Array.from({length: 4}, (_, index) => ({
        user: user.id,
        memory: memory.id,
        role: index % 2 ? 'ai' : 'user',
        text: 'Private content',
        server_completed: index % 2 ? true : undefined,
        created_at: new Date(initial.getTime() + index * 1000),
      })),
    );
    const response = {write: vi.fn(), end: vi.fn()} as unknown as Response;
    await Message.create({
      user: user.id,
      memory: memory.id,
      role: 'user',
      text: 'Private input',
    });
    async function* broken() {
      yield {text: 'Partial'};
      throw new Error('provider interrupted');
    }
    await handleStreaming(user.id, memory.id, broken(), response, 'test', {
      userMessageSaved: Promise.resolve(true),
    });
    expect(recorded('growth_conversation_meaningful')).toHaveLength(0);
    expect(
      await Message.countDocuments({
        memory: memory.id,
        server_completed: false,
      }),
    ).toBe(1);
    async function* completed() {
      yield {text: 'Finished'};
    }
    await Message.create({
      user: user.id,
      memory: memory.id,
      role: 'user',
      text: 'Private retry',
    });
    await handleStreaming(user.id, memory.id, completed(), response, 'test', {
      userMessageSaved: Promise.resolve(true),
    });
    expect(recorded('growth_conversation_meaningful')).toHaveLength(1);
    expect(
      await Message.countDocuments({memory: memory.id, server_completed: true}),
    ).toBe(3);
    expect(
      JSON.stringify(recorded('growth_conversation_meaningful')),
    ).not.toMatch(/Private|Partial|Finished/);
  });
  it('persists voice turns and retries without trusting caller supplied assistant completion', async () => {
    const user = await createUserFixture();
    const memory = await Memory.create({
      user: user.id,
      type: 'conversation',
      title: 'Chat',
      status: 'save',
    });
    const turns = Array.from({length: 6}, (_, index) => ({
      index,
      role: index % 2 ? ('ai' as const) : ('user' as const),
      text: 'Private transcript',
    }));
    const payload = {memory_id: memory.id, session_id: 'voice-test', turns};
    await recordVoiceTurns(user.id, payload);
    expect(await Message.countDocuments({memory: memory.id})).toBe(6);
    expect(recorded('growth_conversation_meaningful')).toHaveLength(0);
    await recordVoiceTurns(user.id, payload);
    expect(recorded('growth_conversation_meaningful')).toHaveLength(0);
    expect(
      JSON.stringify(vi.mocked(recordGrowthEvent).mock.calls),
    ).not.toContain('Private transcript');
  });
  it('does not emit conversation activity when message persistence fails', async () => {
    const user = await createUserFixture();
    const memory = await Memory.create({
      user: user.id,
      type: 'conversation',
      title: 'Chat',
      status: 'save',
    });
    vi.spyOn(Message, 'updateOne').mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(
      recordVoiceTurns(user.id, {
        memory_id: memory.id,
        session_id: 'voice-test',
        turns: [{index: 0, role: 'user', text: 'private'}],
      }),
    ).rejects.toThrow('database unavailable');
    expect(recorded('growth_conversation_meaningful')).toHaveLength(0);
  });

  it('does not claim a sent invitation when the real mail adapter swallows SMTP failure or recipient rejection', async () => {
    const inviter = await createUserFixture();
    const invite = await Beneficiary.create({
      benefactor: inviter.id,
      email: 'recipient@example.com',
      status: 'pending',
      due_at: new Date(Date.now() + 100000),
    });
    const smtp = vi
      .spyOn(transport, 'sendMail')
      .mockRejectedValueOnce(new Error('SMTP unavailable'));
    await expect(
      resendInvite({email: invite.email}, inviter.id),
    ).resolves.toMatchObject({message: 'Invite sent successfully'});
    expect(await GrowthInvitation.countDocuments()).toBe(0);
    expect(recorded('growth_invitation_sent')).toHaveLength(0);
    smtp.mockResolvedValueOnce({
      messageId: 'wrong-recipient',
      accepted: ['other@example.com'],
      rejected: [],
    } as never);
    await resendInvite({email: invite.email}, inviter.id);
    expect(await GrowthInvitation.countDocuments()).toBe(0);
    smtp.mockResolvedValueOnce({
      messageId: 'rejected-recipient',
      accepted: [],
      rejected: [invite.email],
    } as never);
    await resendInvite({email: invite.email}, inviter.id);
    expect(await GrowthInvitation.countDocuments()).toBe(0);
    smtp.mockResolvedValueOnce({
      messageId: 'accepted-recipient',
      accepted: [invite.email.toUpperCase()],
      rejected: [],
    } as never);
    await resendInvite({email: invite.email}, inviter.id);
    expect(await GrowthInvitation.countDocuments()).toBe(1);
    expect(recorded('growth_invitation_sent')).toHaveLength(1);
  });

  it('flags a successfully resent pending invitation to an account created since the failed original delivery', async () => {
    const inviter = await createUserFixture();
    const invite = await Beneficiary.create({
      benefactor: inviter.id,
      email: 'later-existing@example.com',
      status: 'pending',
      due_at: new Date(Date.now() + 100000),
    });
    const smtp = vi
      .spyOn(transport, 'sendMail')
      .mockRejectedValueOnce(new Error('SMTP unavailable'));
    await resendInvite({email: invite.email}, inviter.id);
    expect(await GrowthInvitation.countDocuments()).toBe(0);
    await createUserFixture({email: invite.email});
    expect((await Beneficiary.findById(invite.id)).user).toBeUndefined();
    smtp.mockResolvedValueOnce({
      messageId: 'accepted-existing',
      accepted: [invite.email],
      rejected: [],
    } as never);
    await resendInvite({email: invite.email}, inviter.id);
    expect(recorded('growth_invitation_sent')).toHaveLength(1);
    expect(
      recorded('growth_invitation_sent')[0][0].properties.existing_user,
    ).toBe(true);
  });
  it('records invitation retries only after successful mail, retaining one stable receipt', async () => {
    const inviter = await createUserFixture();
    const invite = await Beneficiary.create({
      benefactor: inviter.id,
      email: 'new@example.com',
      status: 'pending',
      due_at: new Date(Date.now() + 100000),
    });
    const send = vi
      .spyOn(mail, 'sendBeneficiaryInvite')
      .mockRejectedValueOnce(new Error('delivery failed'));
    await expect(
      resendInvite({email: invite.email}, inviter.id),
    ).rejects.toThrow('delivery failed');
    expect(await GrowthInvitation.countDocuments()).toBe(0);
    expect(recorded('growth_invitation_sent')).toHaveLength(0);
    send.mockResolvedValue(true);
    await resendInvite({email: invite.email}, inviter.id);
    await resendInvite({email: invite.email}, inviter.id);
    expect(await GrowthInvitation.countDocuments()).toBe(1);
    const keys = recorded('growth_invitation_sent').map(([input]) => input.key);
    expect(new Set(keys).size).toBe(1);
  });
  it('accepting an existing account invitation activates both participants without a signup', async () => {
    const inviter = await createUserFixture();
    const invitee = await createUserFixture();
    const invite = await Beneficiary.create({
      benefactor: inviter.id,
      user: invitee.id,
      email: invitee.email,
      status: 'pending',
      access_scope: 'full_vault',
    });
    await acceptInvite({
      invite_id: invite.id,
      first_name: 'Existing',
      last_name: 'User',
      dob: '2000-01-01',
    });
    expect(recorded('growth_account_created')).toHaveLength(0);
    expect(recorded('growth_invitation_converted')).toHaveLength(0);
    expect(recorded('growth_connection_activated')).toHaveLength(2);
  });
});
