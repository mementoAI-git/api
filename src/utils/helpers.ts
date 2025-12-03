import { Response, Request } from "express";
import { check, validationResult } from "express-validator";
import bcrypt from "bcrypt"
import * as jwt from 'jsonwebtoken';
import { ec } from "elliptic"

import { SessionTimeout, UnauthorizedException, UnprocessableContent } from "./service-error";
import { JWT_SECRET } from "./config";
import { IPagination } from "./interface";
import dayjs from "dayjs";
import { FilterQuery } from "mongoose";
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { getAudioDurationInSeconds } from 'get-audio-duration';
import { IFile } from "../module/database/model/file";
import { uploadToS3 } from "../module/media";
import { SUPPORTED_FILE_TYPES } from "./constant";

export const random = (len: number = 6, type: 'number' | 'alphanumeric' = "number") => {
  if (type === "number") {
    return Math.floor(Math.random() * (10 ** len - 1) + 10 ** (len - 1))?.toString();
  }

  const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < len; i++) {
    const index = Math.floor(Math.random() * characters.length)
    code += characters[index];
  }
  return code;
}

export const isEmpty = (mixedVar: any) => {
  let undef;
  let key;
  let i;
  let len;
  const emptyValues = [undef, null, false, 0, '', '0', 'null', 'undefined'];

  for (i = 0, len = emptyValues.length; i < len; i++) {
    if (mixedVar === emptyValues[i] || typeof mixedVar === 'undefined') {
      return true;
    }
  }

  if (typeof mixedVar === 'object' && !(mixedVar instanceof Date)) {
    for (key in mixedVar) {
      if (Object.prototype.hasOwnProperty.call(mixedVar, key)) {
        return false;
      }
    }
    return true;
  }
  return false;
};

export const getStringSize = (str: string, format: string = "base64") => {
  if (format === "base64") {
    const padding = str.endsWith('==') ? 2 : str.endsWith('=') ? 1 : 0;
    return (str.length * (3 / 4)) - padding;
  }
  return Buffer.byteLength(str, 'utf8');
}

export const compareStrings = (str1: string, str2: string) => {
  return str1?.toLowerCase().trim() === str2?.toLowerCase().trim();
};

export const responsHandler = (
  res: Response,
  status: number,
  message: string,
  data: any = null,
) => {
  res.status(status).json({
    status: status,
    message: message,
    data,
  });
};

export const validateRequest = (req: Request) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const message = errors.array()[0].msg;
    throw new UnprocessableContent(message, errors.array());
  }
};

export const getFiles = (req: Request, required = false): Express.Multer.File[] => {
  const files = req.files as Express.Multer.File[] | undefined;

  if (required && !files) {
    throw new UnprocessableContent("Upload a file");
  }

  if (!files) return [];

  const allowedTypes = new Set<string>(SUPPORTED_FILE_TYPES);
  if (files.some(f => !allowedTypes.has(f.mimetype))) {
    throw new UnprocessableContent("Invalid file type. Supported types: PNG, JPEG, HEIC, PDF, MP4, WebM, QuickTime, and AVI videos.");
  }

  return files;
}

export const getPagination = (req: Request): IPagination => {
  let { limit = 25, page = 1 } = req.query;

  limit = Math.max(Number(limit), 1);
  page = Math.max(Number(page), 1)

  return { ...req.query, limit, page };
};

export const hashPassword = async (password: string) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

export const generateKeys = () => {
  const EC = new ec("secp256k1")
  const key = EC.genKeyPair();

  const private_key = key.getPrivate("hex")
  const public_key = key.getPublic("hex")

  return { private_key, public_key }
}

export const createAccessToken = (id: string, expires_in = 24 * 60 * 60 * 1000) => {
  const access_token = jwt.sign({ id }, String(JWT_SECRET), {
    audience: 'API',
    issuer: 'Memento',
    expiresIn: expires_in
  });

  const expires_at = dayjs().add(expires_in, "millisecond").toISOString()
  return { access_token, expires_at }
};

export const createRefreshToken = (id: string, expires_in = 30 * 24 * 60 * 60 * 1000) => {
  const refresh_token = jwt.sign({ id, type: 'refresh' }, String(JWT_SECRET), {
    audience: 'API',
    issuer: 'Memento',
    expiresIn: expires_in
  });

  const expires_at = dayjs().add(expires_in, "millisecond").toISOString()
  return { refresh_token, expires_at }
};

export const createTokenPair = (id: string, accessExpiresIn = 24 * 60 * 60 * 1000, refreshExpiresIn = 30 * 24 * 60 * 60 * 1000) => {
  const accessToken = createAccessToken(id, accessExpiresIn);
  const refreshToken = createRefreshToken(id, refreshExpiresIn);

  return {
    access_token: accessToken.access_token,
    refresh_token: refreshToken.refresh_token,
    expires_at: accessToken.expires_at,
    refresh_expires_at: refreshToken.expires_at
  };
};

