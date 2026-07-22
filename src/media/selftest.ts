/**
 * Exercises the overlay pipeline end-to-end with synthetic product photos of
 * awkward shapes (square, very wide, very tall, tiny, transparent) and verifies
 * every output is a valid 1080x1920 JPEG under the size cap. No network needed.
 * Run: npm run test:media
 */
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderStatusImage, STATUS_W, STATUS_H, type Branding } from './overlay.js';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

/** Make a synthetic product photo of a given size/shape (optionally with alpha). */
async function fakePhoto(w: number, h: number, color: string, alpha = false): Promise<Buffer> {
  const base = sharp({
    create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 0, g: 0, b: 0, alpha: 0 } : color },
  });
  // Draw a simple shape so contain/cover behaviour is visible in the output.
  const dot = Buffer.from(
    `<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="${color}"/></svg>`,
  );
  return base.composite([{ input: dot, gravity: 'center' }]).png().toBuffer();
}

const branding: Branding = {
  businessName: 'Mama Njeri Fresh Produce',
  priceText: 'KSh 1,499',
  accentColor: '#128C7E',
  badgeText: 'Offer',
};

const cases: { label: string; make: () => Promise<Buffer> }[] = [
  { label: 'square-1200', make: () => fakePhoto(1200, 1200, '#2A9D8F') },
  { label: 'very-wide-2200x600', make: () => fakePhoto(2200, 600, '#E76F51') },
  { label: 'very-tall-600x2200', make: () => fakePhoto(600, 2200, '#264653') },
  { label: 'tiny-90x90', make: () => fakePhoto(90, 90, '#E9C46A') },
  { label: 'transparent-1000', make: () => fakePhoto(1000, 1000, '#8338EC', true) },
];

async function main() {
  const outDir = join(tmpdir(), 'wa-status-render-selftest');
  await mkdir(outDir, { recursive: true });
  console.log('Overlay pipeline self-test');
  console.log('output dir:', outDir, '\n');

  for (const c of cases) {
    const input = await c.make();
    let out: Buffer;
    try {
      out = await renderStatusImage(input, branding);
    } catch (e) {
      check(`[${c.label}] rendered without throwing`, false, String(e));
      continue;
    }
    const meta = await sharp(out).metadata();
    const ok =
      meta.format === 'jpeg' &&
      meta.width === STATUS_W &&
      meta.height === STATUS_H &&
      out.byteLength <= 2_500_000;
    check(
      `[${c.label}] -> ${meta.width}x${meta.height} ${meta.format}, ${(out.byteLength / 1024).toFixed(0)} KB`,
      ok,
    );
    const path = join(outDir, `${c.label}.jpg`);
    await writeFile(path, out);
  }

  // Bad input should fail loudly, not silently produce garbage.
  try {
    await renderStatusImage(Buffer.from('not an image'), branding);
    check('non-image input rejected', false, 'expected a throw');
  } catch {
    check('non-image input rejected', true);
  }

  console.log('');
  if (failures > 0) {
    console.error(`❌ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log(`✅ Overlay pipeline OK. Open the folder above to eyeball the ${cases.length} renders.`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
