import multer from "multer";
import { Request } from "express";

// Configure multer to use memory storage (similar to express-fileupload default behavior)
const storage = multer.memoryStorage();

// File filter for validation
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
	const allowedTypes = [
		"image/png",
		"image/jpeg",
		"image/jpg",
		"image/heic",
		"video/mp4",
		"video/webm",
		"video/quicktime",
		"video/x-msvideo",
		"audio/webm",
		"application/pdf"
	];

	if (allowedTypes.includes(file.mimetype)) {
		cb(null, true);
	} else {
		cb(new Error("Invalid file type. Supported types: PNG, JPEG, HEIC, PDF, MP4, WebM, QuickTime, and AVI videos."));
	}
};

const fileUploadMiddleWare = multer({
	storage,
	limits: {
		fileSize: 15 * 1024 * 1024 // 15MB
	},
	fileFilter
});

export default fileUploadMiddleWare