export const reconstructFileName = (name: string) => {
  const file_name = name.toLowerCase().replace(/\s+/g, "_");
  const extension = name.split('.').pop();
  const timestamp = dayjs().format("YYMMDDHHmmss");

  return `${file_name.replace(/\.[^/.]+$/, '')}_${timestamp}.${extension}`;
}

export const verifyAccessToken = (token: string): any => {
  return jwt.verify(token, String(JWT_SECRET), (err, decoded) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        throw new SessionTimeout();
      }
      throw new UnauthorizedException()
    }
    return decoded;
  });
};

export const verifyRefreshToken = (token: string): any => {
  return jwt.verify(token, String(JWT_SECRET), (err, decoded: any) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        throw new SessionTimeout();
      }
      throw new UnauthorizedException()
    }
    if (decoded.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type')
    }
    return decoded;
  });
};

export const filterGenerator = (payload: object, fields: string[] = []) => {
  const proccessed: FilterQuery<any>[] = [];
  const queries = Object.entries(payload);
  const allowed = fields.concat(["search"]);

  for (let i = 0; i < queries.length; i++) {
    if (!allowed.includes(queries[i][0])) continue;
    if (queries[i][0] === "search" && !isEmpty(queries[i][1])) {
      const search_filters: any[] = fields.map(key => ({
        [key]: { $regex: new RegExp(`${queries[i][1]}`), $options: 'i' },
      }));
      proccessed.push({ $or: search_filters });
    }
    else proccessed.push({ [queries[i][0]]: queries[i][1] });
  }

  return proccessed;
};

