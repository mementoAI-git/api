import sharp from 'sharp';
import {BadRequestException} from './service-error';

export const DEFAULT_BANNER_POSITION = {x: 50, y: 100};

export function parseBannerPosition(value: unknown): {x: number; y: number} {
  const position = value as {x?: unknown; y?: unknown} | null;
  if (
    !position ||
    typeof position.x !== 'number' ||
    typeof position.y !== 'number' ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    position.x < 0 ||
    position.x > 100 ||
    position.y < 0 ||
    position.y > 100
  ) {
    throw new BadRequestException('Choose a valid banner position.');
  }
  return {x: position.x, y: position.y};
}

export function parseBannerPreset(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 3
  ) {
    throw new BadRequestException('Choose one of the four banner options.');
  }
  return value;
}

export async function convertBannerImage(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, {limitInputPixels: 40000000})
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({quality: 82})
      .toBuffer();
  } catch {
    throw new BadRequestException('Upload a valid banner image.');
  }
}
