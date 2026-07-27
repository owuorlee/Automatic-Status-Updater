/**
 * Ban-signal monitoring (requirement §7). Watches the pattern of forced
 * disconnects/logouts and returns a verdict the manager uses to auto-pause and
 * alert. Pure and time-injectable so it's fully testable.
 *
 * Heuristics (deliberately conservative — a false pause is cheaper than a ban):
 *  - An unexpected loggedOut/forbidden while the number is still warming up
 *    (young connection age) is the strongest tell → likely-banned.
 *  - Repeated forced disconnects in a short window → suspicious, then
 *    likely-banned past a higher threshold.
 */
export interface BanSignal {
  at: number;
  forced: boolean;
  reason: string;
}

export type BanLevel = 'ok' | 'suspicious' | 'likely-banned';

export interface BanVerdict {
  level: BanLevel;
  reason: string;
}

export interface BanDetectorOptions {
  windowMs?: number;
  /** Forced disconnects in the window to reach "suspicious". */
  suspiciousThreshold?: number;
  /** Forced disconnects in the window to reach "likely-banned". */
  bannedThreshold?: number;
  /** Connection age (days) below which a hard logout is treated as a ban. */
  warmupDays?: number;
}

export class BanDetector {
  private events: BanSignal[] = [];
  private readonly windowMs: number;
  private readonly suspicious: number;
  private readonly banned: number;
  private readonly warmupDays: number;

  constructor(opts: BanDetectorOptions = {}) {
    this.windowMs = opts.windowMs ?? 30 * 60_000;
    this.suspicious = opts.suspiciousThreshold ?? 3;
    this.banned = opts.bannedThreshold ?? 5;
    this.warmupDays = opts.warmupDays ?? 7;
  }

  record(ev: BanSignal, ctx: { ageDays?: number } = {}): BanVerdict {
    this.events.push(ev);
    const cutoff = ev.at - this.windowMs;
    this.events = this.events.filter((e) => e.at >= cutoff);

    // A real logout is the strongest signal, especially during warm-up.
    if (ev.reason === 'loggedOut' || ev.reason === 'forbidden' || ev.reason === 'badSession') {
      if ((ctx.ageDays ?? Infinity) < this.warmupDays) {
        return { level: 'likely-banned', reason: `${ev.reason} during warm-up (age ${ctx.ageDays}d)` };
      }
      return { level: 'suspicious', reason: `${ev.reason} (may be a manual unlink)` };
    }

    const forcedCount = this.events.filter((e) => e.forced).length;
    if (forcedCount >= this.banned) {
      return { level: 'likely-banned', reason: `${forcedCount} forced disconnects in ${this.windowMs / 60000}m` };
    }
    if (forcedCount >= this.suspicious) {
      return { level: 'suspicious', reason: `${forcedCount} forced disconnects in ${this.windowMs / 60000}m` };
    }
    return { level: 'ok', reason: '' };
  }

  reset(): void {
    this.events = [];
  }
}
