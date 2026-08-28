import bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import User, {IUser} from '../../database/model/user';
import Persona from '../../database/model/persona';
import Memory from '../../database/model/memory';
import Message from '../../database/model/message';
import {
  concatStrings,
  hashPassword,
  isEmpty,
  withTransaction,
} from '../../../utils/helpers';
import {
  BadRequestException,
  NotFoundException,
} from '../../../utils/service-error';
import {
  ICompleteOnboardingPayload,
  ISetPassword,
  IUpdateContext,
  IVerifyTOTP,
} from './interface';
import File from '../../database/model/file';
import PendingInsight from '../../database/model/pending-insight';
import * as storage from '../../../services/storage';
import speakeasy from 'speakeasy';
import Qr from 'qrcode';
import {z} from 'zod';
import mail from '../../mail';
import {OnboardingBody} from './dto';
import ai from '../../../services/ai';
import {gatherMemoryInsightsSummaryContext} from '../../../utils/ai-prompt';
import {
  buildMemoryInsightsSummaryRequest,
  normalizeMemoryInsightsSummaryOutput,
} from '../../../utils/ai-prompt/memory-insights-summary-prompt';
import {OnboardingChatPromptBody} from './dto';
import gemini, {GEMINI_MODEL} from '../../../services/gemini';
import type {OpenRouterMessage} from '../../../services/ai/openrouter';
import {recordAiMetric} from '../../../services/ai/metrics';
import {streamCriticalChatResponse} from '../../../services/ai/critical-chat-stream';
import type {GroqMessage} from '../../../services/ai/groq';
import {getPromptVersion} from '../../../utils/ai-prompt/registry';
import {
  computeEnrichmentScore,
  getMilestone,
  getNudge,
  getJumpPills,
} from '../../../services/enrichment';
import {getMemorySpotlightForUser} from '../../../services/enrichment/memory-spotlight';
import {PUBLIC_USER_SELECT, toPublicUser} from '../../../contracts/public-user';
import AuthSession from '../../database/model/auth-session';
import {invalidateSecurityState} from '../auth/security-state';
import type {MementoClient} from '../../../contracts/response';
import {registerLegacyProfileToken} from '../push-device/service';

const ONBOARDING_PROMPT_VERSION = getPromptVersion('onboarding_chat');

const onboardingTrailerSchema = z.object({
  suggestion_chips: z.array(z.string()).min(1),
  composer_placeholder: z.string().min(1),
  composer_label: z.string().min(1),
  flow_complete: z.boolean(),
  step_index: z.number().int().min(1),
  total_steps: z.number().int().min(1).nullable(),
  intent_id: z.string().min(1),
});

export async function setPassword(payload: ISetPassword, user_id: string) {
  const {new_password} = payload;
  const currentPassword = payload.current_password || payload.old_password;
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  const is_match = await bcrypt.compare(
    String(currentPassword),
    `${user?.password}`,
  );
  if (!is_match) {
    throw new BadRequestException('Incorrect password');
  }

  const password = await hashPassword(new_password);
  await user.updateOne({password});

  return {message: 'Password updated successfully', data: null};
}

export async function getProfile(user_id: string) {
  const user = await User.findById(user_id).select(PUBLIC_USER_SELECT).lean();
  if (!user) {
    throw new NotFoundException('User not found', null);
  }

  const pending_insights_count = await PendingInsight.countDocuments({
    user: user_id,
  });

  return {
    message: 'User profile retrieved successfully',
    data: {
      ...toPublicUser(user),
      pending_insights_count,
    },
  };
}

export async function getPersona(user_id: string) {
  const persona = await Persona.findOne({user: user_id}).lean();

  return {
    message: 'Persona retrieved successfully',
    data: persona,
  };
}

export type MemoryInsightsSummaryDto = {
  summary: string | null;
  generated_at: string | null;
  cached: boolean;
};

