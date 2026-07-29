# PROGRESS LOG

**This file is the project's memory.** There is no long-lived chat history and no
agent remembers previous sessions. This log is how continuity survives. **Append an
entry after EVERY task — no exceptions.** Read the last few entries before starting
any work.

Newest entries at the top. Copy the template for each new entry.

---

## Template (copy me)

```
## YYYY-MM-DD — TASK-XXX: <title>
- Status: Done | Partial | Blocked
- What changed: <plain-language summary>
- Files touched: <paths>
- Verification: <exact commands run + real output, e.g. "npm test → exit 0, all suites green">
- Discovered: <anything surprising; landmines; doc corrections made>
- Decisions/assumptions: <any choice you made that the human should know>
- Next: <the next unblocked task id + one line>
```

---

## 2026-07-22 — Handoff package created (baseline, by the outgoing agent)
- Status: Done
- What changed: Wrote the full handoff package under `docs/handoff/` (HANDOFF,
  ARCHITECTURE, STATE_OF_PLAY, ROADMAP_TO_PRODUCTION, QUALITY_STANDARDS, this log,
  AGENT_ONBOARDING). No feature code changed.
- Files touched: `docs/handoff/*.md`.
- Verification (of the codebase, before writing docs):
  - `node -v` → v24.12.0; `npm -v` → 11.6.2.
  - `npm test` → **exit code 0** — typecheck + 7 self-tests (risk, media, caption,
    auth, transport, session) all green.
  - `npx prisma validate` → schema valid; `npx prisma generate` → client generated.
  - `npm run phase1` → boots, fetches live WA Web version (observed `2.3000.10…`,
    `isLatest=true`), renders a QR. **Did NOT complete a real post** (needs a phone).
  - Swept `src/` for TODO/FIXME/HACK/STUB/hardcode → **none**.
  - `git ls-files` → 33 tracked files; no secrets, no `.env`, no `.auth/` committed.
  - Repo: 4 commits, HEAD `ec46ba7`; ~1974 lines of TS across 25 source files.
- Discovered / current reality (see STATE_OF_PLAY for the full ledger):
  - The engine libraries are built + unit-tested **in isolation**; **nothing is wired
    together**; the product does not run end-to-end.
  - **`[UNVERIFIED]`**: real Status posting (Phase-1 gate), real Anthropic API call,
    proxy tunnelling, `PrismaAuthStore` against a real DB. These are the top unknowns.
  - Prisma is **schema-only** (no `prisma.config.ts`, no driver adapter, no
    migrations, no `PrismaClient` in code).
  - `.claude/settings.local.json` is untracked but **not** git-ignored (TASK-024).
  - Session code uses one shared browser fingerprint for all numbers (TASK-006).
- Decisions/assumptions: Baileys pinned `7.0.0-rc13` deliberately (DECISIONS §D3);
  topology = central backend + APK client (DECISIONS §D1); per-session sticky proxies
  (§D2); secondary numbers + drive-saves (§D4). Deployment host, proxy provider, and
  budget are **operator decisions still open**.
- Next: **TASK-001** — get a human to run `npm run phase1` and confirm a real Status
  posts. Do not build the poster (TASK-005) until this passes or the working Baileys
  version is confirmed.

---
<!-- New entries go ABOVE this line, under the template, newest first. -->
