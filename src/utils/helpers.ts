import { Response, Request } from "express";
import { validationResult } from "express-validator";
import bcrypt from "bcrypt"
import * as jwt from 'jsonwebtoken';
import { ec } from "elliptic"

import { SessionTimeout, UnauthorizedException, UnprocessableContent } from "./service-error";
import { JWT_SECRET } from "./config";
import { IPagination } from "./interface";
import dayjs from "dayjs";
import { UploadedFile } from "express-fileupload";
import { FilterQuery } from "mongoose";

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

export const getFiles = (req: Request, required = false) => {
  let files: UploadedFile[] = [];

  if (required && isEmpty(req?.files)) {
    throw new UnprocessableContent("Upload a file")
  }
  if (isEmpty(req?.files)) return [];

  if (!Array.isArray(req?.files?.file)) files.push(req.files.file);
  else files = req.files.file;

  const allowedTypes = new Set([
    "image/png", "image/jpeg",
    "image/heic",
    "video/mp4",
    "audio/webm", "video/webm",
    "application/pdf"
  ])
  if (files.some(f => !allowedTypes.has(f.mimetype))) {
    throw new UnprocessableContent("Invalid file type. Only PNG, JPEG, and PDF allowed.")
  }

  return files
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

export const filterGenerator = (payload: object, fields: string[] = []) => {
  const proccessed: FilterQuery<any>[] = [];
  const queries = Object.entries(payload);
  const allowed = fields.concat(["search"]);

  for (let i = 0; i < queries.length; i++) {
    if (!allowed.includes(queries[i][0])) continue;
    if (queries[i][0] === "search") {
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