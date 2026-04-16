import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "../utils/config";

const gemini = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Client for ephemeral token generation (requires v1alpha API version)
export const geminiAuthClient = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
  httpOptions: { apiVersion: 'v1alpha' }
});


export const GEMINI_MODEL = "gemini-2.5-flash";
export const GEMINI_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";

export default gemini;