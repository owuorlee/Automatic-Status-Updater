export type CaptionLanguage = 'english' | 'swahili' | 'sheng' | 'mixed';

export interface CaptionRequest {
  productName: string;
  /** Pre-formatted price, e.g. "KSh 1,499". */
  priceText: string;
  description?: string;
  category?: string;
  language: CaptionLanguage;
  /** Free-text tone, e.g. "friendly", "hype", "professional". */
  tone?: string;
  /** 0 = none, 1 = one, 2 = a few, 3 = lots. Default 2. */
  emojiDensity?: number;
  /** Include the price in the copy. Default true. */
  includePrice?: boolean;
  /** Include a call-to-action. Default true. */
  includeCta?: boolean;
  /** Max characters (Status-friendly). Default 200. */
  maxLength?: number;
  /** Bump to force different phrasing for the same product. */
  variationIndex?: number;
  /** Recent captions to avoid repeating (fed to the model). */
  avoidCaptions?: string[];
}

export interface CaptionResult {
  text: string;
  /** Where the caption came from. `fallback` means we degraded gracefully. */
  source: 'ai' | 'fallback';
  model?: string;
  /** Why we fell back, if we did (e.g. "no-api-key", "api-error:...", "timeout"). */
  reason?: string;
}

/** Pluggable transport so the AI path is testable without hitting the network. */
export type CaptionTransport = (
  built: { system: string; user: string },
  cfg: { model: string; maxTokens: number; timeoutMs: number; apiKey: string },
) => Promise<string>;

export interface CaptionOptions {
  apiKey?: string;
  model?: string;
  /** 'auto' uses the API when a key is present; 'mock' always uses the fallback. */
  mode?: 'auto' | 'mock';
  maxTokens?: number;
  timeoutMs?: number;
  /** Inject a custom transport (tests, or a different provider). */
  transport?: CaptionTransport;
}