export async function getMemoryInsightsSummary(
  user_id: string,
  refresh: boolean,
): Promise<{message: string; data: MemoryInsightsSummaryDto}> {
  const persona = await Persona.findOne({user: user_id}).lean();

  // Generate once and persist; only regenerate when explicitly requested (refresh=true).
  if (!refresh && persona?.memory_insights_summary?.trim()) {
    return {
      message: 'Memory insights summary retrieved',
      data: {
        summary: persona.memory_insights_summary.trim(),
        generated_at: persona.memory_insights_summary_at
          ? new Date(persona.memory_insights_summary_at).toISOString()
          : null,
        cached: true,
      },
    };
  }

  const {pack, hasSignal} = await gatherMemoryInsightsSummaryContext(user_id);

  if (!hasSignal) {
    return {
      message: 'Not enough context for a summary yet',
      data: {
        summary: null,
        generated_at: null,
        cached: false,
      },
    };
  }

  const prompt = buildMemoryInsightsSummaryRequest(pack);
  const raw = await ai.generateText([{role: 'user', content: prompt}]);
  const summary = normalizeMemoryInsightsSummaryOutput(raw);

  if (persona?._id) {
    await Persona.findByIdAndUpdate(persona._id, {
      memory_insights_summary: summary,
      memory_insights_summary_at: new Date(),
    });
  }

  return {
    message: 'Memory insights summary generated',
    data: {
      summary,
      generated_at: new Date().toISOString(),
      cached: false,
    },
  };
}

export async function updateProfile(
  payload: Partial<IUser> & {push_token?: string},
  user_id: string,
  client: MementoClient = 'legacy-unknown',
) {
  if (payload.push_token) {
    await registerLegacyProfileToken(user_id, payload.push_token, client);
  }
  const updateableFields = new Set([
    'first_name',
    'last_name',
    'phone_number',
    'gender',
    'dob',
    'nickname',
    'country',
    'bg_music',
    'chat_voice',
    'chat_voice_provider',
    'location',
  ]);

  const updatePayload = Object.entries(payload).reduce<Record<string, unknown>>(
    (acc, p) => {
      if (updateableFields.has(p[0])) {
        acc[p[0]] = p[1];
      }
      return acc;
    },
    {},
  );

  if (
    typeof payload.fullname === 'string' &&
    payload.first_name === undefined &&
    payload.last_name === undefined
  ) {
    const [firstName, ...lastName] = payload.fullname.trim().split(/\s+/);
    updatePayload.first_name = firstName;
    updatePayload.last_name = lastName.join(' ');
  }

  const data = await User.findByIdAndUpdate(user_id, updatePayload, {
    new: true,
  }).select(PUBLIC_USER_SELECT);
  if (!data) throw new NotFoundException('User not found', null);

  return {
    message: 'User profile updated successfully',
    data: toPublicUser(data.toObject({virtuals: true})),
  };
}

export async function updateStreak(user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  const today = dayjs().format('YYYY-MM-DD');
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

  // Only update if last_task_date is not today (prevent multiple updates on same day)
  if (user.last_task_date !== today) {
    if (!user.last_task_date || user.last_task_date < yesterday) {
      // Reset streak if last_task_date is missing or more than 1 day ago
      user.streak = 1;
    } else if (user.last_task_date === yesterday) {
      // Increment streak if last task was yesterday (consecutive day)
      user.streak += 1;
    }
    // If last_task_date === today, streak remains unchanged (already counted)

    // Update last_task_date to today
    user.last_task_date = today;
    await user.save();
  }

  const data = {
    last_task_date: user.last_task_date,
    streak: user.streak,
  };
  return {message: 'Streak updated successfully', data};
}

export async function uploadPicture(
  payload: Express.Multer.File[],
  user_id: string,
) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  await storage.checkStorageQuota(user, payload[0].size);

  const {name, type, size} = await storage.uploadFile(payload[0], user_id);

  const file = await File.create({
    name,
    // base64: data.toString("base64"),
    size,
    user: user_id,
    type,
  });

  if (user.picture) {
    await File.deleteOne({name: user.picture});
  }

  await user.updateOne({picture: file.name});

  return {message: 'Profile pics uploaded successfully', data: file};
}

export async function setup2FA(user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  const secret = speakeasy.generateSecret({
    name: `Memento (${user.email})`,
  });

  await user.updateOne({'two_factor.secret': secret.base32});
  const qrcode = await Qr.toDataURL(secret.otpauth_url);

  return {
    data: {url: secret.otpauth_url, qrcode, secret: secret.base32},
    message:
      '2FA setup successful. Scan the QR code with your Authenticator app.',
  };
}

