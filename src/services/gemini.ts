import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "../utils/config";

const gemini = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export const GEMINI_MODEL = "gemini-2.0-flash";
export default gemini 