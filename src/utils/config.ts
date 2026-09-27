import 'dotenv/config';
import os from 'os';

export const JWT_SECRET = process.env.JWT_SECRET;

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const IS_DEV_ENV = ['development', 'dev', 'local'].includes(
  NODE_ENV.toLowerCase(),
);
export const MEMENTO_ENV = process.env.MEMENTO_ENV?.toLowerCase();
export const IS_DEV_DEPLOYMENT = MEMENTO_ENV
  ? MEMENTO_ENV === 'dev'
  : IS_DEV_ENV;
export const PORT = process.env.PORT || 5000;
export const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '10mb';
export const MAX_UPLOAD_FILES = Number(process.env.MAX_UPLOAD_FILES || 5);
export const UPLOAD_FILE_SIZE_LIMIT_MB = Number(
  process.env.UPLOAD_FILE_SIZE_LIMIT_MB || 15,
);
export const STORAGE_LIMIT_FREE_BYTES = Number(
  process.env.STORAGE_LIMIT_FREE_BYTES || 200 * 1024 ** 2,
);
export const STORAGE_LIMIT_PRO_BYTES = Number(
  process.env.STORAGE_LIMIT_PRO_BYTES || 10 * 1024 ** 3,
);
export const STORAGE_LIMIT_LEGACY_BYTES = Number(
  process.env.STORAGE_LIMIT_LEGACY_BYTES || STORAGE_LIMIT_PRO_BYTES,
);
export const STORAGE_RESERVATION_TTL_SECONDS = Number(
  process.env.STORAGE_RESERVATION_TTL_SECONDS || 15 * 60,
);
export const STORAGE_QUOTA_ENFORCEMENT_ENABLED =
  process.env.STORAGE_QUOTA_ENFORCEMENT_ENABLED !== undefined
    ? process.env.STORAGE_QUOTA_ENFORCEMENT_ENABLED === 'true'
    : !IS_PRODUCTION;
export const CORS_ALLOWED_ORIGINS = (
  process.env.CORS_ALLOWED_ORIGINS ||
  'http://localhost:5173,https://app.mymemento.io,https://dev.mymemento.io,https://www.mymemento.io,https://mymemento.io'
)
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
export const AI_SLO_ERROR_RATE_MAX = Number(
  process.env.AI_SLO_ERROR_RATE_MAX || 0.03,
);
export const AI_SLO_FALLBACK_RATE_MAX = Number(
  process.env.AI_SLO_FALLBACK_RATE_MAX || 0.25,
);
export const AI_SLO_P95_LATENCY_MS_MAX = Number(
  process.env.AI_SLO_P95_LATENCY_MS_MAX || 6000,
);

export const MONGODB_URL = process.env.MONGODB_URL;
export const REDIS_URL = process.env.REDIS_URL;

export const MAIL_HOST = process.env.MAIL_HOST;
export const MAIL_PORT = process.env.MAIL_PORT || 465;
export const MAIL_USER = process.env.MAIL_USER;
export const MAIL_PASSWORD = process.env.MAIL_PASSWORD;

export const GOOGLE_ID = process.env.GOOGLE_ID;
export const GOOGLE_SECRET = process.env.GOOGLE_SECRET;

export const META_ID = process.env.META_ID;
export const META_SECRET = process.env.META_SECRET;

export const APPLE_ID = process.env.APPLE_ID;
export const APPLE_SECRET = process.env.APPLE_SECRET;

export const STORAGE_BASE_URL = process.env.STORAGE_BASE_URL;
export const STORAGE_API_KEY = process.env.STORAGE_API_KEY;

export const FRONTEND_URL = process.env.FRONTEND_URL;
export const BACKEND_URL = process.env.BACKEND_URL;
export const FILE_URL_SIGNING_KEYS = process.env.FILE_URL_SIGNING_KEYS || '';
export const FILE_URL_TTL_SECONDS = Number(
  process.env.FILE_URL_TTL_SECONDS || 3600,
);

