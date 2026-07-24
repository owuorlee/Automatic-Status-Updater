import type { CaptionRequest, CaptionLanguage } from './types.js';

const LANGUAGE_INSTRUCTION: Record<CaptionLanguage, string> = {
  english: 'Write in clear, natural English.',
  swahili: 'Andika kwa Kiswahili sanifu, cha kawaida na cha kirafiki.',
  sheng:
    'Write in Nairobi Sheng (the Swahili-English street slang young Kenyans use). Keep it casual and punchy.',
  mixed:
    'Write in natural Kenyan mixed English–Swahili, the way small businesses actually post — light code-switching, warm and local.',
};

function emojiInstruction(density: number): string {
  switch (Math.max(0, Math.min(3, density))) {
    case 0:
      return 'Use no emojis.';
    case 1:
      return 'Use exactly one tasteful emoji.';
    case 3:
      return 'Use several fitting emojis.';
    default:
      return 'Use two or three fitting emojis.';
  }
}

/** Build the system + user prompt. Kept lean to control token cost. */
export function buildPrompt(req: CaptionRequest): { system: string; user: string } {
  const emojiDensity = req.emojiDensity ?? 2;
  const maxLength = req.maxLength ?? 200;
  const includePrice = req.includePrice !== false;
  const includeCta = req.includeCta !== false;

  const system = [
    'You are a marketing copywriter for a small Kenyan business posting product promos to WhatsApp Status.',
    'Write ONE short, scroll-stopping caption that makes people want to buy.',
    LANGUAGE_INSTRUCTION[req.language],
    req.tone ? `Tone: ${req.tone}.` : 'Tone: warm, confident, local.',
    emojiInstruction(emojiDensity),
    includePrice ? 'Include the price naturally.' : 'Do not mention the price.',
    includeCta ? 'End with a short call to action to DM or order.' : 'No explicit call to action.',
    `Hard limit: ${maxLength} characters. No hashtags unless they add value. Output ONLY the caption text — no quotes, no preamble, no options.`,
  ].join(' ');

  const lines = [
    `Product: ${req.productName}`,
    includePrice ? `Price: ${req.priceText}` : null,
    req.category ? `Category: ${req.category}` : null,
    req.description ? `Details: ${req.description}` : null,
  ].filter(Boolean);

  if (req.avoidCaptions?.length) {
    lines.push(
      `Do NOT reuse the wording of these recent captions (write something clearly different):\n- ${req.avoidCaptions
        .slice(0, 5)
        .join('\n- ')}`,
    );
  }
  if (req.variationIndex) lines.push(`Variation: ${req.variationIndex} (make this feel fresh vs. earlier posts).`);

  return { system, user: lines.join('\n') };
}
