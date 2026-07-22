/**
 * Verifies the risk engine's invariants without any external service.
 * Run: npm run test:risk
 */
import { mulberry32, hashSeed } from './rng.js';
import { TIERS, effectiveDailyCap, planDay, isWithinActiveWindow, type TierProfile } from './model.js';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

function localMinutesOf(at: Date): number {
  const localMs = at.getTime() + 180 * 60_000; // EAT
  return Math.floor(localMs / 60_000) % (24 * 60);
}

function assertPlanValid(tier: TierProfile, ageDays: number, seed: number) {
  const rng = mulberry32(seed);
  const posts = planDay({ tier, ageDays, localDate: { year: 2026, month: 7, day: 20 }, rng });
  const expected = Math.min(
    effectiveDailyCap(tier, ageDays),
    Math.floor((tier.activeEndMin - tier.activeStartMin) / tier.minGapMinutes) + 1,
  );
  check(`[${tier.name} age=${ageDays}] count == effective cap (${expected})`, posts.length === expected, `got ${posts.length}`);

  // sorted, within window, min gap respected
  let ok = true;
  for (let i = 0; i < posts.length; i++) {
    const lm = localMinutesOf(posts[i].at);
    if (lm < tier.activeStartMin || lm > tier.activeEndMin) ok = false;
    if (!isWithinActiveWindow(tier, posts[i].at)) ok = false;
    if (i > 0) {
      const gap = posts[i].localMinute - posts[i - 1].localMinute;
      if (gap < tier.minGapMinutes) ok = false;
      if (posts[i].at.getTime() < posts[i - 1].at.getTime()) ok = false;
    }
  }
  check(`[${tier.name} age=${ageDays}] all within window, sorted, min-gap>=${tier.minGapMinutes}`, ok);
}

console.log('Risk engine self-test\n');

console.log('Warm-up ramp (conservative):');
const consCaps = [0, 1, 2, 3, 4, 5, 6, 7, 30].map((d) => effectiveDailyCap(TIERS.conservative, d));
console.log('  age 0..7,30 ->', consCaps.join(', '));
check('warm-up starts at 1/day', TIERS.conservative.warmupDailyCaps[0] === 1);
check('warm-up is monotonic non-decreasing', TIERS.conservative.warmupDailyCaps.every((v, i, a) => i === 0 || v >= a[i - 1]));
check('warm-up converges to steady cap', effectiveDailyCap(TIERS.conservative, 60) === TIERS.conservative.dailyCap);
check('fresh number (age 0) posts very little (<=1)', effectiveDailyCap(TIERS.conservative, 0) <= 1);

console.log('\nPlan validity across tiers and ages:');
for (const tier of [TIERS.conservative, TIERS.standard]) {
  for (const age of [0, 2, 5, 10, 30]) {
    assertPlanValid(tier, age, hashSeed('client-A', '2026-07-20', tier.name, age));
  }
}

console.log('\nDeterminism (same seed => same plan):');
const p1 = planDay({ tier: TIERS.standard, ageDays: 30, localDate: { year: 2026, month: 7, day: 20 }, rng: mulberry32(42) });
const p2 = planDay({ tier: TIERS.standard, ageDays: 30, localDate: { year: 2026, month: 7, day: 20 }, rng: mulberry32(42) });
check('identical seeds produce identical times', JSON.stringify(p1) === JSON.stringify(p2));
const p3 = planDay({ tier: TIERS.standard, ageDays: 30, localDate: { year: 2026, month: 7, day: 20 }, rng: mulberry32(43) });
check('different seed produces a different plan (no fixed cadence)', JSON.stringify(p1) !== JSON.stringify(p3));

console.log('\nSample full-tier day (standard, warmed up), Nairobi local times:');
const sample = planDay({ tier: TIERS.standard, ageDays: 30, localDate: { year: 2026, month: 7, day: 20 }, rng: mulberry32(7) });
for (const post of sample) {
  const h = Math.floor(post.localMinute / 60);
  const m = post.localMinute % 60;
  console.log(`  ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} EAT  (${post.at.toISOString()})`);
}

console.log('');
if (failures > 0) {
  console.error(`❌ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✅ All risk-engine invariants hold.');
