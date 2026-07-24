import { hashSeed } from '../risk/rng.js';
import type { CaptionRequest, CaptionLanguage } from './types.js';

/**
 * Deterministic, no-network fallback caption. Used when there's no API key, in
 * mock mode, or when the API call fails/times out — so a caption problem NEVER
 * blocks a post (requirement §4). Varies by product + variationIndex so the
 * same product doesn't always read identically.
 */
const OPENERS: Record<CaptionLanguage, string[]> = {
  english: ['Now available', 'Fresh in stock', 'Grab yours today', 'Just arrived'],
  swahili: ['Inapatikana sasa', 'Bidhaa mpya', 'Pata yako leo', 'Imefika'],
  sheng: ['Iko fresh', 'Mpya imeland', 'Chukua yako', 'Iko poa'],
  mixed: ['Fresh stock', 'Now available', 'Pata yako leo', 'Just arrived'],
};

const CTAS: Record<CaptionLanguage, string[]> = {
  english: ['DM to order.', 'Message us to buy.', 'Order now.'],
  swahili: ['Tuma ujumbe kuagiza.', 'Agiza sasa.', 'Wasiliana nasi.'],
  sheng: ['Tuma DM uorder.', 'Order sai.', 'Hit us up.'],
  mixed: ['DM to order.', 'Agiza sasa leo.', 'Inbox us.'],
};

const EMOJIS = ['🔥', '✨', '🛍️', '✅', '😍'];
// Strips emoji + variation selectors so density 0 is truly emoji-free.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

export function fallbackCaption(req: CaptionRequest): string {
  const idx = hashSeed(req.productName, req.variationIndex ?? 0);
  const openers = OPENERS[req.language];
  const ctas = CTAS[req.language];

  const priceClause = req.includePrice !== false ? ` — ${req.priceText}` : '';
  let s = `${openers[idx % openers.length]}: ${req.productName}${priceClause}.`;
  if (req.includeCta !== false) s += ` ${ctas[idx % ctas.length]}`;

  const density = req.emojiDensity ?? 2;
  if (density > 0) {
    const n = Math.min(density, 3);
    let tail = '';
    for (let i = 0; i < n; i++) tail += EMOJIS[(idx + i) % EMOJIS.length];
    s += ` ${tail}`;
  } else {
    s = s.replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();
  }
  return s;
}
