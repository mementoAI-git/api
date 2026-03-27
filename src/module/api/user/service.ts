import bcrypt from 'bcrypt';
import dayjs from 'dayjs';
import User, { IUser } from '../../database/model/user';
import Persona, { IPersona } from '../../database/model/persona';
import Memory from '../../database/model/memory';
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
import mail from '../../mail';
import { OnboardingBody } from './dto';

export async function setPassword(payload: ISetPassword, user_id: string) {
  const { new_password, old_password } = payload;
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  let is_match = await bcrypt.compare(old_password, `${user?.password}`);
  if (!is_match) {
    throw new BadRequestException('Incorrect password');
  }

  const password = await hashPassword(new_password);
  await user.updateOne({ password });

  return { message: 'Password updated successfully', data: null };
}

export async function getProfile(user_id: string) {
  const user = await User.findById(user_id)
    .select('-password -providers -two_factor.secret -context')
    .lean();
  if (!user) {
    throw new NotFoundException('User not found', null);
  }

  const pending_insights_count = await PendingInsight.countDocuments({
    user: user_id,
  });

  // Manually compute virtual fields stripped by .lean()
  const fullname = concatStrings(user.first_name, user.last_name, ' ').trim();

  return {
    message: 'User profile retrieved successfully',
    data: {
      ...user,
      fullname: fullname || null,
      pending_insights_count,
    },
  };
}

export async function getPersona(user_id: string) {
  const persona = await Persona.findOne({ user: user_id }).lean();

  return {
    message: 'Persona retrieved successfully',
    data: persona,
  };
}

export async function updateProfile(payload: Partial<IUser>, user_id: string) {
  const user = await User.findById(user_id).select('-password -providers');
  if (!user) {
    throw new NotFoundException('User not found', null);
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
    'location',
  ]);

  const updatePayload = Object.entries(payload).reduce((acc, p) => {
    if (updateableFields.has(p[0])) {
      acc[p[0]] = p[1];
    }
    return acc;
  }, {});

  const data = await User.findByIdAndUpdate(
    user_id,
    updatePayload,
    { new: true }
  )
    .select('-password -providers -public_key -private_key')

  return { message: 'User profile updated successfully', data: null };
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
  return { message: 'Streak updated successfully', data };
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

  const { name, type, size } = await storage.uploadFile(payload[0], user_id);

  const file = await File.create({
    name,
    // base64: data.toString("base64"),
    size,
    user: user_id,
    type,
  });

  if (user.picture) {
    await File.deleteOne({ name: user.picture });
  }

  await user.updateOne({ picture: file.name });

  return { message: 'Profile pics uploaded successfully', data: file };
}

export async function setup2FA(user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  const secret = speakeasy.generateSecret({
    name: `Memento (${user.email})`,
  });

  await user.updateOne({ 'two_factor.secret': secret.base32 });
  const qrcode = await Qr.toDataURL(secret.otpauth_url);

  return {
    data: { url: secret.otpauth_url, qrcode, secret: secret.base32 },
    message:
      '2FA setup successful. Scan the QR code with your Authenticator app.',
  };
}

//verify time-base one-time-password
export async function verifyTOTP({ token }: IVerifyTOTP, user_id: string) {
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
    throw new BadRequestException('Invalid token', { verified });
  }

  if (!user?.two_factor?.enabled) {
    await user.updateOne({ 'two_factor.enabled': true });
  }

  return { data: { verified }, message: 'Verification successful' };
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

  return { data: null, message: '2FA disabled successfully' };
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
    if (Array.isArray(payload?.current_priority) && payload.current_priority.length > 0) {
      personaData.current_priority = payload.current_priority;
    }
    if (
      Array.isArray(payload?.join_reasons) &&
      payload.join_reasons.length > 0
    ) {
      personaData.join_reasons = payload.join_reasons;
    }

    await withTransaction(async (session) => {
      if (Object.keys(personaData).length > 0) {
        await Persona.findOneAndUpdate(
          { user: user_id },
          personaData,
          { upsert: true, session }
        );
      }

      if (!isEmpty(payload?.dob)) {
        user.dob = payload.dob;
      }

      user.onboarding_status = 'completed';
      await user.save({ session });

    });
  }

  mail.sendWelcome({
    email: user.email,
    name: user?.nickname || user?.first_name || user?.last_name || '',
  });

  return { data: null, message: 'Onboarding completed successfully' };
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

  const persona = await Persona.findOneAndUpdate(
    { user: user_id },
    updateDoc,
    { upsert: true, new: true }
  );
  if (!persona) {
    throw new NotFoundException('Persona not found');
  }

  return { message: 'User context updated successfully', data: null };
}

export async function deleteUser(user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  // Mark user as deleted (soft delete) and clear refresh token
  await User.findByIdAndUpdate(user_id, {
    deleted: true,
    refresh_token: null,
  });

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
    prompt: { $exists: true, $ne: null },
  });

  // Count uploaded stories (memories with type "story" and status "save" or higher)
  const stories_count = await Memory.countDocuments({
    user: user_id,
    type: 'story',
    status: { $in: ['save', 'queued', 'on_chain'] },
  });

  const pending_insights_count = await PendingInsight.countDocuments({
    user: user_id,
  });

  const stats = {
    streak_count,
    reflections_count,
    stories_count,
    pending_insights_count,
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
    'age_range'
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
  ]);

  const personaUpdate = Object.entries(payload).reduce((acc, p) => {
    if (
      allowedPersonaFields.has(p[0]) &&
      Array.isArray(p[1]) &&
      p[1].length > 0
    ) {
      acc[p[0]] = p[1];
    }
    return acc;
  }, {});

  await withTransaction(async (session) => {
    await User.findByIdAndUpdate(
      user_id, { ...updatePayload, onbaorded: true }, { session });
    if (Object.keys(personaUpdate).length > 0) {
      await Persona.findOneAndUpdate(
        { user: user_id },
        { $set: personaUpdate },
        { upsert: true, session }
      );
    }
  });

  return { message: 'Onboarding saved successfully', data: null };
}

export async function skipOnboarding(user_id: string) {
  const user = await User.findById(user_id);
  if (!user) {
    throw new NotFoundException('User not found');
  }

  if (user.onboarding_status === 'completed') {
    return {
      message: 'Onboarding already completed',
      data: { onboarding_status: 'completed' as const },
    };
  }

  await User.findByIdAndUpdate(user_id, { onboarding_status: 'skipped' });

  return {
    message: 'Onboarding skipped',
    data: { onboarding_status: 'skipped' as const },
  };
}

export async function getOnboardingDetails(user_id: string) {
  const user = await User.findById(user_id).lean();
  if (!user) {
    throw new NotFoundException('User not found');
  }
  const persona = await Persona.findOne({ user: user_id }).lean();
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
      },
      persona: {
        join_reasons: persona?.join_reasons ?? [],
        audience: persona?.audience ?? [],
        current_priority,
        communication_style: persona?.communication_style ?? [],
      },
    },
  };
}
