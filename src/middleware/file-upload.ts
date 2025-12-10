import multer from 'multer';
import {Request} from 'express';
import {SUPPORTED_FILE_TYPES as allowedTypes} from '../utils/constant';

// Configure multer to use memory storage (similar to express-fileupload default behavior)
const storage = multer.memoryStorage();

// File filter for validation
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        'Invalid file type. Supported types: PNG, JPEG, HEIC, PDF, MP4, WebM, QuickTime, AVI videos, and audio files (MP3, WAV, OGG, AAC, FLAC, WebM).',
      ),
    );
  }
};

const fileUploadMiddleWare = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
  },
  fileFilter,
});

export default fileUploadMiddleWare;
