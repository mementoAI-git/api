import 'dotenv/config';
import os from "os"

export const JWT_SECRET = process.env.JWT_SECRET

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT = process.env.PORT || 5000;

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

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export const DEV_MAILS = process.env.DEV_MAILS?.split(',') || [];

export const TEMP_PATH = process.env.TEMP_PATH ?? os.tmpdir()

// AWS S3 Configuration
export const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
export const AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;