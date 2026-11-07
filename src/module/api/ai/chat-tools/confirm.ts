import {StatusCodes} from 'http-status-codes';
import Message from '../../../database/model/message';
import VoiceAction from '../../../database/model/voice-action';
import {
  BadRequestException,
  NotFoundException,
  ServiceError,
} from '../../../../utils/service-error';
import {assertOwnedMemory} from '../../memory/access';
import {runVoiceServerTool} from '../voice/server-tools';
import {CONFIRM_FENCE, CONFIRMED_FENCE, isChatAction} from './actions';

/**
 * The Confirm button on a chat confirmation card. Runs the action with the
 * code it was read back with (the code only matches those exact details, for
 * a few minutes), once: pressing again returns the first result. The result
 * is added to the conversation as Memento's message.
 */
export async function confirmChatAction(
  userId: string,
  name: string,
  args: Record<string, unknown>,
  memoryId: string,
) {
  if (!isChatAction(name)) throw new NotFoundException('Unknown action');
  const code = typeof args.confirmation === 'string' ? args.confirmation : '';
  if (!/^[A-Z2-7]{8}$/.test(code)) {
    throw new BadRequestException('This action has no confirmation');
  }
  await assertOwnedMemory(memoryId, userId);

  const callId = `chat-confirm:${name}:${code}`;
  const already = await VoiceAction.exists({user: userId, call_id: callId});
  const outcome = await runVoiceServerTool(userId, name, args, {
    callId,
    sessionId: `chat:${memoryId}`,
  });
  if (outcome.confirm) {
    // Stale code: let the host ask again, and keep the id free for that.
    await VoiceAction.deleteOne({user: userId, call_id: callId});
    throw new ServiceError(
      'This confirmation has expired. Ask Memento again in the chat.',
      StatusCodes.CONFLICT,
      null,
      'failed',
    );
  }
  const done = Boolean(outcome.summary);
  const text = done
    ? `Done: ${outcome.summary}.`
    : "That didn't go through. You can try again, or do it in the app.";
  const message = already
    ? null
    : await Message.create({user: userId, memory: memoryId, role: 'ai', text});
  if (done) await markConfirmed(userId, memoryId, code);
  return {
    message: done ? 'Action complete' : 'Action not completed',
    data: {
      done,
      text,
      effects: outcome.effects,
      message,
    },
  };
}

/** Shows the card as done from now on, so it offers no buttons after a reload. */
async function markConfirmed(userId: string, memoryId: string, code: string) {
  const reply = await Message.findOne({
    user: userId,
    memory: memoryId,
    role: 'ai',
    text: new RegExp(`"confirmation":"${code}"`),
  })
    .sort({created_at: -1})
    .select('text');
  if (!reply?.text) return;
  const text = reply.text.replace(
    new RegExp(`\`\`\`${CONFIRM_FENCE}\n(?=[^\n]*"confirmation":"${code}")`),
    `\`\`\`${CONFIRMED_FENCE}\n`,
  );
  if (text !== reply.text) {
    await Message.updateOne({_id: reply._id}, {$set: {text}});
  }
}
