import {strict as assert} from 'node:assert';
import {test} from '../helpers/legacy-test';
import sharp from 'sharp';
import {
  parseBannerPreset,
  convertBannerImage,
  parseBannerPosition,
} from '../../src/utils/profile-banner';

void test('accepts only the four banner presets', () => {
  for (const preset of [0, 1, 2, 3])
    assert.equal(parseBannerPreset(preset), preset);
  for (const invalid of [-1, 4, '1', null, {}, 1.5]) {
    assert.throws(() => parseBannerPreset(invalid));
  }
});

void test('converts uploads to bounded WebP and rejects non-images', async () => {
  const png = await sharp({
    create: {width: 2000, height: 500, channels: 3, background: '#ee8855'},
  })
    .png()
    .toBuffer();
  const webp = await convertBannerImage(png);
  const metadata = await sharp(webp).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1600);
  await assert.rejects(convertBannerImage(Buffer.from('not an image')));
});

void test('validates banner positions without coercing invalid input', () => {
  assert.deepEqual(parseBannerPosition({x: 50, y: 100}), {x: 50, y: 100});
  for (const value of [
    null,
    {},
    {x: -1, y: 50},
    {x: 50, y: 101},
    {x: '50', y: 50},
    {x: NaN, y: 50},
  ])
    assert.throws(() => parseBannerPosition(value));
});