export const getTimeBasedGreeting = (): string => {
  const hour = dayjs().hour();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export const emptyPaginatedList = ({ limit, page }) => {
  return {
    docs: [],
    totalDocs: 0,
    limit,
    page,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false,
    nextPage: null,
    prevPage: null
  }
}

export const extractJson = (text: string) => {
  try {
    let cleanedResponse = text.trim();
    if (cleanedResponse.startsWith('```json')) {
      cleanedResponse = cleanedResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanedResponse = jsonMatch[0];
    }
    return JSON.parse(cleanedResponse);
  } catch (error) {
    return null;
  }
}

export async function getMediaDuration(base64Data: string, mimetype: string): Promise<number | undefined> {
  const is_media_file = mimetype.startsWith('audio/') || mimetype.startsWith('video/');
  if (!is_media_file) return null;

  let tempFilePath: string | null = null;

  try {
    const buffer = Buffer.from(base64Data, 'base64');

    const tempFileName = `temp_media_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    tempFilePath = join(tmpdir(), tempFileName);

    // Write buffer to temporary file
    await writeFile(tempFilePath, buffer);

    // Get duration using the file path
    const duration = await getAudioDurationInSeconds(tempFilePath);
    return duration; // Round to 2 decimal places
  } catch (error) {
    return null;
  } finally {
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (cleanupError) {
        console.error('Error cleaning up temporary file:', cleanupError);
      }
    }
  }
}

export async function processFile(file: Express.Multer.File, user: string): Promise<Partial<IFile>> {
  const fileName = reconstructFileName(file.originalname);

  // Upload file to S3 using the filename as the key
  const uploadResult = await uploadToS3(
    fileName,
    file.buffer,
    file.mimetype,
    {
      originalName: file.originalname,
      userId: user,
      uploadedAt: new Date().toISOString()
    }
  );

  // Get duration for media files
  const base64 = file.buffer.toString("base64");
  const duration = await getMediaDuration(base64, file.mimetype);

  return {
    name: uploadResult?.key,
    user,
    size: file.size,
    type: file.mimetype,
    duration
  }
}

export const idValidator = check("id")
  .notEmpty().withMessage("Id is required")
  .isMongoId().withMessage("Invalid id ")


// export async function analyzeSingleConversation(userMessage: string, aiResponse: string): Promise<IUserInsights> {
//   const analysisPrompt = `Analyze this single conversation exchange and extract user preferences. Return ONLY a valid JSON object:

// {
//   "topics_of_interest": ["topic1"],
//   "conversation_tone": "upbeat|calm|analytical|creative",
//   "response_length": "short|medium|long"
// }

// Focus on immediate patterns in this exchange.`;

//   try {
//     const conversationText = `User: ${userMessage}\n\nAI: ${aiResponse}`;

//     const contents = createUserContent([
//       analysisPrompt,
//       { text: conversationText }
//     ]);

//     const response = await gemini.models.generateContent({
//       model: GEMINI_MODEL,
//       contents
//     });

//     const insights: IUserInsights = extractJson(response.text);
//     return insights;
//   } catch (error) {
//     console.error('Error analyzing single conversation:', error);
//     return {};
//   }
// }

// async function analyzeUserConversations(user_id: string): Promise<IConversationAnalysis> {
//   // Get recent messages (last 50 messages for analysis)
//   const messages = await Message.find({ user: user_id })
//     .sort({ created_at: -1 })
//     .limit(50);

//   if (messages.length === 0) {
//     return {
//       user_insights: {},
//       conversation_summary: "No conversation history yet",
//       learning_notes: []
//     };
//   }

//   // Create conversation text for analysis
//   const conversationText = messages
//     .reverse()
//     .map(msg => `${msg.role}: ${msg.text}`)
//     .join('\n\n');

//   const analysisPrompt = `Analyze this conversation and extract user insights. Return ONLY a valid JSON object with this structure:

// {
//   "user_insights": {
//     "communication_style": "formal|casual|friendly|professional",
//     "topics_of_interest": ["topic1", "topic2"],
//     "conversation_tone": "upbeat|calm|analytical|creative",
//     "emoji_preference": true/false,
//     "response_length": "short|medium|long"
//   },
//   "conversation_summary": "Brief summary of conversation themes",
//   "learning_notes": [
//     "Important note about user preference 1",
//     "Important note about user preference 2"
//   ]
// }

// ANALYSIS GUIDELINES:
// - communication_style: Based on language formality, vocabulary, sentence structure
// - topics_of_interest: Recurring subjects, hobbies, work, passions mentioned
// - conversation_tone: Overall emotional tone and energy level
// - response_length: Whether user prefers short, medium, or detailed responses
// - learning_notes: Key insights about personality, preferences, goals, or important life details

// Focus on patterns, preferences, and meaningful insights that would help personalize future interactions.`;

//   try {
//     const contents = createUserContent([
//       analysisPrompt,
//       { text: conversationText }
//     ]);

//     const response = await gemini.models.generateContent({
//       model: GEMINI_MODEL,
//       contents
//     });

//     const analysis: IConversationAnalysis = extractJson(response.text);
//     return analysis;
//   } catch (error) {
//     return {
//       user_insights: {},
//       conversation_summary: "Analysis failed",
//       learning_notes: []
//     };
//   }
// }

// export async function updateUserFromConversations(user_id: string): Promise<void> {
//   try {
//     const analysis = await analyzeUserConversations(user_id);

//     if (!analysis.user_insights || Object.keys(analysis.user_insights).length === 0) {
//       return;
//     }

//     const updateData: any = {};

//     // Update preferences if we have insights
//     if (analysis.user_insights) {
//       updateData['preferences'] = {};

//       if (analysis.user_insights.communication_style) {
//         updateData['preferences.communication_style'] = analysis.user_insights.communication_style;
//       }
//       if (analysis.user_insights.conversation_tone) {
//         updateData['preferences.conversation_tone'] = analysis.user_insights.conversation_tone;
//       }
//       if (analysis.user_insights.response_length) {
//         updateData['preferences.response_length'] = analysis.user_insights.response_length;
//       }
//       if (analysis.user_insights.topics_of_interest && analysis.user_insights.topics_of_interest.length > 0) {
//         updateData['preferences.topics_of_interest'] = analysis.user_insights.topics_of_interest;
//       }
//     }

//     // Update context
//     if (analysis.learning_notes && analysis.learning_notes.length > 0) {
//       updateData['context.important_notes'] = analysis.learning_notes;
//     }
//     if (analysis.conversation_summary) {
//       updateData['context.conversation_history_summary'] = analysis.conversation_summary;
//     }

//     if (Object.keys(updateData).length > 0) {
//       await User.findByIdAndUpdate(user_id, updateData);
//       console.log(`Updated user ${user_id} preferences from conversation analysis`);
//     }

//   } catch (error) {
//     console.error('Error updating user from conversations:', error);
//   }
// }

// export async function updateUserAfterConversation(user_id: string, userMessage: string, aiResponse: string): Promise<void> {
//   try {
//     const insights = await analyzeSingleConversation(userMessage, aiResponse);
//     console.log(insights)
//     if (isEmpty(insights)) {
//       return;
//     }

//     const updateData: any = {};

//     // Update specific preferences based on this conversation
//     // if (insights.communication_style) {
//     //   updateData['preferences.communication_style'] = insights.communication_style;
//     // }
//     if (insights.conversation_tone) {
//       updateData['preferences.conversation_tone'] = insights.conversation_tone;
//     }
//     if (insights.response_length) {
//       updateData['preferences.response_length'] = insights.response_length;
//     }
//     if (insights.topics_of_interest && insights.topics_of_interest.length > 0) {
//       // Add to existing topics of interest
//       updateData['$addToSet'] = {
//         'preferences.topics_of_interest': { $each: insights.topics_of_interest }
//       };
//     }

//     if (Object.keys(updateData).length > 0) {
//       await User.findByIdAndUpdate(user_id, updateData);
//       console.log(`Updated user ${user_id} preferences from single conversation`);
//     }

//   } catch (error) {
//     console.error('Error updating user after conversation:', error);
//   }
// }