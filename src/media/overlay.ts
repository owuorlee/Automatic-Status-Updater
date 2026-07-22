/**
 * Image overlay pipeline (requirement §5). Composites price + branding onto a
 * product photo and normalises it to a Status-friendly 9:16 frame.
 *
 * Approach (per DECISIONS / the brief): `sharp` for speed, with the text/price/
 * badge layer built as an SVG and `composite()`d over the resized photo — sharp
 * renders SVG text crisply, which it can't do on its own.
 *
 * Robust to awkward inputs: tall/wide/tiny/transparent photos never produce a
 * broken frame. Tall/wide are letterboxed over a blurred cover of themselves;
 * transparency is flattened; output is always 1080x1920 JPEG under a size cap.
 */
import sharp from 'sharp';

export const STATUS_W = 1080;
export const STATUS_H = 1920;

export interface Branding {
  businessName: string;
  /** Pre-formatted price string, e.g. "KSh 1,499". */
  priceText: string;
  /** Brand accent (badge) colour. */
  accentColor?: string;
  /** Text colour on the accent badge. */
  onAccentColor?: string;
  /** Optional promo ribbon text, e.g. "OFFER". */
  badgeText?: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Build the full-canvas SVG overlay: top name bar + bottom price badge. */
function buildOverlaySvg(b: Branding): Buffer {
  const accent = b.accentColor ?? '#128C7E';
  const onAccent = b.onAccentColor ?? '#FFFFFF';
  const name = escapeXml(b.businessName.toUpperCase());
  const price = escapeXml(b.priceText);
  const promo = b.badgeText ? escapeXml(b.badgeText.toUpperCase()) : null;

  // Price badge geometry (bottom-centered pill).
  const badgeW = 620;
  const badgeH = 150;
  const badgeX = (STATUS_W - badgeW) / 2;
  const badgeY = STATUS_H - badgeH - 130;

  const promoSvg = promo
    ? `<g>
         <rect x="${STATUS_W - 300}" y="120" width="240" height="86" rx="43" fill="#E63946"/>
         <text x="${STATUS_W - 180}" y="176" text-anchor="middle"
               font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="700"
               fill="#FFFFFF" letter-spacing="2">${promo}</text>
       </g>`
    : '';

  return Buffer.from(`<svg width="${STATUS_W}" height="${STATUS_H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="topShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000000" stop-opacity="0.55"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="botShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0.65"/>
      </linearGradient>
      <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.45"/>
      </filter>
    </defs>

    <rect x="0" y="0" width="${STATUS_W}" height="300" fill="url(#topShade)"/>
    <rect x="0" y="${STATUS_H - 420}" width="${STATUS_W}" height="420" fill="url(#botShade)"/>

    <text x="60" y="150" font-family="Arial, Helvetica, sans-serif" font-size="60"
          font-weight="800" fill="#FFFFFF" letter-spacing="1">${name}</text>
    ${promoSvg}

    <g filter="url(#ds)">
      <rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="${badgeH / 2}" fill="${accent}"/>
      <text x="${STATUS_W / 2}" y="${badgeY + badgeH / 2 + 33}" text-anchor="middle"
            font-family="Arial, Helvetica, sans-serif" font-size="88" font-weight="800"
            fill="${onAccent}">${price}</text>
    </g>
  </svg>`);
}

export interface RenderOptions {
  /** JPEG quality (default 82). */
  quality?: number;
  /** Hard cap on output bytes; we step quality down until we're under it. */
  maxBytes?: number;
}

/**
 * Render a Status-ready branded image from a product photo.
 * Returns a JPEG buffer sized exactly STATUS_W x STATUS_H.
 */
export async function renderStatusImage(
  input: Buffer,
  branding: Branding,
  opts: RenderOptions = {},
): Promise<Buffer> {
  const maxBytes = opts.maxBytes ?? 2_500_000;

  // Guard: reject obviously non-image input early with a clear error.
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Input is not a decodable image.');
  }

  // Background: cover the whole frame with a darkened, blurred version so any
  // aspect ratio letterboxes cleanly instead of leaving bars.
  const background = await sharp(input)
    .resize(STATUS_W, STATUS_H, { fit: 'cover', position: 'center' })
    .blur(28)
    .modulate({ brightness: 0.62 })
    .flatten({ background: '#111111' })
    .toBuffer();

  // Foreground: the product, contained so nothing is cropped, leaving margins
  // for the name bar and price badge. Alpha preserved for transparent PNGs.
  const foreground = await sharp(input)
    .resize(920, 1240, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  const overlaySvg = buildOverlaySvg(branding);

  const composeAt = (quality: number) =>
    sharp(background)
      .composite([
        { input: foreground, gravity: 'center' },
        { input: overlaySvg, top: 0, left: 0 },
      ])
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

  let quality = opts.quality ?? 82;
  let out = await composeAt(quality);
  while (out.byteLength > maxBytes && quality > 45) {
    quality -= 10;
    out = await composeAt(quality);
  }
  return out;
}
