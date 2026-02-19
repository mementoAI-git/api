import {
  APPLE_ID,
  APPLE_SECRET,
  FRONTEND_URL,
  GOOGLE_ID,
  GOOGLE_SECRET,
  META_ID,
  META_SECRET,
} from './config';

const OAUTH_REDIRECT_URL = `${FRONTEND_URL}/oauth/callback`;

// Supported file types for uploads
export const SUPPORTED_FILE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/heic',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'audio/webm',
  'audio/mpeg', // .mp3
  'audio/wav', // .wav
  'audio/ogg', // .ogg
  'audio/aac', // .aac
  'audio/flac', // .flac
  'application/pdf',
  'audio/mpeg',
  'audio/mp3',
  'audio/mpeg3',
  'audio/x-mpeg-3',
] as const;

export const SENSITIVE_FIELDS = [
  'password',
  'old_password',
  'new_password',
  'authorization',
  'access_token',
  "token",
  'refresh_token',
];

export const OAUTH_PROVIDERS = {
  google: {
    authoriation_url: `https://accounts.google.com/o/oauth2/auth?client_id=${GOOGLE_ID}&scope=email profile openid`,
    token_url: 'https://oauth2.googleapis.com/token',
    userinfo_url: 'https://www.googleapis.com/oauth2/v2/userinfo',
    client_id: GOOGLE_ID,
    client_secret: GOOGLE_SECRET,
    redirect_uri: `${OAUTH_REDIRECT_URL}/google`,
    fields: ['email', 'given_name', 'family_name'],
  },
  facebook: {
    authoriation_url: `https://www.facebook.com/v19.0/dialog/oauth?client_id=${META_ID}&scope=email,public_profile`,
    token_url: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userinfo_url: 'https://graph.facebook.com/me?fields=id,name,email,picture',
    client_id: META_ID,
    client_secret: META_SECRET,
    redirect_uri: `${OAUTH_REDIRECT_URL}/facebook`,
  },
  apple: {
    authoriation_url: `https://appleid.apple.com/auth/authorize?client_id=${APPLE_ID}&scope=email name`,
    token_url: 'https://appleid.apple.com/auth/token',
    userinfo_url: '',
    client_id: APPLE_ID,
    client_secret: APPLE_SECRET,
    redirect_uri: `${OAUTH_REDIRECT_URL}/apple`,
  },
};

export const queueNames = {
  summarization: {
    id: 'summarization',
    jobs: {
      conversation: 'conversation',
      persona: 'persona',
      story: 'story',
      memories: 'memories',
    }
  },
  system: {
    id: 'system',
    jobs: {
      resetStreak: 'reset-streak',
      backupFiles: 'backup-files',
      scheduleCapsuleReveals: 'schedule-capsule-reveals',
      revealCapsules: 'reveal-capsules',
    }
  }
}

export const MEMORY_STATUS = {
  DRAFT: "draft",
  SAVE: "save",
  QUEUED: "queued",
  ON_CHAIN: "on_chain",
  DELETED: "deleted",
}

export const PERSONA_INSIGHT_FIELDS = [
  'important_notes',
  'key_preferences',
  'emotional_state_trends',
  'goals_and_aspirations'
] as const;

export const STORAGE_PROVIDERS = {
  s3: 's3',
  gcs: 'gcs',
  cloudinary: 'cloudinary',
} as const;

export const DEFAULT_STORAGE_PROVIDER = STORAGE_PROVIDERS.gcs;