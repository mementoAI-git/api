import {GoogleGenAI} from '@google/genai';
import {
  GEMINI_API_KEY_EFFECTIVE,
  GEMINI_MODEL_VERSION,
  GEMINI_LIVE_MODEL_VERSION,
} from '../utils/config';

const gemini = new GoogleGenAI({apiKey: GEMINI_API_KEY_EFFECTIVE});

// Client for ephemeral token generation (requires v1alpha API version)
export const geminiAuthClient = new GoogleGenAI({
  apiKey: GEMINI_API_KEY_EFFECTIVE,
  httpOptions: {apiVersion: 'v1alpha'},
});

export const GEMINI_MODEL = GEMINI_MODEL_VERSION;
export const GEMINI_LIVE_MODEL = GEMINI_LIVE_MODEL_VERSION;

export default gemini;

