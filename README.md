# WhatsApp Status Poster

Automated WhatsApp **Status** poster for small businesses. A business uploads its
catalogue, links a WhatsApp number by QR, and the system posts branded, captioned
product images to Status on a human-looking, capped, warm-up-aware schedule.

> **Status of this repo:** Phase 1 (of a phased build). Only the *risky-primitive
> proof* exists so far — see the roadmap below. Architecture decisions are recorded in
> [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Why phased

Posting to WhatsApp Status uses **Baileys**, an unofficial, reverse-engineered library.
The single biggest technical risk is that the Status-posting path is version-dependent
and has historically broken. So **Phase 1 proves it on a real number before anything
else is built.** Do not skip the gate.

## Roadmap

| Phase | Goal | Exit criterion |
|------:|------|----------------|
| **1** | Prove the risky primitive | A real Status posts from a linked number and is visible on the phone. **← here** |
| 2 | Core loop, one client | Product → Claude caption → sharp/branding overlay → posted image status |
| 3 | Persistence & reconnection | Encrypted DB auth adapter; survive restart; auto-reconnect; logout → re-scan |
| 4 | Scheduling | BullMQ delayed jobs, jitter, daily caps, quiet hours, EAT |
| 5 | Multi-client + isolation | Worker pool, session pinning, per-session proxy egress, tenant scoping |
| 6 | Risk controls | Warm-up ramps, tiers, ban-signal auto-pause, kill switches |
| 7 | Dashboard polish, tiers, consent terms | Full product mgmt + health + preferences |

## Phase 1 — run the proof

Requirements: Node ≥ 20 (tested on 24). A **secondary** WhatsApp number on a phone you
can scan with.

```bash
npm install
cp .env.example .env        # (optional) edit what/who to post
npm run typecheck           # validates the Baileys API usage compiles
npm run phase1              # prints a QR in the terminal
```

Then, on the phone with the secondary number: **WhatsApp → Settings → Linked devices →
Link a device**, and scan the QR shown in the terminal. The script connects, posts one
Status, and exits. **Verify on the phone: Updates tab → "My status".**

- By default it posts a **text** status. Set `IMAGE_PATH` in `.env` to a photo on disk
  to post an **image** status instead.
- WhatsApp Status only reaches **saved contacts**. With a fresh number the audience is
  just yourself until customers save the number (see `docs/DECISIONS.md` §D4). Use
  `STATUS_AUDIENCE` to target specific numbers while testing.

### If the post fails

That is exactly what this phase exists to surface. Capture the error and try the
fallback version: `npm i -E @whiskeysockets/baileys@6.7.23` and re-run. Report which
version posts successfully.

## Security note

`.auth/` holds live WhatsApp session credentials — it is git-ignored and must never be
committed or shared. Phase 3 replaces this file store with an encrypted, DB-backed
adapter.
