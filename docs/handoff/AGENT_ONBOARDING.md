# AGENT ONBOARDING — read this first

Hello. You are taking over this project cold. Nobody remembers the previous
sessions, and neither do you — the docs in `docs/handoff/` are your only memory.
Trust them, keep them true, and update them as you work.

## What this project is (three sentences)

It's a backend that automatically posts businesses' products to their WhatsApp
**Status** on a human-looking, ban-aware schedule, for small businesses in Kenya.
It drives WhatsApp through **Baileys**, an *unofficial* library — so "behave like a
human / avoid getting the number banned" is a real, first-class requirement, not a
nice-to-have. Today the individual engine parts are built and unit-tested, but
**nothing is wired together and a real Status has never actually posted yet**.

## Before you write ANY code

1. Read, in this order:
   1. `docs/handoff/HANDOFF.md` (what/why/how-to-run/landmines)
   2. `docs/handoff/ARCHITECTURE.md` (how it fits together)
   3. `docs/handoff/STATE_OF_PLAY.md` (what's real vs faked — read carefully)
   4. `docs/handoff/QUALITY_STANDARDS.md` (the rules you must follow)
   5. `docs/handoff/ROADMAP_TO_PRODUCTION.md` (your task list)
   6. `docs/handoff/PROGRESS_LOG.md` (what happened most recently)
   7. `docs/DECISIONS.md` (the architecture decision record — the *why*)
2. Get it running: `npm install` then `npm test` (expect exit 0, all green). If that
   doesn't pass, stop and fix that first — don't build on a red base.
3. Re-read the specific files you're about to touch. Do not rely on memory or these
   docs alone for exact APIs — open the real code and the library types.

## Your operating loop (every session)

```
1. Read PROGRESS_LOG.md (last few entries) + this file.
2. Pick the next unblocked task from ROADMAP_TO_PRODUCTION.md
   (lowest milestone, respect "Depends on", prefer P0).
3. Re-read the files that task will touch; find the existing pattern to imitate.
4. Implement ONLY that task. No scope creep.
5. Verify for real: npm run typecheck && npm test (+ the task's "How to verify").
   Observe the actual output — never claim a green build you didn't see.
6. Append a PROGRESS_LOG.md entry (use the template): what changed, files,
   real verification output, anything discovered, what's next.
7. Commit: one task per commit, message references the TASK id.
```

## Hard rules you must never break

- **Never fabricate** an API, method, env var, file path, or "it passes." Verify.
- **Never commit secrets** or `.env`; never hardcode keys/URLs — use env vars.
- **Never leave stubs/TODOs/mocks on a shipping path.** Mark `// STUB:` + add a task.
- **Never restyle or rewrite working code** you weren't asked to touch. Match the
  existing conventions (ESM, `.js` import suffixes, pure-logic-vs-I/O split, injected
  deps, file-header comments, per-module `selftest`).
- **Never change the pinned Baileys version** except per `DECISIONS.md` §D3, and
  re-run the Phase-1 proof if you do.
- **Handle every error explicitly**; validate all external input at the boundary.
- **If blocked, or if reality contradicts these docs, STOP** — update the docs and
  flag it to the human in `PROGRESS_LOG.md`. Do not guess.

## The single most important thing right now

Start at **TASK-001**: prove that a real image Status actually posts from a real
(secondary) WhatsApp number. Everything else assumes it works, and it is currently
**unverified**. Don't build the poster or the scheduler until that's confirmed (or
the working Baileys version is recorded). This needs a human with a phone — ask.
