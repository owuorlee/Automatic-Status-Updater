/**
 * Risk-control engine — the anti-ban core (docs/DECISIONS.md, requirement §7).
 *
 * Pure, deterministic given an RNG. No I/O, no clock reads except what you pass
 * in. This is deliberately the most-tested module in the system: every posting
 * decision (how many, when, with what gaps, respecting warm-up and quiet hours)
 * flows through `planDay`.
 *
 * Timezone: Kenya (Africa/Nairobi) has no DST — EAT is a fixed UTC+3 year-round.
 * We model the active window in *local minutes since midnight* and convert to
 * UTC with a fixed offset. If we ever target a DST timezone, swap this one
 * conversion for luxon; nothing else changes.
 */
import { type Rng, randInt } from './rng.js';

export type RiskTierName = 'conservative' | 'standard';

export interface TierProfile {
  name: RiskTierName;
  /** Steady-state daily post cap once the number is fully warmed up. */
  dailyCap: number;
  /** Minimum minutes between two posts. Prevents bursts. */
  minGapMinutes: number;
  /** Active window, local minutes since midnight (posts only happen inside). */
  activeStartMin: number;
  activeEndMin: number;
  /**
   * Warm-up ramp: daily cap indexed by connection age in days. Day 0 is the
   * first full day after linking. Beyond the array length, `dailyCap` applies.
   * A freshly linked number posts very little and ramps as it "ages".
   */
  warmupDailyCaps: number[];
}

const NAIROBI_UTC_OFFSET_MIN = 180; // EAT = UTC+3, no DST

export const TIERS: Record<RiskTierName, TierProfile> = {
  // Ships as the default. Operator opts UP, never down (DECISIONS §7).
  conservative: {
    name: 'conservative',
    dailyCap: 4,
    minGapMinutes: 90,
    activeStartMin: 8 * 60, // 08:00
    activeEndMin: 21 * 60, // 21:00
    warmupDailyCaps: [1, 1, 1, 2, 2, 3, 3], // day0..day6, then 4
  },
  standard: {
    name: 'standard',
    dailyCap: 8,
    minGapMinutes: 60,
    activeStartMin: 8 * 60,
    activeEndMin: 21 * 60,
    warmupDailyCaps: [1, 1, 2, 2, 3, 4, 5, 6, 7], // day0..day8, then 8
  },
};

/** Effective daily cap for a number of a given connection age (in days). */
export function effectiveDailyCap(tier: TierProfile, ageDays: number): number {
  if (ageDays < 0) return 0;
  if (ageDays < tier.warmupDailyCaps.length) return tier.warmupDailyCaps[ageDays];
  return tier.dailyCap;
}

/** Max posts that physically fit in the window while respecting the min gap. */
function maxSlotsInWindow(tier: TierProfile): number {
  const windowMin = tier.activeEndMin - tier.activeStartMin;
  return Math.floor(windowMin / tier.minGapMinutes) + 1;
}

export interface PlanDayInput {
  tier: TierProfile;
  ageDays: number;
  /** Local calendar date to plan (Africa/Nairobi). month is 1-12. */
  localDate: { year: number; month: number; day: number };
  rng: Rng;
  /** Override the tz offset (default EAT, UTC+3). Minutes. */
  utcOffsetMin?: number;
  /** Optional: chance in [0,1] to drop one post from the day (human variance). */
  skipChance?: number;
}

export interface PlannedPost {
  /** Absolute posting time in UTC. */
  at: Date;
  /** Local minute-of-day it maps to (for logging/inspection). */
  localMinute: number;
}

/**
 * Produce the jittered, capped, min-gap-respecting, quiet-hours-respecting list
 * of post times for one client for one local day. Never a fixed cadence: slot
 * positions are random within the window subject only to the min-gap floor.
 */
export function planDay(input: PlanDayInput): PlannedPost[] {
  const { tier, ageDays, localDate, rng } = input;
  const offset = input.utcOffsetMin ?? NAIROBI_UTC_OFFSET_MIN;

  let count = effectiveDailyCap(tier, ageDays);
  if (count <= 0) return [];

  // Occasional human-like "quiet day": drop one post.
  if (input.skipChance && count > 1 && rng() < input.skipChance) count -= 1;

  count = Math.min(count, maxSlotsInWindow(tier));

  // Place `count` points in the window with guaranteed min spacing:
  // draw into the "compressed" free space, sort, then re-expand by i*minGap.
  const windowMin = tier.activeEndMin - tier.activeStartMin;
  const free = windowMin - (count - 1) * tier.minGapMinutes; // >= 0 by maxSlots
  const draws: number[] = [];
  for (let i = 0; i < count; i++) draws.push(randInt(rng, 0, free));
  draws.sort((a, b) => a - b);

  // Local midnight of localDate expressed in UTC ms.
  const localMidnightUtcMs =
    Date.UTC(localDate.year, localDate.month - 1, localDate.day) - offset * 60_000;

  const posts: PlannedPost[] = [];
  for (let i = 0; i < count; i++) {
    const localMinute = tier.activeStartMin + draws[i] + i * tier.minGapMinutes;
    posts.push({
      at: new Date(localMidnightUtcMs + localMinute * 60_000),
      localMinute,
    });
  }
  return posts;
}

/** True if a given UTC instant falls inside the client's active window. */
export function isWithinActiveWindow(
  tier: TierProfile,
  at: Date,
  utcOffsetMin: number = NAIROBI_UTC_OFFSET_MIN,
): boolean {
  const localMs = at.getTime() + utcOffsetMin * 60_000;
  const localMinute = Math.floor(localMs / 60_000) % (24 * 60);
  return localMinute >= tier.activeStartMin && localMinute <= tier.activeEndMin;
}
