/**
 * Upload Explore category artwork to R2.
 *
 * Generates responsive WebPs from the canonical masters and uploads them to
 * `artwork/explore/{slug}-{width}.webp` — the exact keys served by
 * `GET /prompts/categories?enriched=true` (see explore-taxonomy.ts).
 *
 * Safe to re-run (idempotent): same bytes, same keys, immutable cache headers.
 * No app rebuild needed: the enriched endpoint is opt-in, so released apps
 * keep parsing the default string[] shape until they migrate.
 *
 * Usage:
 *   MASTERS_DIR=../web/src/assets/image/categories/masters \
 *     npx ts-node src/scripts/upload-explore-artwork.ts [--dry-run]
 *
 * Requires the standard R2 env (CLOUDFLARE_R2_* in .env).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {PutObjectCommand, HeadObjectCommand} from '@aws-sdk/client-s3';
import {getStorageTarget} from '../services/storage/s3';
import {
  EXPLORE_CATEGORIES,
  EXPLORE_ARTWORK_VERSION,
} from '../module/api/prompt/explore-taxonomy';

const WIDTHS = [480, 768, 1024, 1440];
const QUALITY = 82;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const mastersDir =
    process.env.MASTERS_DIR ||
    path.resolve(__dirname, '../../../web/src/assets/image/categories/masters');

  const missing = EXPLORE_CATEGORIES.map(c => `${c.slug}.png`).filter(
    f => !fs.existsSync(path.join(mastersDir, f)),
  );
  if (missing.length > 0) {
    throw new Error(`Missing masters in ${mastersDir}: ${missing.join(', ')}`);
  }

  const {client, bucket} = getStorageTarget('primary');
  console.log(`Target: bucket=${bucket} (dryRun=${dryRun})`);

  let uploaded = 0;
  let verified = 0;
  for (const category of EXPLORE_CATEGORIES) {
    const master = fs.readFileSync(
      path.join(mastersDir, `${category.slug}.png`),
    );
    for (const width of WIDTHS) {
      // Stored object key has no query string — the ?v= in served URLs is a
      // cache-buster only; bumps replace the object cleanly under this key.
      const objectKey = `artwork/explore/${category.slug}-${width}.webp`;
      const body = await sharp(master)
        .resize({width, withoutEnlargement: true})
        .webp({quality: QUALITY})
        .toBuffer();

      if (!dryRun) {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: objectKey,
            Body: body,
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
        uploaded += 1;
      }

      if (!dryRun) {
        await client.send(
          new HeadObjectCommand({Bucket: bucket, Key: objectKey}),
        );
        verified += 1;
      }
      console.log(
        `${dryRun ? '[dry-run] ' : ''}${objectKey} (${(body.length / 1024).toFixed(0)}KB)`,
      );
    }
  }

  console.log(`Done: uploaded=${uploaded} verified=${verified}`);
  console.log(
    'Verify live: GET /prompts/categories?enriched=true → artwork.src should 200.',
  );
}

main().catch(err => {
  console.error(err);
  throw err;
});
