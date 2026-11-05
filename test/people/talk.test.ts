import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {
  connectTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
} from '../helpers/database';
import {createUserFixture} from '../helpers/factories';
import Beneficiary from '../../src/module/database/model/beneficiary';
import Memory from '../../src/module/database/model/memory';
import * as activation from '../../src/module/api/people/activation';
import * as talk from '../../src/module/api/people/talk';
import {generateConnectionReply} from '../../src/module/api/people/talk-generator';
vi.mock('../../src/module/api/people/talk-generator', () => ({
  generateConnectionReply: vi.fn(),
}));
describe('private connection Talk', () => {
  beforeAll(connectTestDatabase);
  afterEach(async () => {
    vi.clearAllMocks();
    await clearTestDatabase();
  });
  afterAll(closeTestDatabase);
  async function pair() {
    const owner = await createUserFixture({
      first_name: 'Tunde',
      context: {self_description: 'SECRET_OWNER_CONTEXT'},
    });
    const viewer = await createUserFixture();
    const invite = await Beneficiary.create({
      benefactor: owner.id,
      user: viewer.id,
      email: viewer.email,
      status: 'accepted',
      access_scope: 'shared_only',
    });
    return {owner, viewer, invite};
  }
  it('opts web into shared-only chat while preserving legacy activation and excluding private context', async () => {
    const {owner, viewer, invite} = await pair();
    await activation.update(owner.id, {
      approved_context: 'UNACTIVATED_PROFILE',
      active: false,
    });
    await Memory.create({
      user: owner.id,
      title: 'Hidden',
      body: 'PRIVATE_DIARY',
      status: 'save',
    });
    const shared = await Memory.create({
      user: owner.id,
      title: 'Our trip',
      body: 'SHARED_TRIP',
      status: 'save',
      beneficiaries: [invite.id],
    });
    vi.mocked(generateConnectionReply).mockResolvedValue({
      text: 'We can reflect on your trip.',
      source_ids: [shared.id],
    });
    expect((await talk.history(owner.id, viewer.id)).available).toBe(false);
    expect((await talk.history(owner.id, viewer.id, true)).available).toBe(
      true,
    );
    await talk.send(owner.id, viewer.id, {
      text: 'Tell me about our trip',
      request_id: crypto.randomUUID(),
      shared_space: true,
    });
    const prompt = JSON.stringify(
      vi.mocked(generateConnectionReply).mock.calls[0],
    );
    expect(prompt).toContain('SHARED_TRIP');
    expect(prompt).toContain(
      'listen, communicate, and ask open-ended questions',
    );
    expect(prompt).toContain('Do not invent or offer personal facts');
    expect(prompt).not.toContain('UNACTIVATED_PROFILE');
    expect(prompt).not.toContain('PRIVATE_DIARY');
    expect(prompt).not.toContain('SECRET_OWNER_CONTEXT');
    expect((await talk.history(viewer.id, owner.id, true)).turns).toEqual([]);
    invite.status = 'pending';
    await invite.save();
    await expect(talk.history(owner.id, viewer.id, true)).rejects.toMatchObject(
      {statusCode: 404},
    );
  });
  it('does not activate implicitly or allow pending/unrelated access', async () => {
    const {owner, viewer, invite} = await pair();
    await expect(
      talk.send(owner.id, viewer.id, {
        text: 'Hello',
        request_id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({statusCode: 403});
    await activation.update(owner.id, {
      approved_context: 'APPROVED_BASE',
      active: true,
    });
    invite.status = 'pending';
    await invite.save();
    await expect(
      talk.send(owner.id, viewer.id, {
        text: 'Hello',
        request_id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({statusCode: 404});
    expect(generateConnectionReply).not.toHaveBeenCalled();
  });
  it('sends only approved context and pair-visible sources, validates citations and keeps transcripts viewer-owned', async () => {
    const {owner, viewer, invite} = await pair();
    await activation.update(owner.id, {
      approved_context: 'APPROVED_BASE',
      active: true,
    });
    const shared = await Memory.create({
      user: owner.id,
      title: 'Walk',
      body: 'SHARED_PERSPECTIVE',
      status: 'save',
      beneficiaries: [invite.id],
    });
    const privateSource = await Memory.create({
      user: owner.id,
      title: 'Hidden',
      body: 'SECRET_PRIVATE_STORY',
      status: 'save',
    });
    vi.mocked(generateConnectionReply).mockResolvedValue({
      text: 'A memory of a walk.',
      source_ids: [shared.id, privateSource.id, 'invented'],
    });
    const result = await talk.send(owner.id, viewer.id, {
      text: 'What do you remember?',
      request_id: crypto.randomUUID(),
    });
    expect(result.citations.map(citation => citation.source_id)).toEqual([
      shared.id,
    ]);
    const prompt = JSON.stringify(
      vi.mocked(generateConnectionReply).mock.calls[0],
    );
    expect(prompt).toContain('APPROVED_BASE');
    expect(prompt).toContain('SHARED_PERSPECTIVE');
    expect(prompt).not.toContain('SECRET_OWNER_CONTEXT');
    expect(prompt).not.toContain('SECRET_PRIVATE_STORY');
    expect((await talk.history(owner.id, viewer.id)).turns).toHaveLength(2);
    await activation.update(viewer.id, {
      approved_context: 'Viewer base',
      active: true,
    });
    expect((await talk.history(viewer.id, owner.id)).turns).toHaveLength(0);
    expect(await Memory.countDocuments()).toBe(2);
  });
  it('invalidates revoked sources and stale context in subsequent prompts', async () => {
    const {owner, viewer, invite} = await pair();
    await activation.update(owner.id, {
      approved_context: 'APPROVED_BASE',
      active: true,
    });
    const source = await Memory.create({
      user: owner.id,
      title: 'Walk',
      body: 'REVOKED_FACT',
      status: 'save',
      beneficiaries: [invite.id],
    });
    vi.mocked(generateConnectionReply).mockResolvedValue({
      text: 'REVOKED_FACT was shared.',
      source_ids: [source.id],
    });
    await talk.send(owner.id, viewer.id, {
      text: 'Tell me',
      request_id: crypto.randomUUID(),
    });
    await source.updateOne({$set: {beneficiaries: []}});
    vi.mocked(generateConnectionReply).mockResolvedValue({
      text: 'That memory is unavailable.',
      source_ids: [],
    });
    await talk.send(owner.id, viewer.id, {
      text: 'Tell me again',
      request_id: crypto.randomUUID(),
    });
    expect(
      JSON.stringify(vi.mocked(generateConnectionReply).mock.calls[1]),
    ).not.toContain('REVOKED_FACT');
    expect(
      (await talk.history(owner.id, viewer.id)).turns.filter(
        turn => turn.role === 'ai',
      )[0].text,
    ).not.toContain('REVOKED_FACT');
  });
  it('rechecks deactivation after generation and does not save a response or citation', async () => {
    const {owner, viewer} = await pair();
    await activation.update(owner.id, {
      approved_context: 'Approved',
      active: true,
    });
    vi.mocked(generateConnectionReply).mockImplementation(async () => {
      await activation.update(owner.id, {
        approved_context: 'Approved',
        active: false,
      });
      return {text: 'Late reply', source_ids: []};
    });
    await expect(
      talk.send(owner.id, viewer.id, {
        text: 'Hello',
        request_id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({statusCode: 403});
    await activation.update(owner.id, {
      approved_context: 'Approved',
      active: true,
    });
    expect((await talk.history(owner.id, viewer.id)).turns).toHaveLength(0);
  });
  it('deduplicates retries and rejects a reused request ID with different text', async () => {
    const {owner, viewer} = await pair();
    await activation.update(owner.id, {
      approved_context: 'Approved',
      active: true,
    });
    vi.mocked(generateConnectionReply).mockResolvedValue({
      text: 'Reply',
      source_ids: [],
    });
    const payload = {text: 'Hello', request_id: crypto.randomUUID()};
    const first = await talk.send(owner.id, viewer.id, payload);
    expect(await talk.send(owner.id, viewer.id, payload)).toEqual(first);
    expect(generateConnectionReply).toHaveBeenCalledTimes(1);
    await expect(
      talk.send(owner.id, viewer.id, {...payload, text: 'Changed'}),
    ).rejects.toMatchObject({statusCode: 409});
    expect((await talk.history(owner.id, viewer.id)).turns).toHaveLength(2);
  });
  it('does not persist a response after its source was edited during generation', async () => {
    const {owner, viewer, invite} = await pair();
    await activation.update(owner.id, {
      approved_context: 'Approved',
      active: true,
    });
    const source = await Memory.create({
      user: owner.id,
      title: 'Walk',
      body: 'Before',
      status: 'save',
      beneficiaries: [invite.id],
    });
    vi.mocked(generateConnectionReply).mockImplementation(async () => {
      await source.updateOne({$set: {body: 'After'}});
      return {text: 'Before', source_ids: [source.id]};
    });
    await expect(
      talk.send(owner.id, viewer.id, {
        text: 'Tell me',
        request_id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({statusCode: 403});
    expect((await talk.history(owner.id, viewer.id)).turns).toHaveLength(0);
  });
  it('retains source dependencies from prior turns outside the latest shared page', async () => {
    const {owner, viewer, invite} = await pair();
    await activation.update(owner.id, {
      approved_context: 'Approved',
      active: true,
    });
    const old = await Memory.create({
      user: owner.id,
      title: 'Old source',
      body: 'Older fact',
      status: 'save',
      beneficiaries: [invite.id],
      created_at: new Date('2020-01-01'),
    });
    vi.mocked(generateConnectionReply).mockResolvedValue({
      text: 'Older fact answer',
      source_ids: [old.id],
    });
    await talk.send(owner.id, viewer.id, {
      text: 'First question',
      request_id: crypto.randomUUID(),
    });
    await Memory.insertMany(
      Array.from({length: 31}, (_, i) => ({
        user: owner.id,
        title: `New ${i}`,
        status: 'save',
        beneficiaries: [invite.id],
      })),
    );
    await talk.send(owner.id, viewer.id, {
      text: 'Follow up on that',
      request_id: crypto.randomUUID(),
    });
    await old.updateOne({$set: {beneficiaries: []}});
    const last = (await talk.history(owner.id, viewer.id)).turns.at(-1)!;
    expect(last.available).toBe(false);
  });
});
