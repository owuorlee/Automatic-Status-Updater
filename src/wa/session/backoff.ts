/**
 * Exponential backoff with jitter for reconnects (requirement §3). Jitter keeps
 * many sessions from reconnecting in lockstep after a shared outage — itself a
 * ban-relevant "botnet" tell.
 */
export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  /** Fractional jitter applied around the computed delay, e.g. 0.3 = ±30%. */
  jitter?: number;
}

export function backoffDelay(
  attempt: number,
  opts: BackoffOptions = {},
  rng: () => number = Math.random,
): number {
  const base = opts.baseMs ?? 2_000;
  const max = opts.maxMs ?? 5 * 60_000;
  const factor = opts.factor ?? 2;
  const jitter = opts.jitter ?? 0.3;

  const raw = Math.min(max, base * factor ** Math.max(0, attempt));
  const delta = raw * jitter;
  const lo = Math.max(base, raw - delta);
  const hi = raw + delta;
  return Math.round(lo + (hi - lo) * rng());
}
