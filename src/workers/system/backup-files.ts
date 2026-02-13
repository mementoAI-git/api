import { Readable } from "stream";
import cloudinary from "../../services/storage/cloudinary";
import * as gcsStorage from "../../services/storage/gcs";
import File, { IFile } from "../../module/database/model/file";
import logger from "../../utils/logger";

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function getResourceType(mimetype: string): "image" | "video" | "raw" | "auto" {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/") || mimetype.startsWith("audio/")) return "video";
  return "raw";
}

async function uploadToCloudinary(file: IFile): Promise<void> {
  try {
    const response = await gcsStorage.getFileFromGCS(file.name);
    if (!response.Body) {
      throw new Error("File not found");
    }
    const buffer = await streamToBuffer(response.Body as Readable);
    const resourceType = getResourceType(file.type || "");

    await new Promise<void>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: resourceType,
          public_id: file.name,
          overwrite: true,
          folder: "memento"
        },
        (err, result) => {
          if (err) reject(err);
          else if (!result) reject(new Error("No result from Cloudinary"));
          else resolve();
        }
      );
      stream.end(buffer);
    });

    await File.updateOne(
      { name: file.name },
      { $set: { backup_at: new Date() } }
    );
  }
  catch (err) {
    throw err
  }
}

async function deleteFromCloudinary(file: IFile): Promise<void> {
  try {
    await cloudinary.uploader.destroy(
      file.name,
      { resource_type: getResourceType(file.type || "") }
    );
    await File.deleteOne({ name: file.name, deleted: true });
  } catch (err) {
    throw err
  }
}


/**
 * Backs up GCS files to Cloudinary. Only processes files that have never been backed up
 * (backup_at is null or missing) and are not deleted. Also removes from Cloudinary
 * any files that were soft-deleted (deleted: true and backup_at set).
 */
export default async function backupFiles() {
  const files = await File.find({
    provider: { $ne: "s3" },
    $or: [
      { backup_at: { $exists: false } },
      { backup_at: null },
      { deleted: true },
    ],
  })
    .select("_id name type backup_at deleted")
    .sort({ _id: 1 })
    .limit(50)
    .lean();

  let backedUp = 0;
  let failed = 0;
  let deleted = 0;
  const errors: string[] = [];

  for (const file of files) {
    try {
      if (!file?.backup_at) {
        await uploadToCloudinary(file);
        backedUp++;
      }

      if (file?.deleted) {
        await deleteFromCloudinary(file);
        deleted++;
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${file.name}: ${msg}`);
      logger.error({ err, key: file.name }, "GCS → Cloudinary backup failed for file");
    }
  }

  logger.info(
    { backedUp, failed, deleted, total: files.length },
    "GCS to Cloudinary backup completed"
  );
  return {
    backedUp,
    failed,
    skipped: files.length - backedUp - failed,
    deleted,
    errors: errors.slice(0, 50),
  };
}