//verify time-base one-time-password
export async function verifyTOTP({token}: IVerifyTOTP, user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }
  if (isEmpty(user?.two_factor?.secret)) {
    throw new BadRequestException(
      'Token verification failed. You must set up 2FA before verifying.',
    );
  }

  const verified = speakeasy.totp.verify({
    secret: user.two_factor.secret,
    encoding: 'base32',
    token,
  });

  if (!verified) {
    throw new BadRequestException('Invalid token', {verified});
  }

  if (!user?.two_factor?.enabled) {
    await user.updateOne({'two_factor.enabled': true});
  }

  return {data: {verified}, message: 'Verification successful'};
}

export async function disable2FA(user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  await user.updateOne({
    two_factor: {
      enabled: false,
      secret: null,
    },
  });

  return {data: null, message: '2FA disabled successfully'};
}

export async function listPasskeys(user_id: string) {
  const user = await User.findById(user_id).select('passkeys');
  if (!user) throw new NotFoundException('User not found');

  const passkeys = (user.passkeys || []).map(pk => ({
    credential_id: pk.credential_id,
    device_name: pk.device_name,
    created_at: pk.created_at,
  }));

  return {data: passkeys, message: 'Passkeys retrieved successfully'};
}

export async function deletePasskey(user_id: string, credential_id: string) {
  const user = await User.findById(user_id);
  if (!user) throw new NotFoundException('User not found');

  const exists = (user.passkeys || []).some(
    pk => pk.credential_id === credential_id,
  );
  if (!exists) throw new NotFoundException('Passkey not found');

  await User.updateOne({_id: user_id}, {$pull: {passkeys: {credential_id}}});

  return {data: null, message: 'Passkey removed successfully'};
}

export async function completeOnboarding(
  user_id: string,
  payload?: ICompleteOnboardingPayload,
) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  // Create or update persona
  if (payload) {
    const personaData: any = {};
    if (!isEmpty(payload?.self_description)) {
      personaData.self_description = payload.self_description;
    }
    if (
      Array.isArray(payload?.current_priority) &&
      payload.current_priority.length > 0
    ) {
      personaData.current_priority = payload.current_priority;
    }
    if (
      Array.isArray(payload?.join_reasons) &&
      payload.join_reasons.length > 0
    ) {
      personaData.join_reasons = payload.join_reasons;
    }
    if (!isEmpty(payload?.motivationType)) {
      personaData.motivation = payload.motivationType;
    }
    if (!isEmpty(payload?.motivationDetail)) {
      personaData.motivation_detail = payload.motivationDetail;
    }
    if (!isEmpty(payload?.lifeSituation)) {
      personaData.life_situation = payload.lifeSituation;
    }
    if (!isEmpty(payload?.lifeSituationDetail)) {
      personaData.life_situation_detail = payload.lifeSituationDetail;
    }
    if (
      Array.isArray(payload?.personalityTraits) &&
      payload.personalityTraits.length > 0
    ) {
      personaData.personality_traits = payload.personalityTraits;
    }
    if (
      Array.isArray(payload?.memoryTreasures) &&
      payload.memoryTreasures.length > 0
    ) {
      personaData.memory_treasures = payload.memoryTreasures;
    }

    await withTransaction(async session => {
      if (Object.keys(personaData).length > 0) {
        await Persona.findOneAndUpdate({user: user_id}, personaData, {
          upsert: true,
          session,
        });
      }

      if (!isEmpty(payload?.dob)) {
        user.dob = payload.dob;
      }
      if (typeof payload?.stepReached === 'number') {
        user.onboarding_step_reached = payload.stepReached;
      }
      if (typeof payload?.skippedDeepPersonalization === 'boolean') {
        user.skipped_deep_personalization = payload.skippedDeepPersonalization;
      }
      if (!isEmpty(payload?.chronotype)) {
        (user.preferences as any).chronotype = payload.chronotype;
      }
      if (!isEmpty(payload?.sharingIntent)) {
        (user.preferences as any).sharing_intent = payload.sharingIntent;
      }

      user.onboarding_status = 'completed';
      await user.save({session});
    });
  }

  void mail.sendWelcome({
    email: user.email,
    name: user?.nickname || user?.first_name || user?.last_name || '',
  });

  return {data: null, message: 'Onboarding completed successfully'};
}

