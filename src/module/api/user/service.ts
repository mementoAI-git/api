import bcrypt from 'bcrypt';
import dayjs from 'dayjs';
import User, { IUser } from '../../database/model/user';
import Persona, { IPersona } from '../../database/model/persona';
import Memory from '../../database/model/memory';
import {
  hashPassword,
  isEmpty,
  processFile,
  withTransaction
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
import speakeasy from 'speakeasy';
import Qr from 'qrcode';
import mail from '../../mail';

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
    .select('-password -providers -two_factor.secret')
  if (!user) {
    throw new NotFoundException('User not found', null);
  }

  return { message: 'User profile retrieved successfully', data: user };
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

  return { message: 'User profile updated successfully', data };
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

  const { name, type, size } = await processFile(payload[0], user_id);

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
    if (!isEmpty(payload?.current_priority)) {
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

      user.onbaorded = true;
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
  for (const key of allowed) {
    const value = (payload as any)[key];
    if (!isEmpty(value)) {
      updateDoc[key] = value;
    }
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

  const stats = {
    streak_count,
    reflections_count,
    stories_count,
  };

  return {
    data: stats,
    message: 'User statistics retrieved successfully',
  };
}

export async function resetStreaksForInactiveUsers() {
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

  // Find all users where last_task_date is more than 1 day ago or is null
  // Reset their streak to 0
  const result = await User.updateMany(
    {
      $or: [
        { last_task_date: { $lt: yesterday } },
        { last_task_date: null },
        { last_task_date: { $exists: false } },
      ],
    },
    {
      $set: { streak: 0 },
    },
  );

  return {
    message: 'Streaks reset for inactive users',
    data: {
      usersUpdated: result.modifiedCount,
      totalMatched: result.matchedCount,
    },
  };
}

export async function migrateUserContextToPersona() {

  // Find all users that have a context field (using raw MongoDB query)
  const usersWithContext = await User.find({
    context: { $exists: true, $ne: null }
  } as any).lean();

  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: Array<{ user_id: string; error: string }> = [];

  for (const user of usersWithContext) {
    try {
      const context = (user as any).context as Omit<IPersona, "user">;

      // Check if context has any meaningful data
      const hasData =
        (context.important_notes && context.important_notes.length > 0) ||
        (context.key_preferences && context.key_preferences.length > 0) ||
        context.conversation_history_summary ||
        (context.emotional_state_trends && context.emotional_state_trends.length > 0) ||
        (context.goals_and_aspirations && context.goals_and_aspirations.length > 0) ||
        context.self_description ||
        context.current_priority ||
        (context.join_reasons && context.join_reasons.length > 0);

      if (!hasData) {
        skipped++;
        continue;
      }

      // Check if persona already exists for this user
      const existingPersona = await Persona.findOne({ user: user._id });
      if (existingPersona) {
        skipped++;
        continue;
      }

      // Create persona with context data
      await Persona.create({
        user: user._id,
        important_notes: context.important_notes || [],
        key_preferences: context.key_preferences || [],
        conversation_history_summary: context.conversation_history_summary || undefined,
        emotional_state_trends: context.emotional_state_trends || [],
        goals_and_aspirations: context.goals_and_aspirations || [],
        self_description: context.self_description || undefined,
        current_priority: context.current_priority || undefined,
        join_reasons: context.join_reasons || [],
      });

      migrated++;
    } catch (error) {
      errors++;
      errorDetails.push({
        user_id: (user._id as any).toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return {
    message: 'Migration completed',
    data: {
      totalUsersWithContext: usersWithContext.length,
      migrated,
      skipped,
      errors,
      errorDetails: errors > 0 ? errorDetails : undefined,
    },
  };
}