export const GEMINI_API_KEY_ALT = process.env.GEMINI_API_KEY_ALT;
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const GEMINI_API_KEY_EFFECTIVE = GEMINI_API_KEY_ALT || GEMINI_API_KEY;

// ── Gemini model versions (single source of truth) ──────────────────
// Change the model version HERE and every service picks it up automatically.
export const GEMINI_MODEL_VERSION =
  process.env.GEMINI_MODEL_VERSION || 'gemini-2.5-flash';
export const GEMINI_LIVE_MODEL_VERSION =
  process.env.GEMINI_LIVE_MODEL_VERSION ||
  'gemini-2.5-flash-native-audio-preview-09-2025';

export const VOICE_PROVIDER_DEFAULT = (
  process.env.VOICE_PROVIDER_DEFAULT || 'gemini'
).toLowerCase();
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
export const ELEVENLABS_BASE_URL =
  process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io/v1';
export const ELEVENLABS_TTS_MODEL_ID =
  process.env.ELEVENLABS_TTS_MODEL_ID || 'eleven_multilingual_v2';
export const ASR_PROVIDER = (
  process.env.ASR_PROVIDER || 'gemini'
).toLowerCase();
export const ASR_FALLBACK_PROVIDER = (
  process.env.ASR_FALLBACK_PROVIDER || 'gemini_fallback'
).toLowerCase();
export const ASR_GEMINI_PRIMARY_MODEL =
  process.env.ASR_GEMINI_PRIMARY_MODEL || GEMINI_MODEL_VERSION;
export const ASR_GEMINI_FALLBACK_MODEL =
  process.env.ASR_GEMINI_FALLBACK_MODEL || ASR_GEMINI_PRIMARY_MODEL;
export const ASR_SHADOW_ENABLED = process.env.ASR_SHADOW_ENABLED === 'true';
export const ASR_SHADOW_PROVIDER = (
  process.env.ASR_SHADOW_PROVIDER || ''
).toLowerCase();
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
export const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
export const OPENROUTER_APP_NAME =
  process.env.OPENROUTER_APP_NAME || 'Memento API';
export const OPENROUTER_SITE_URL =
  process.env.OPENROUTER_SITE_URL || FRONTEND_URL || 'http://localhost:5173';
export const OPENROUTER_CRITICAL_ENABLED =
  process.env.OPENROUTER_CRITICAL_ENABLED !== 'false';
export const GROQ_API_KEY = process.env.GROQ_API_KEY;

// DeepSeek direct API (OpenAI-compatible)
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
export const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
export const DEEPSEEK_MODEL_CHAT_PRIMARY =
  process.env.DEEPSEEK_MODEL_CHAT_PRIMARY || 'deepseek-chat';
export const DEEPSEEK_MODEL_CHAT_FALLBACK =
  process.env.DEEPSEEK_MODEL_CHAT_FALLBACK || 'deepseek-reasoner';
export const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
export const GROQ_MODEL_CHAT_PRIMARY =
  process.env.GROQ_MODEL_CHAT_PRIMARY || 'llama-3.3-70b-versatile';
export const GROQ_MODEL_CHAT_FALLBACK =
  process.env.GROQ_MODEL_CHAT_FALLBACK || 'llama-3.1-8b-instant';
export const GROQ_FAST_MODE_ENABLED =
  process.env.GROQ_FAST_MODE_ENABLED !== 'false';
export const GROQ_FAST_MODE_MAX_INPUT_CHARS = Number(
  process.env.GROQ_FAST_MODE_MAX_INPUT_CHARS || 320,
);
export const GROQ_MODEL_CHAT_FAST_PRIMARY =
  process.env.GROQ_MODEL_CHAT_FAST_PRIMARY || 'llama-3.1-8b-instant';
export const GROQ_MODEL_CHAT_FAST_FALLBACK =
  process.env.GROQ_MODEL_CHAT_FAST_FALLBACK || GROQ_MODEL_CHAT_PRIMARY;