export async function updateContext(payload: IUpdateContext, user_id: string) {
  const allowed: Array<keyof IUpdateContext> = [
    'important_notes',
    'key_preferences',
    'conversation_history_summary',
    'emotional_state_trends',
    'goals_and_aspirations',
    'self_description',
    'current_priority',
    'join_reasons',
  ];

  const updateDoc: Record<string, unknown> = {};
  let isModifyingArrays = false;

  for (const key of allowed) {
    const value = (payload as any)[key];
    if (!isEmpty(value)) {
      updateDoc[key] = value;
      // Check if we're modifying important_notes or key_preferences
      if (key === 'important_notes' || key === 'key_preferences') {
        isModifyingArrays = true;
      }
    }
  }

  // Set last_array_update when arrays are modified
  if (isModifyingArrays) {
    updateDoc.last_array_update = new Date();
  }

  const persona = await Persona.findOneAndUpdate({user: user_id}, updateDoc, {
    upsert: true,
    new: true,
  });
  if (!persona) {
    throw new NotFoundException('Persona not found');
  }

  return {message: 'User context updated successfully', data: null};
}

export async function deleteUser(user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  // Access is revoked immediately; the durable purge pipeline is introduced
  // separately and treats purge_pending as an irreversible state.
  await User.findByIdAndUpdate(user_id, {
    $set: {
      deleted: true,
      purge_status: 'purge_pending',
      refresh_token: null,
      refresh_tokens: [],
    },
    $inc: {session_version: 1},
  });
  await AuthSession.updateMany(
    {user_id, revoked_at: null},
    {$set: {revoked_at: new Date()}},
  );
  await invalidateSecurityState(user_id);

  return {
    data: null,
    message: 'User account deleted successfully',
  };
}

export async function getUserStats(user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  // Get streak count from user
  const streak_count = user.streak || 0;

  // Count answered prompts (memories that have a prompt field)
  const reflections_count = await Memory.countDocuments({
    user: user_id,
    prompt: {$exists: true, $ne: null},
  });

  // Stories visible on /stories (non-draft, non-deleted), aligned with GET /memories/stories
  const stories_count = await Memory.countDocuments({
    user: user_id,
    type: 'story',
    status: {$nin: ['draft', 'deleted']},
  });

  const pending_insights_count = await PendingInsight.countDocuments({
    user: user_id,
  });

  const [enrichment, spotlight] = await Promise.all([
    computeEnrichmentScore(user_id),
    getMemorySpotlightForUser(user_id),
  ]);

  const milestone = getMilestone(enrichment.enrichment_score);
  const nudge = getNudge(enrichment.lowest_category);

  // Compute gap dimensions: priority dims not yet discussed in any conversation
  const priorityDimensions: string[] =
    (user.preferences as any)?.priority_dimensions || [];
  const conversations = await Memory.find({
    user: user_id,
    type: 'conversation',
    status: {$nin: ['draft', 'deleted']},
  })
    .select('dimensions')
    .lean();
  const discussedDimensions = Array.from(
    new Set(conversations.flatMap(c => (c.dimensions as string[]) || [])),
  );
  const DEFERRED = new Set(['lessons_wisdom', 'hopes_legacy']);
  const gapDimensions = priorityDimensions.filter(
    d => !DEFERRED.has(d) && !discussedDimensions.includes(d),
  );
  const jumpPills = getJumpPills(gapDimensions, priorityDimensions);

  const quickCapturePending = await Memory.find({
    user: user_id,
    capture_source: 'quick',
    enrichment_status: 'pending',
    status: {$nin: ['draft', 'deleted']},
  })
    .sort({created_at: -1})
    .select('_id')
    .limit(1)
    .lean();

  const quick_capture_pending_count = await Memory.countDocuments({
    user: user_id,
    capture_source: 'quick',
    enrichment_status: 'pending',
    status: {$nin: ['draft', 'deleted']},
  });

  const stats = {
    streak_count,
    reflections_count,
    stories_count,
    pending_insights_count,
    quick_capture_pending_count,
    quick_capture_latest_id: quickCapturePending[0]?._id?.toString?.() ?? null,
    enrichment_score: enrichment.enrichment_score,
    category_scores: enrichment.category_scores,
    lowest_category: enrichment.lowest_category,
    beneficiary_access_unlocked: enrichment.beneficiary_access_unlocked,
    milestone,
    nudge,
    jump_pills: jumpPills,
    spotlight,
  };

  return {
    data: stats,
    message: 'User statistics retrieved successfully',
  };
}

