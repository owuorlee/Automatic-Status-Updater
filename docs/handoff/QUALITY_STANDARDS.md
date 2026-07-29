# QUALITY STANDARDS

Direct instructions to the next agent. These are derived from how this codebase is
**actually** written — follow them so the project stays coherent. When in doubt,
open a neighbouring file and copy its shape.

## 0. The prime directive: read before you write

Before writing anything, locate the existing pattern and imitate it. This repo has
strong, consistent conventions (below). A change that matches the surrounding code
is worth more than a "better" one that doesn't. **Do not restyle, "modernise," or
refactor working code** you were not asked to change.

## 1. Language / module conventions (observed, non-negotiable)

- **ESM only.** `"type": "module"`. Every relative import uses a **`.js` suffix**
  even though the file is `.ts` (`import { x } from './model.js'`). This is required
  by the TS module resolution here — keep it or imports break at runtime.
- **No build step.** Code runs from `.ts` via `tsx`. Don't introduce a bundler or a
  `dist/` without a recorded reason.
- **Strict TypeScript** (`tsconfig.json`: `strict`, `noEmit`, `moduleResolution:
  bundler`). Code must pass `npm run typecheck` with zero errors. No `// @ts-ignore`
  to paper over real type problems — fix the type. Casts (`as`) are allowed only at
  genuine I/O boundaries (see `prismaStore.ts` `toBytes`, or the fake-socket cast in
  session selftest) and should be commented.
- **Naming**: `camelCase` functions/vars; `PascalCase` types/interfaces/classes/enums;
  file names are `camelCase.ts` (`banDetector.ts`, `proxyTransport.ts`) or a single
  lowercase word (`model.ts`, `store.ts`). Test files are `*.selftest.ts` (until
  TASK-032 migrates to Vitest `*.test.ts`).

## 2. Architecture conventions (imitate these)

- **Separate pure logic from I/O.** Business/anti-ban logic goes in pure,
  deterministic functions/classes with no network/DB/clock-reads. I/O (Baileys, DB,
  Anthropic, proxies) is a thin outer shell. See `src/wa/session/` — the manager is
  the shell; `classify`/`backoff`/`banDetector`/`stateMachine` are pure.
- **Inject dependencies for testability.** Anything that would need a network/DB/timer
  must be injectable so it can be tested with a fake. Examples to copy: `SessionManager`'s
  `createSocket` + `schedule`; the caption service's `transport`; `AuthStore` and
  `SessionTransport` interfaces. New posting/scheduler code MUST follow this.
- **Graceful degradation on the posting path.** A caption/API failure must never block
  a post — fall back with a `reason`, never throw into the pipeline (see
  `src/caption/service.ts`). Preserve this property.
- **Pluggable seams stay pluggable.** Don't hardcode a backend where an interface
  exists (`AuthStore`, `SessionTransport`, caption `transport`).

## 3. File-header comments

Every source file opens with a short block comment stating **what it does and why**,
referencing `docs/DECISIONS.md` or the brief's requirement number where relevant.
Match this density — enough to orient a cold reader, not a novel. Explain the
non-obvious (why `markOnlineOnConnect:false`, why `toBytes` exists), not the obvious.

## 4. Errors, validation, secrets

- **Handle errors explicitly.** No empty `catch {}` that hides a failure. Either
  handle it, degrade with a recorded `reason`, or rethrow. The only acceptable silent
  catches here are the deliberate "never let a subscriber throw into the manager"
  guards — and those are commented.
- **Every user-facing failure needs a real message and a real state** (error/empty/
  loading), not a blank screen or a swallowed exception.
- **Validate all external input at the boundary** (API bodies, env, uploads). Never
  trust the client. Use `zod` (added in TASK-026).
- **Never commit secrets. Never hardcode credentials, keys, or URLs.** Use env vars,
  documented in `.env.example` with **empty** values. `ENCRYPTION_KEY` is unrotatable
  — treat it accordingly.

## 5. Never fabricate

Do not invent an API, library method, env var, config option, or file path. If you're
unsure how Baileys, Prisma 7, BullMQ, or the Anthropic SDK works, **read the docs or
the installed types first**. This project has already been bitten by API drift
(Prisma 7 dropped datasource `url`; Baileys status posting is version-sensitive).
Fabricated confidence causes real damage — verify.

## 6. Tests

- **Framework**: today, hand-rolled `tsx` scripts (`src/**/selftest.ts`) with a local
  `check(name, cond, detail)` that prints `✓`/`✗` and `process.exit(1)` on any failure,
  ending with a `✅` line. New modules get a matching `*.selftest.ts` + a `test:<name>`
  script wired into the root `test` script. (After TASK-032, use Vitest instead —
  same rigour, `test()`/`expect()`.)
- **The P0 rule**: every P0 task ships with a test that **fails before your change and
  passes after**. Write the failing test first where practical.
- **Test the logic offline.** Prefer driving code with injected fakes (fake socket,
  in-memory store, fake queue) over requiring live services.

## 7. Verify before you claim done

Run and observe — do not claim a green build you didn't see:
```bash
npm run typecheck      # zero errors
npm test               # all suites green, exit 0
npx prisma validate    # if you touched the schema
```
Paste the **real** output into your `PROGRESS_LOG.md` entry. "Tests pass" without
evidence is not acceptable — this project's whole handoff depends on honest status.

## 8. Scope discipline

- **Implement the task, nothing more.** No silent scope creep. If you spot adjacent
  work, note it in `PROGRESS_LOG.md` / propose a new TASK — don't just do it.
- **No stubs/mocks/TODOs left on a shipping path.** If you must stub, mark it
  `// STUB:` and add a roadmap task. (The codebase is currently stub-free — keep it so.)
- **Don't delete or rewrite code you don't understand.** Ask the human, or leave it
  and flag it. Several things that look wrong are deliberate (see HANDOFF landmines).

## 9. Dependencies

- **Don't add/upgrade/downgrade a dependency without a recorded reason** in
  `PROGRESS_LOG.md`. Prefer the standard library or what's already installed.
- **Baileys stays exact-pinned** (`7.0.0-rc13`); change it only per DECISIONS §D3 and
  re-run the Phase-1 proof.

## 10. Commits

- Small, focused commits — **one task per commit**. Message references the TASK id and
  states what changed and how it was verified, e.g.:
  `TASK-005: poster module (caption→overlay→sendMessage); test:poster green`.
- Keep the existing trailer style if you like, but the TASK id is the important part.
- Never commit `.env`, `.auth/`, secrets, or `.claude/` (add the latter to
  `.gitignore` — TASK-024).

## 11. Accessibility & responsive (for any UI you build)

Treat these as **acceptance criteria, not polish**: keyboard-navigable, labelled
inputs, sufficient contrast (WCAG AA), and layouts that work at 375 / 768 / 1440 px.

## 12. When reality contradicts these docs

The docs describe a snapshot. If you find them wrong or stale, **update the doc in the
same PR and flag it to the human in `PROGRESS_LOG.md`** — don't silently diverge, and
don't guess. The docs are the shared memory; keep them true.