export const OR_MODEL_CHAT_PRIMARY =
  process.env.OR_MODEL_CHAT_PRIMARY || 'google/gemma-4-26b-a4b-it';
export const OR_MODEL_CHAT_FALLBACK =
  process.env.OR_MODEL_CHAT_FALLBACK || 'google/gemma-4-26b-a4b-it:free';
export const OR_MODEL_TAGS_PRIMARY =
  process.env.OR_MODEL_TAGS_PRIMARY || 'google/gemma-4-26b-a4b-it:free';
export const OR_MODEL_TAGS_FALLBACK =
  process.env.OR_MODEL_TAGS_FALLBACK || 'google/gemma-4-26b-a4b-it';
export const OR_MODEL_TRANSCRIPTION_PRIMARY =
  process.env.OR_MODEL_TRANSCRIPTION_PRIMARY || '';
export const OR_MODEL_TRANSCRIPTION_FALLBACK =
  process.env.OR_MODEL_TRANSCRIPTION_FALLBACK || '';
export const PROMPT_VERSION_OVERRIDES: Record<string, string> = {
  chat_primary: process.env.PROMPT_VERSION_CHAT_PRIMARY || '',
  chat_bootstrap: process.env.PROMPT_VERSION_CHAT_BOOTSTRAP || '',
  onboarding_chat: process.env.PROMPT_VERSION_ONBOARDING_CHAT || '',
  tags_generate: process.env.PROMPT_VERSION_TAGS_GENERATE || '',
  transcription: process.env.PROMPT_VERSION_TRANSCRIPTION || '',
};

// Multi-provider AI router (all optional — only providers with keys are registered)
export const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
export const NVIDIA_NIM_API_KEY = process.env.NVIDIA_NIM_API_KEY;
export const SAMBANOVA_API_KEY = process.env.SAMBANOVA_API_KEY;
export const CLOUDFLARE_AI_API_KEY = process.env.CLOUDFLARE_AI_API_KEY;
export const CLOUDFLARE_AI_ACCOUNT_ID = process.env.CLOUDFLARE_AI_ACCOUNT_ID;

export const DEV_MAILS = process.env.DEV_MAILS?.split(',') || [];
export const SUPPORT_MAILS = process.env.SUPPORT_MAILS?.split(',') || [];

export const TEMP_PATH = process.env.TEMP_PATH ?? os.tmpdir();
export const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';

export const CLOUDFLARE_R2_ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
export const CLOUDFLARE_R2_ACCESS_KEY_ID =
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
export const CLOUDFLARE_R2_SECRET_ACCESS_KEY =
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
export const CLOUDFLARE_R2_BUCKET_NAME =
  process.env.CLOUDFLARE_R2_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
export const AWS_REGION = process.env.AWS_REGION || 'auto';
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
export const AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

export const HETZNER_ENDPOINT = process.env.HETZNER_ENDPOINT;
export const HETZNER_ACCESS_KEY_ID = process.env.HETZNER_ACCESS_KEY_ID;
export const HETZNER_SECRET_ACCESS_KEY = process.env.HETZNER_SECRET_ACCESS_KEY;
export const HETZNER_BUCKET_NAME = process.env.HETZNER_BUCKET_NAME;

/** Optional: legacy GCS reads / backup worker only (uploads use Cloudinary). */
export const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;
export const GCS_PROJECT_ID = process.env.GCS_PROJECT_ID;
export const GCS_KEY_FILENAME = process.env.GCS_KEY_FILENAME;

export const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
export const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
export const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

export const SUPERMEMORY_API_KEY = process.env.SUPERMEMORY_API_KEY;

export const TALLY_WEBHOOK_SECRET = process.env.TALLY_WEBHOOK_SECRET;
export const TALLY_WEBHOOK_ENABLED =
  process.env.TALLY_WEBHOOK_ENABLED === 'true';