export async function onboarding(payload: OnboardingBody, user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  const allowedFields = new Set([
    'first_name',
    'last_name',
    'nickname',
    'location',
    'age_range',
  ]);

  const updatePayload = Object.entries(payload).reduce((acc, p) => {
    if (allowedFields.has(p[0])) {
      acc[p[0]] = p[1];
    }
    return acc;
  }, {});

  const allowedPersonaFields = new Set([
    'join_reasons',
    'audience',
    'current_priority',
    'communication_style',
    'motivation',
    'motivation_detail',
    'life_situation',
    'life_situation_detail',
    'personality_traits',
    'memory_treasures',
  ]);

  const personaUpdate = Object.entries(payload).reduce((acc, p) => {
    if (
      allowedPersonaFields.has(p[0]) &&
      Array.isArray(p[1]) &&
      p[1].length > 0
    ) {
      acc[p[0]] = p[1];
    } else if (p[0] === 'motivation' && typeof p[1] === 'string' && p[1]) {
      acc[p[0]] = p[1];
    }
    return acc;
  }, {} as any);

  const allowedPreferencesFields = new Set([
    'age_bracket',
    'priority_dimensions',
    'expression_mode',
    'chronotype',
    'sharing_intent',
  ]);

  const preferencesUpdate = Object.entries(payload).reduce((acc, p) => {
    if (allowedPreferencesFields.has(p[0])) {
      acc[`preferences.${p[0]}`] = p[1];
    }
    return acc;
  }, {} as any);

  await withTransaction(async session => {
    await User.findByIdAndUpdate(
      user_id,
      {
        ...updatePayload,
        ...preferencesUpdate,
        onbaorded: true,
        onboarding_step_reached: payload.step ?? null,
        skipped_deep_personalization: payload.skipped_deep_personalization,
      },
      {session},
    );
    if (Object.keys(personaUpdate).length > 0) {
      await Persona.findOneAndUpdate(
        {user: user_id},
        {$set: personaUpdate},
        {upsert: true, session},
      );
    }
  });

  return {message: 'Onboarding saved successfully', data: null};
}

export async function skipOnboarding(user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  if (user.onboarding_status === 'completed') {
    return {
      message: 'Onboarding already completed',
      data: {onboarding_status: 'completed' as const},
    };
  }

  await User.findByIdAndUpdate(user_id, {onboarding_status: 'skipped'});

  return {
    message: 'Onboarding skipped',
    data: {onboarding_status: 'skipped' as const},
  };
}

