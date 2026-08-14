import {spawn} from 'child_process';
import {createWriteStream} from 'fs';
import {mkdir, readFile, rm} from 'fs/promises';
import path from 'path';
import {pipeline} from 'stream/promises';
import axios from 'axios';
import {v4 as uuid} from 'uuid';
import {FFMPEG_PATH, FFPROBE_PATH, TEMP_PATH} from '../../utils/config';
import {uploadToS3} from './s3';
import {resolvePublicFileUrl} from './public-url';

export interface VideoMediaMetadata {
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface VideoThumbnailArtifactResult extends VideoMediaMetadata {
  thumbnailKey: string;
  thumbnailUrl: string;
}

type CommandResult = {
  stdout: string;
  stderr: string;
};

function runCommand(binary: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({stdout, stderr});
        return;
      }

      reject(
        new Error(
          `${binary} exited with code ${code}. ${stderr || stdout}`.trim(),
        ),
      );
    });
  });
}

export async function getVideoProcessingAvailability(): Promise<boolean> {
  try {
    await runCommand(FFPROBE_PATH, ['-version']);
    await runCommand(FFMPEG_PATH, ['-version']);
    return true;
  } catch {
    return false;
  }
}

async function ensureTempDir(): Promise<string> {
  const dir = path.join(TEMP_PATH, 'memento-media');
  await mkdir(dir, {recursive: true});
  return dir;
}

function extFromFileName(name: string, fallback: string): string {
  const ext = path.extname(name).trim();
  return ext || fallback;
}

async function downloadToTempFile(url: string, ext: string): Promise<string> {
  const dir = await ensureTempDir();
  const filePath = path.join(dir, `${uuid()}${ext}`);
  const response = await axios.get(url, {
    responseType: 'stream',
    validateStatus: status => status >= 200 && status < 300,
  });

  await pipeline(response.data, createWriteStream(filePath));
  return filePath;
}

async function probeVideoMetadata(
  filePath: string,
): Promise<VideoMediaMetadata> {
  const {stdout} = await runCommand(FFPROBE_PATH, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height:format=duration',
    '-of',
    'json',
    filePath,
  ]);

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{width?: number; height?: number}>;
    format?: {duration?: string};
  };
  const stream = parsed.streams?.[0];

  return {
    width: stream?.width ?? null,
    height: stream?.height ?? null,
    duration: parsed.format?.duration ? Number(parsed.format.duration) : null,
  };
}

async function generateThumbnailImage(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  await runCommand(FFMPEG_PATH, [
    '-y',
    '-ss',
    '1',
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    "scale='min(800,iw)':-2",
    outputPath,
  ]);
}

export async function createUploadedVideoThumbnailArtifact(file: {
  name: string;
  backup_url?: string | null;
}): Promise<VideoThumbnailArtifactResult> {
  if (!file.backup_url) {
    throw new Error('Video backup URL is not available for processing');
  }

  const sourceExt = extFromFileName(file.name, '.mp4');
  const inputPath = await downloadToTempFile(file.backup_url, sourceExt);
  const dir = await ensureTempDir();
  const outputPath = path.join(dir, `${uuid()}.jpg`);
  const thumbnailKey = `thumbnails/${file.name.replace(/\.[^.]+$/, '')}.jpg`;

  try {
    const metadata = await probeVideoMetadata(inputPath);
    await generateThumbnailImage(inputPath, outputPath);

    const upload = await uploadToS3(
      thumbnailKey,
      await readFile(outputPath),
      'image/jpeg',
    );

    return {
      ...metadata,
      thumbnailKey,
      thumbnailUrl: resolvePublicFileUrl(thumbnailKey, upload.location),
    };
  } finally {
    await Promise.allSettled([
      rm(inputPath, {force: true}),
      rm(outputPath, {force: true}),
    ]);
  }
}
