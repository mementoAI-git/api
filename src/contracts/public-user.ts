import {BACKEND_URL} from '../utils/config';
export type PublicPasskey = {
  credential_id: string;
  device_name: string;
  created_at?: Date | string;
};

export type PublicUser = {
  id: string;
  _id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  fullname: string | null;
  nickname?: string;
  gender?: string;
  phone_number?: string;
  dob?: Date | string;
  country?: string;
  onboarding_status: string;
  onboarding_step_reached?: number | null;
  skipped_deep_personalization?: boolean;
  onboarded: boolean;
  providers: string[];
  preferences: Record<string, unknown>;
  verified: boolean;
  two_factor: {enabled: boolean};
  passkeys: PublicPasskey[];
  banner?: string | null;
  banner_preset?: number;
  banner_position?: {x: number; y: number};
  banner_url?: string | null;
  picture?: string;
  picture_url?: string;
  location?: string;
  age_range?: string;
  last_seen?: string;
  last_task_date?: string;
  streak?: number;
  bg_music?: string | null;
  chat_voice?: string | null;
  chat_voice_provider?: string;
  newsletter_subscriber: boolean;
  storage_limit?: number;
  primary_conversation_id?: string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
};

export const PUBLIC_USER_SELECT = [
  'email',
  'first_name',
  'last_name',
  'nickname',
  'gender',
  'phone_number',
  'dob',
  'country',
  'onboarding_status',
  'onboarding_step_reached',
  'skipped_deep_personalization',
  'providers',
  'preferences',
  'verified',
  'two_factor.enabled',
  'passkeys.credential_id',
  'passkeys.device_name',
  'passkeys.created_at',
  'banner',
  'banner_preset',
  'banner_position',
  'picture',
  'location',
  'age_range',
  'last_seen',
  'last_task_date',
  'streak',
  'bg_music',
  'chat_voice',
  'chat_voice_provider',
  'newsletter_subscriber',
  'storage_limit',
  'primary_conversation_id',
  'created_at',
  'updated_at',
].join(' ');

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function nullableStringValue(value: unknown): string | null | undefined {
  return value === null ? null : stringValue(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function dateValue(value: unknown): Date | string | undefined {
  return value instanceof Date || typeof value === 'string' ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toPublicUser(input: unknown): PublicUser {
  const source = recordValue(input);
  const id = String(source._id ?? source.id ?? '');
  const firstName = stringValue(source.first_name);
  const lastName = stringValue(source.last_name);
  const computedFullname = [firstName, lastName].filter(Boolean).join(' ');
  const onboardingStatus = stringValue(source.onboarding_status) || 'never';
  const twoFactor = recordValue(source.two_factor);
  const passkeys = Array.isArray(source.passkeys)
    ? source.passkeys.flatMap(value => {
        const passkey = recordValue(value);
        const credentialId = stringValue(passkey.credential_id);
        if (!credentialId) return [];
        return [
          {
            credential_id: credentialId,
            device_name: stringValue(passkey.device_name) || 'Unknown device',
            created_at: dateValue(passkey.created_at),
          },
        ];
      })
    : [];

  return {
    id,
    _id: id,
    email: stringValue(source.email),
    first_name: firstName,
    last_name: lastName,
    fullname: stringValue(source.fullname) || computedFullname || null,
    nickname: stringValue(source.nickname),
    gender: stringValue(source.gender),
    phone_number: stringValue(source.phone_number),
    dob: dateValue(source.dob),
    country: stringValue(source.country),
    onboarding_status: onboardingStatus,
    onboarding_step_reached:
      source.onboarding_step_reached === null
        ? null
        : numberValue(source.onboarding_step_reached),
    skipped_deep_personalization:
      typeof source.skipped_deep_personalization === 'boolean'
        ? source.skipped_deep_personalization
        : undefined,
    onboarded: onboardingStatus === 'completed',
    providers: Array.isArray(source.providers)
      ? source.providers.filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
    preferences: recordValue(source.preferences),
    verified: source.verified === true,
    two_factor: {enabled: twoFactor.enabled === true},
    passkeys,
    banner: nullableStringValue(source.banner),
    banner_preset: numberValue(source.banner_preset),
    banner_position: source.banner_position as
      | {x: number; y: number}
      | undefined,
    banner_url:
      source.banner && BACKEND_URL
        ? `${BACKEND_URL}/files/${source.banner}`
        : null,
    picture: stringValue(source.picture),
    picture_url: stringValue(source.picture_url),
    location: stringValue(source.location),
    age_range: stringValue(source.age_range),
    last_seen: stringValue(source.last_seen),
    last_task_date: stringValue(source.last_task_date),
    streak: numberValue(source.streak),
    bg_music: nullableStringValue(source.bg_music),
    chat_voice: nullableStringValue(source.chat_voice),
    chat_voice_provider: stringValue(source.chat_voice_provider),
    newsletter_subscriber: source.newsletter_subscriber === true,
    storage_limit: numberValue(source.storage_limit),
    primary_conversation_id: nullableStringValue(
      source.primary_conversation_id,
    ),
    created_at: dateValue(source.created_at),
    updated_at: dateValue(source.updated_at),
  };
}