export async function getOnboardingDetails(user_id: string) {
  const user = await User.findById(user_id).lean();
  if (!user) {
    throw new NotFoundException('User not found');
  }
  const persona = await Persona.findOne({user: user_id}).lean();
  const u = user as Record<string, unknown>;
  const first = String(u.first_name ?? '');
  const last = String(u.last_name ?? '');
  const full_name = concatStrings(first, last, ' ').trim();

  let current_priority: string[] = [];
  const cp = persona?.current_priority as unknown;
  if (Array.isArray(cp)) {
    current_priority = cp.filter((x): x is string => typeof x === 'string');
  } else if (typeof cp === 'string' && cp) {
    current_priority = [cp];
  }

  return {
    message: 'Onboarding profile retrieved successfully',
    data: {
      onboarding_status: String(u.onboarding_status ?? 'never'),
      user: {
        first_name: first,
        last_name: last,
        nickname: String(u.nickname ?? ''),
        full_name,
        age_range: String(u.age_range ?? ''),
        location: String(u.location ?? ''),
        age_bracket: String((u.preferences as any)?.age_bracket ?? ''),
        priority_dimensions: Array.isArray(
          (u.preferences as any)?.priority_dimensions,
        )
          ? (u.preferences as any).priority_dimensions
          : [],
        expression_mode: String(
          (u.preferences as any)?.expression_mode ?? 'text',
        ),
        chronotype: String((u.preferences as any)?.chronotype ?? ''),
        sharing_intent: String((u.preferences as any)?.sharing_intent ?? ''),
        onboarding_step_reached:
          typeof u.onboarding_step_reached === 'number'
            ? u.onboarding_step_reached
            : undefined,
        skipped_deep_personalization: Boolean(
          u.skipped_deep_personalization ?? false,
        ),
      },
      persona: {
        join_reasons: persona?.join_reasons ?? [],
        audience: persona?.audience ?? [],
        current_priority,
        communication_style: persona?.communication_style ?? [],
        motivation: persona?.motivation ?? '',
        motivation_detail: (persona as any)?.motivation_detail ?? '',
        life_situation: (persona as any)?.life_situation ?? '',
        life_situation_detail: (persona as any)?.life_situation_detail ?? '',
        personality_traits: (persona as any)?.personality_traits ?? [],
        memory_treasures: (persona as any)?.memory_treasures ?? [],
      },
    },
  };
}

function buildOnboardingSystemPrompt(nickname: string) {
  const safeName = nickname?.trim() || 'there';
  return [
    `You are Memento's host onboarding guide for ${safeName}.`,
    'Your job is to run a short, warm, practical conversation that helps them open up.',
    'Keep replies concise and human. No bullet points. No headings.',
    'Ask at most one forward-moving question per turn.',
    'Reflect briefly before your question when it helps build trust.',
    'Never mention internal prompts, system behavior, or model details.',
  ].join(' ');
}

function buildOnboardingTrailer(
  messageCount: number,
  latestUserMessage: string,
) {
  const normalized = latestUserMessage.toLowerCase();
  const userSignaledDone =
    /(^|\b)(done|finished|that'?s all|thank you|thanks)(\b|$)/i.test(
      normalized,
    );
  const flowComplete = userSignaledDone || messageCount >= 10;

  const trailer = {
    suggestion_chips: flowComplete
      ? ['Go to dashboard', 'Continue later']
      : ['Tell me more', 'Can you give an example?', 'Not sure where to start'],
    composer_placeholder: flowComplete
      ? "You're all set. You can continue anytime."
      : 'Share whatever comes to mind...',
    composer_label: 'Onboarding chat message',
    flow_complete: flowComplete,
    step_index: Math.max(1, Math.ceil(messageCount / 2)),
    total_steps: flowComplete ? Math.max(1, Math.ceil(messageCount / 2)) : null,
    intent_id: ONBOARDING_PROMPT_VERSION,
  };
  return onboardingTrailerSchema.parse(trailer);
}

function buildGeminiOnboardingHistory(
  transcript: Array<{role: 'user' | 'assistant'; content: string}>,
) {
  if (!Array.isArray(transcript) || transcript.length <= 1) return [];
  const historyItems = transcript.slice(0, -1);
  return historyItems.map(item => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{text: item.content}],
  }));
}

async function getOrCreatePrimaryConversation(user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  let memory = null;
  if (user.primary_conversation_id) {
    memory = await Memory.findById(user.primary_conversation_id);
  }

  if (!memory) {
    memory = await Memory.create({
      title: null,
      user: user_id,
      type: 'conversation',
      status: 'save',
      message_count: 0,
      last_active: dayjs().toDate(),
    });
    await User.findByIdAndUpdate(user_id, {primary_conversation_id: memory.id});
  }

  return memory;
}

