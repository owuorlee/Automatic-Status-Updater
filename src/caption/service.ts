import Anthropic from '@anthropic-ai/sdk';
import { buildPrompt } from './prompt.js';
import { fallbackCaption } from './fallback.js';
import type { CaptionOptions, CaptionRequest, CaptionResult, CaptionTransport } from './types.js';

const DEFAULT_MODEL = process.env.CAPTION_MODEL ?? 'claude-haiku-4-5-20251001';

/** Real transport: one lean Messages API call. Injectable for tests. */
const anthropicTransport: CaptionTransport = async (built, cfg) => {
  const client = new Anthropic({ apiKey: cfg.apiKey, timeout: cfg.timeoutMs, maxRetries: 1 });
  const msg = await client.messages.create({
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    temperature: 1,
    system: built.system,
    messages: [{ role: 'user', content: built.user }],
  });
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
};

function clamp(text: string, maxLength = 200): string {
  const t = text.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (t.length <= maxLength) return t;
  const cut = t.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Generate a caption. Uses the Claude API when a key is available; otherwise, or
 * on any error/timeout, degrades to a deterministic local caption. Never throws.
 */
export async function generateCaption(
  req: CaptionRequest,
  opts: CaptionOptions = {},
): Promise<CaptionResult> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const maxLength = req.maxLength ?? 200;

  const useAI = opts.mode !== 'mock' && !!apiKey;
  if (!useAI) {
    return {
      text: clamp(fallbackCaption(req), maxLength),
      source: 'fallback',
      reason: opts.mode === 'mock' ? 'mock-mode' : 'no-api-key',
    };
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const transport = opts.transport ?? anthropicTransport;

  try {
    const built = buildPrompt(req);
    const raw = await withTimeout(transport(built, { model, maxTokens: opts.maxTokens ?? 200, timeoutMs, apiKey: apiKey! }), timeoutMs);
    const text = clamp(raw, maxLength);
    if (!text) throw new Error('empty caption');
    return { text, source: 'ai', model };
  } catch (e) {
    return {
      text: clamp(fallbackCaption(req), maxLength),
      source: 'fallback',
      reason: e instanceof Error && e.message === 'timeout' ? 'timeout' : `api-error:${(e as Error).message}`,
    };
  }
}