export const TALLY_WEBHOOK_RATE_LIMIT_PER_MINUTE = Number(
  process.env.TALLY_WEBHOOK_RATE_LIMIT_PER_MINUTE || 30,
);
export const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
export const POLAR_WEBHOOK_SECRET_DEV = process.env.POLAR_WEBHOOK_SECRET_DEV;
export const POLAR_WEBHOOK_SECRET_PROD = process.env.POLAR_WEBHOOK_SECRET_PROD;
export const POLAR_WEBHOOK_SECRET =
  process.env.POLAR_WEBHOOK_SECRET ||
  (IS_PRODUCTION ? POLAR_WEBHOOK_SECRET_PROD : POLAR_WEBHOOK_SECRET_DEV);
export const POLAR_BASE_URL =
  process.env.POLAR_BASE_URL || 'https://api.polar.sh/v1';
export const POLAR_PRODUCT_PRO_MONTHLY = process.env.POLAR_PRODUCT_PRO_MONTHLY;
export const POLAR_PRODUCT_PRO_ANNUAL = process.env.POLAR_PRODUCT_PRO_ANNUAL;
export const POLAR_PRODUCT_LEGACY_MONTHLY =
  process.env.POLAR_PRODUCT_LEGACY_MONTHLY;
export const POLAR_PRODUCT_LEGACY_ANNUAL =
  process.env.POLAR_PRODUCT_LEGACY_ANNUAL;
export const POLAR_PRODUCT_LEGACY_LIFETIME =
  process.env.POLAR_PRODUCT_LEGACY_LIFETIME;
export const APPLE_IAP_NOTIFICATIONS_ENABLED =
  process.env.APPLE_IAP_NOTIFICATIONS_ENABLED === 'true';
export const GOOGLE_PLAY_RTDN_ENABLED =
  process.env.GOOGLE_PLAY_RTDN_ENABLED === 'true';
export const GOOGLE_PLAY_RTDN_AUDIENCE = process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
export const GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;

export const DISCORD_FEEDBACK_WEBHOOK_URL =
  process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
export const FEATURE_FLAG_ENVIRONMENT =
  process.env.FEATURE_FLAG_ENVIRONMENT || NODE_ENV;
export const FEATURE_FLAGS_ADMIN_EMAILS =
  process.env.FEATURE_FLAGS_ADMIN_EMAILS?.split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean) || [];
export const BULL_BOARD_ENABLED = process.env.BULL_BOARD_ENABLED === 'true';
export const SENTRY_TUNNEL_ENABLED =
  process.env.SENTRY_TUNNEL_ENABLED === 'true';
export const SENTRY_TUNNEL_ALLOWED_HOSTS =
  process.env.SENTRY_TUNNEL_ALLOWED_HOSTS?.split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean) || [];
export const SENTRY_TUNNEL_ALLOWED_PROJECT_IDS =
  process.env.SENTRY_TUNNEL_ALLOWED_PROJECT_IDS?.split(',')
    .map(value => value.trim())
    .filter(Boolean) || [];
export const SENTRY_TUNNEL_MAX_BYTES = Number(
  process.env.SENTRY_TUNNEL_MAX_BYTES || 1024 * 1024,
);
export const SENTRY_TUNNEL_TIMEOUT_MS = Number(
  process.env.SENTRY_TUNNEL_TIMEOUT_MS || 5000,
);
export const SENTRY_TUNNEL_RATE_LIMIT_PER_MINUTE = Number(
  process.env.SENTRY_TUNNEL_RATE_LIMIT_PER_MINUTE || 60,
);
// WebAuthn / Passkeys
export const WEBAUTHN_RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
export const WEBAUTHN_RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Memento';
export const WEBAUTHN_ORIGINS = (
  process.env.WEBAUTHN_ORIGINS ||
  process.env.WEBAUTHN_ORIGIN ||
  'http://localhost:5173'
)
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);