export async function streamOnboardingChatPrompt(
  payload: OnboardingChatPromptBody,
  user_id: string,
) {
  const requestStart = Date.now();
  const memory = await getOrCreatePrimaryConversation(user_id);
  const transcript = Array.isArray(payload.messages) ? payload.messages : [];
  const latestUser = [...transcript].reverse().find(m => m.role === 'user');
  const latestUserMessage = (latestUser?.content || '').trim();
  const messageCount = transcript.length;

  const historyMessages: OpenRouterMessage[] = transcript.map(item => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: item.content,
  }));

  const systemPrompt = buildOnboardingSystemPrompt(payload.nickname);
  console.log('AI prompt version', {
    task: 'onboarding_chat',
    promptVersion: ONBOARDING_PROMPT_VERSION,
    userId: user_id,
  });
  void recordAiMetric({
    event: 'prompt_version_used',
    task: 'onboarding_chat',
    endpoint: '/users/onboarding/chat/prompt',
    user: user_id,
    memory: String(memory.id),
    prompt_version: ONBOARDING_PROMPT_VERSION,
  });
  const shouldBootstrap = Boolean(payload.bootstrap && transcript.length === 0);

  const bootstrapUserLine = `Start the onboarding chat with a warm opener for ${payload.nickname || 'the host'}.`;

  const lines = transcript.filter(
    m => m.role === 'user' || m.role === 'assistant',
  );
  const lastLine = lines[lines.length - 1];
  const priorLines = shouldBootstrap ? [] : lines.slice(0, -1);
  const latestUserText = shouldBootstrap
    ? bootstrapUserLine
    : lastLine?.role === 'user'
      ? (lastLine.content || '').trim()
      : latestUserMessage || 'Continue the onboarding conversation naturally.';

  const groqHistory: GroqMessage[] = priorLines.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  const routing = await streamCriticalChatResponse({
    userId: user_id,
    requestStart,
    userTextForGroqRouting: latestUserText,
    systemInstruction: systemPrompt,
    groqHistory,
    latestUserText,
    task: 'onboarding_chat',
    metricsEndpoint: '/users/onboarding/chat/prompt',
    memoryIdForMetrics: String(memory.id),
    createGeminiStream: async () => {
      const chat = gemini.chats.create({
        model: GEMINI_MODEL,
        config: {systemInstruction: systemPrompt},
        history: buildGeminiOnboardingHistory(
          transcript as Array<{role: 'user' | 'assistant'; content: string}>,
        ),
      });
      const latestPrompt = shouldBootstrap
        ? bootstrapUserLine
        : latestUserMessage ||
          'Continue the onboarding conversation naturally.';
      return chat.sendMessageStream({
        message: latestPrompt,
      });
    },
    buildOpenRouterMessages: () =>
      shouldBootstrap
        ? [
            {role: 'system', content: systemPrompt},
            {role: 'user', content: bootstrapUserLine},
          ]
        : [{role: 'system', content: systemPrompt}, ...historyMessages],
  });

  return {
    stream: routing.stream,
    memoryId: String(memory.id),
    latestUserMessage,
    trailer: buildOnboardingTrailer(messageCount, latestUserMessage),
    skipPersistence: routing.recordUserMessageInDb === false,
  };
}

export async function persistOnboardingChatTurn(
  user_id: string,
  memoryId: string,
  latestUserMessage: string,
  assistantText: string,
) {
  const trimmedUserText = latestUserMessage.trim();
  const trimmedAssistantText = assistantText.trim();

  let createdCount = 0;

  if (!isEmpty(trimmedUserText)) {
    const lastUserMessage = await Message.findOne({
      user: user_id,
      memory: memoryId,
      role: 'user',
    }).sort({created_at: -1});

    if (!lastUserMessage || lastUserMessage.text !== trimmedUserText) {
      await Message.create({
        user: user_id,
        memory: memoryId,
        role: 'user',
        attatchments: [],
        text: trimmedUserText,
      });
      createdCount += 1;
    }
  }

  if (!isEmpty(trimmedAssistantText)) {
    await Message.create({
      user: user_id,
      memory: memoryId,
      role: 'ai',
      text: trimmedAssistantText,
    });
    createdCount += 1;
  }

  if (createdCount > 0) {
    await Memory.findByIdAndUpdate(memoryId, {
      $inc: {message_count: createdCount},
      $set: {last_active: dayjs().toDate()},
    });
  }
}
