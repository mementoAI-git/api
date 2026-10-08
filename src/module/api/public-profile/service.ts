import {randomUUID} from 'node:crypto';
import User from '../../database/model/user';
import Persona from '../../database/model/persona';
import PublicProfile, {
  IPublicProfile,
} from '../../database/model/public-profile';
import {BACKEND_URL} from '../../../utils/config';
import {
  BadRequestException,
  NotFoundException,
} from '../../../utils/service-error';

export const PROFILE_TOKEN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ProfileView = Pick<
  IPublicProfile,
  'token' | 'display_name' | 'bio' | 'picture_url'
>;

// Explicit publication snapshot: never serialize a User or Persona document publicly.
export async function publishProfile(userId: string): Promise<{token: string}> {
  const user = await User.findOne({_id: userId, deleted: {$ne: true}})
    .select('first_name last_name picture')
    .lean();
  if (!user) throw new NotFoundException('User not found');
  const persona = await Persona.findOne({user: userId})
    .select('self_description')
    .lean();
  const snapshot = {
    display_name:
      [user.first_name, user.last_name]
        .filter(Boolean)
        .join(' ')
        .trim()
        .slice(0, 160) || 'Memento member',
    bio: (persona?.self_description || '').slice(0, 500),
    picture_url:
      user.picture && /^https?:\/\//.test(user.picture)
        ? user.picture
        : user.picture && BACKEND_URL
          ? `${BACKEND_URL.replace(/\/$/, '')}/files/${encodeURIComponent(user.picture)}`
          : null,
  };
  const update = {
    $set: snapshot,
    $setOnInsert: {user: userId, token: randomUUID()},
  };
  let profile;
  try {
    profile = await PublicProfile.findOneAndUpdate({user: userId}, update, {
      upsert: true,
      new: true,
    }).lean();
  } catch (error) {
    // Concurrent shares must reuse the owner's single public link.
    if ((error as {code?: number}).code !== 11000) throw error;
    profile = await PublicProfile.findOneAndUpdate(
      {user: userId},
      {$set: snapshot},
      {new: true},
    ).lean();
  }
  if (!profile) throw new NotFoundException('Profile not found');
  return {token: profile.token};
}

export async function getPublicProfile(token: string): Promise<ProfileView> {
  if (!PROFILE_TOKEN.test(token))
    throw new BadRequestException('Invalid profile link');
  const profile = await PublicProfile.findOne({token}).lean();
  if (
    !profile ||
    !(await User.exists({_id: profile.user, deleted: {$ne: true}}))
  ) {
    throw new NotFoundException('Profile not found');
  }
  return {
    token: profile.token,
    display_name: profile.display_name,
    bio: profile.bio,
    picture_url: profile.picture_url,
  };
}

export async function revokeProfile(userId: string): Promise<void> {
  await PublicProfile.deleteOne({user: userId});
}
