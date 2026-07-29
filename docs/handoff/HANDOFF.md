# HANDOFF — WhatsApp Status Poster

> Master document. Read this first, then `ARCHITECTURE.md`, `STATE_OF_PLAY.md`,
> `ROADMAP_TO_PRODUCTION.md`, `QUALITY_STANDARDS.md`, `PROGRESS_LOG.md`.
> New agent: also read `AGENT_ONBOARDING.md`.
> Last verified: 2026-07-22, commit `ec46ba7`, on Node v24.12.0 / npm 11.6.2 (Windows).

## What this product is

An automated **WhatsApp Status poster** for small/medium businesses in Kenya. A
business uploads a product catalogue (photo + price + details) and links a
WhatsApp number by scanning a QR. The system then generates a marketing caption,
overlays price + branding onto the photo, and posts it to that number's WhatsApp
**Status** automatically, on a human-looking, capped, warm-up-aware schedule — so
the owner never manually posts products again.

WhatsApp Status is a primary sales channel for Kenyan SMBs. There is **no official
WhatsApp API for personal Status**, so the system drives WhatsApp through
**Baileys**, an unofficial reverse-engineered WhatsApp Web library. This means
linked numbers carry a real ban risk, and **"behave like a human / minimise ban
risk" is a first-class functional requirement**, equal to "post reliably." Do not
treat anti-ban work as optional polish.

Distribution: sold as a **sideloaded Android APK** (not Play Store). See
`ARCHITECTURE.md` §Topology — the APK is the *client*; the automation engine runs
centrally on a server. The APK does not exist yet.

## Current status (one honest sentence)

The **engine libraries are built and unit-tested in isolation** (risk scheduling,
image overlay, captions, encrypted session persistence, session lifecycle, proxy
egress), but **nothing is wired together, there is no application, no database
connection, no scheduler, no dashboard, and — critically — a real Status has never
actually been posted** (the core unofficial capability is `[UNVERIFIED]` end-to-end).

Think of it as a box of tested, well-shaped parts with no chassis yet.

## The core user journeys (target state, not current state)

1. **Onboard**: business registers → uploads products → scans QR to link a
   secondary WhatsApp number → sets preferences (tier, language, quiet hours).
2. **Autopilot**: scheduler picks slots within active hours (jittered, capped,
   warm-up-aware) → caption generated → price/branding overlaid → posted to Status.
3. **Stay healthy**: on a transient drop the session auto-reconnects; on a real
   logout the dashboard prompts a re-scan; on ban signals the number auto-pauses
   and the operator is alerted. Operator can pause globally or per client.

## Tech stack (verified from `package.json`)

| Area | Choice | Version | Why |
|---|---|---|---|
| Language/runtime | TypeScript on Node | TS `^5.7.3`, Node `>=20` (tested 24.12.0) | Type-safe end-to-end; ESM (`"type":"module"`). |
| Run/exec | `tsx` | `^4.19.2` | Runs `.ts` directly — **there is no build step / no `dist`**. |
| WhatsApp | `@whiskeysockets/baileys` | **`7.0.0-rc13` (pinned exact)** | Only route to personal Status. RC is the `latest` dist-tag; `6.7.23` is `legacy` fallback. See landmines. |
| Captions | `@anthropic-ai/sdk` | `^0.114.0` | Claude Messages API. Default model `claude-haiku-4-5-20251001`. |
| Images | `sharp` | `^0.35.3` | Fast compositing; SVG-overlay pattern for crisp text. |
| DB (schema only) | `prisma` + `@prisma/client` | `^7.9.0` | Postgres. **No client instantiation / no migrations yet.** |
| Proxy egress | `https-proxy-agent`, `socks-proxy-agent` | `^9.1.0`, `^10.1.0` | Per-session sticky proxy (anti-ban network layer). |
| Logging | `pino` | `^9.5.0` | Structured logs (Baileys' logger). |
| QR (terminal) | `qrcode-terminal` | `^0.12.0` | Renders the pairing QR in the Phase 1 proof. |

There is **no** test framework, **no** web framework, **no** queue library, **no**
Redis client, **no** Docker, **no** CI installed yet. Tests are hand-rolled `tsx`
scripts (see `QUALITY_STANDARDS.md`).

## Get running in 10 minutes (verified commands)

```bash
# 1. Install (Node >=20 required; tested on 24.12.0)
npm install
#    Expected: "added N packages". If you hit `ECONNRESET`, just re-run — it's a
#    transient npm registry blip, not a real failure (seen during this build).

# 2. Typecheck + run the full self-test suite
npm test
#    Expected: prints each suite's ✓ lines and ends green. Verified exit code 0.
#    (Runs: tsc --noEmit, then risk, media, caption, auth, transport, session.)

# 3. (Optional) generate the Prisma client from the schema — no DB needed
npm run db:generate
#    Expected: "✔ Generated Prisma Client (v7.9.0)". (Migrations DO need a DB; none exist yet.)
```

That is the entire "it works" surface today. **You cannot yet run the product** —
there is no server, worker, or dashboard to start. The next runnable milestone is
the Phase 1 live scan (needs a real phone) and then the poster (see roadmap M1).

To attempt the Phase 1 proof (needs a **secondary** WhatsApp number + a phone):
```bash
cp .env.example .env    # optional; defaults work
npm run phase1          # prints a QR in the terminal; scan it, watch for a posted status
```
Verified: it boots, fetches the live WhatsApp Web version, and renders a QR.
**Not verified: that scanning it actually results in a visible Status** — that is
the open Phase 1 gate (see `ROADMAP` TASK-001).

## Environment variables

None are required for `npm test`. Required-for-what is in the table.

| Name | Purpose | Example | Where to get it | Required for |
|---|---|---|---|---|
| `DATABASE_URL` | Postgres connection (Prisma migrate + driver adapter) | `postgresql://postgres:postgres@localhost:5432/wa_status?schema=public` | Your Postgres instance | DB work (M1+); not needed for tests |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM at-rest encryption of session creds/keys | 64 hex chars | Generate: `npm run gen:key` | Any real session persistence. **Keep stable & secret** |
| `ANTHROPIC_API_KEY` | Enables real Claude captions (blank ⇒ graceful local fallback) | `sk-ant-...` | console.anthropic.com | Real captions; blank is fine for dev |
| `CAPTION_MODEL` | Override caption model | `claude-haiku-4-5-20251001` | — | No (has default) |
| `BAILEYS_LOG_LEVEL` | Baileys/pino log level | `silent` | — | No |
| `AUTH_DIR` | Phase-1 proof file-auth dir (proof only) | `.auth/phase1` | — | Phase 1 proof only |
| `IMAGE_PATH`, `CAPTION`, `STATUS_TEXT`, `BG_COLOR`, `STATUS_AUDIENCE` | Phase-1 proof knobs | see `.env.example` | — | Phase 1 proof only |

**Never invent secret values. Never commit `.env`.** (It is git-ignored.)

## External services

| Service | Role | Status |
|---|---|---|
| WhatsApp (via Baileys) | The channel — posts to `status@broadcast` | Integrated in code; `[UNVERIFIED]` live |
| Anthropic Claude API | Generates captions | Integrated; real call `[UNVERIFIED]` (no key used yet) |
| Postgres | Datastore (tenants, sessions, products, queue) | Schema only; not connected |
| Redis | Durable job queue (BullMQ) + pub/sub for QR streaming | **Not started** (planned) |
| Object storage (R2/Backblaze/S3) | Product photos + rendered images | **Not started** (schema stores keys only) |
| Proxy provider (mobile/residential, Kenya) | Per-session egress IP (anti-ban) | Code ready; no provider wired/tested |

## Map of the codebase

Single ESM TypeScript package. No build output. Run files with `tsx`.

| Path | What it does | Touch when |
|---|---|---|
| `src/phase1/link-and-post.ts` | Standalone proof: QR-link a number, post one Status. Uses Baileys' file auth (demo only). | Validating the primitive; never ships as-is |
| `src/risk/model.ts` | Risk engine: tiers, warm-up ramp, `planDay()` (jittered/capped/quiet-hours schedule). Pure. | Scheduling logic, caps, warm-up |
| `src/risk/rng.ts` | Seedable PRNG + string hash for reproducible schedules. | Rarely |
| `src/media/overlay.ts` | `renderStatusImage()` — sharp + SVG price/branding overlay → 1080×1920 JPEG. | Image/branding changes |
| `src/caption/service.ts` | `generateCaption()` — Claude with graceful fallback; pluggable transport. | Caption logic |
| `src/caption/{prompt,fallback,types}.ts` | Prompt builder, deterministic fallback, types. | Caption prompts/controls |
| `src/crypto/encryptor.ts` | AES-256-GCM encrypt/decrypt; key loading; `gen:key`. | Anything touching secrets at rest |
| `src/wa/auth/state.ts` | `useEncryptedAuthState()` — Baileys auth state persisted+encrypted (drop-in for `useMultiFileAuthState`). | Session persistence |
| `src/wa/auth/store.ts` | `AuthStore` interface + `InMemoryAuthStore` + (de)serialize. | Persistence backends |
| `src/wa/auth/prismaStore.ts` | Postgres-backed `AuthStore`. Typechecked, **never run against a DB**. | DB persistence |
| `src/wa/session/manager.ts` | `SessionManager` — full per-number lifecycle orchestrator (QR/reconnect/logout/ban/kill-switch). Injectable socket+scheduler. | Session behaviour |
| `src/wa/session/classify.ts` | Maps `DisconnectReason` → action (reconnect/rescan/fatal). Pure. | Disconnect handling |
| `src/wa/session/backoff.ts` | Exponential backoff + jitter. Pure. | Reconnect timing |
| `src/wa/session/banDetector.ts` | Ban-signal heuristics → verdict. Pure. | Anti-ban tuning |
| `src/wa/session/stateMachine.ts` | Session state transitions + `canPost()`. Pure. | Lifecycle states |
| `src/wa/session/events.ts` | `ManagerEvent` types emitted for dashboard/ops. | Event contract |
| `src/wa/transport/proxyTransport.ts` | `ProxyAgentTransport` — sticky per-session proxy agent. | Proxy egress |
| `src/wa/transport/types.ts` | `SessionTransport` interface, `ProxyConfig`, `DirectTransport`. | Transport contract |
| `src/**/selftest.ts` | Hand-rolled test scripts (one per module). Run via `npm run test:*`. | After changing a module |
| `prisma/schema.prisma` | Data model (Postgres). No datasource URL (Prisma 7), no migrations. | Data model changes |
| `docs/DECISIONS.md` | The Phase-0 architecture decision record. Read before changing topology/network/versions. | Architecture changes |
| `README.md` | Public-facing overview + phased roadmap. | — |

## Known bugs / broken / missing

- **The product does not run end-to-end.** No app entrypoint, no DB connection, no
  queue, no dashboard, no poster glue. All of `ROADMAP` M1–M6 is outstanding.
- **A real Status post has never succeeded** here. `[UNVERIFIED]`. Baileys status
  posting is historically fragile/version-sensitive (see landmines). This is the
  single biggest project risk — validate it before building more.
- **Prisma is schema-only.** No `prisma.config.ts`, no driver adapter, no
  `PrismaClient` instantiation, no migrations. `prismaStore.ts` typechecks but has
  never touched a database. Prisma 7 requires a driver adapter at runtime.
- **Captions never hit the real API.** Only the fallback and an injected fake
  transport are exercised. The real Anthropic call path is `[UNVERIFIED]`.
- **Proxy tunnelling is `[UNVERIFIED]`.** Agents are constructed and unit-checked,
  but never used to actually connect Baileys to WhatsApp through a real proxy.
- **No secrets management, validation, rate limiting, error boundaries, health
  checks, CI, or deploy.** See roadmap M4–M6.
- `.claude/settings.local.json` exists and is **not** git-ignored (untracked today,
  but a `git add -A` could commit it). Add `.claude/` to `.gitignore` (roadmap M4).

## Landmines (non-obvious things that will bite you)

1. **Baileys version is an exact-pinned release candidate (`7.0.0-rc13`).** This is
   deliberate (`docs/DECISIONS.md` §D3): the `latest` dist-tag is the RC; `6.7.23`
   is tagged `legacy`. Do **not** "upgrade to stable" — there isn't one, and the
   6.x line bit-rots against WhatsApp's servers. If status posting fails, the
   documented fallback is `6.7.23`. Change the version **only** with a recorded
   reason and a re-run of the Phase 1 proof.
2. **Prisma 7 removed `url` from the datasource block** and dropped implicit `.env`
   loading. Runtime needs a **driver adapter** (e.g. `@prisma/adapter-pg`) passed to
   `new PrismaClient()`, and Migrate needs the URL in a `prisma.config.ts`. The
   `toBytes()` helper in `prismaStore.ts` exists because Prisma 7 `Bytes` columns
   demand `Uint8Array<ArrayBuffer>`, which Node's `Buffer` does not satisfy under
   strict TS — do not "simplify" it back to a bare `Buffer`.
3. **WhatsApp Status only reaches SAVED CONTACTS** (`statusJidList`). A brand-new
   secondary number posts to nobody. This is a product constraint, not a bug — the
   business model depends on driving customers to save the number
   (`DECISIONS.md` §D4). Don't "fix" empty-audience posts by removing the audience.
4. **`ENCRYPTION_KEY` is load-bearing and unrecoverable.** Lose or rotate it and
   every stored session becomes undecryptable → every client must re-scan. Treat it
   as a permanent secret; plan key management before storing real sessions.
5. **`markOnlineOnConnect: false` is deliberate** in the session code — the linked
   phone keeps presence; the bot must not steal it (looks bot-like otherwise).
6. **Tests are not a framework.** `npm test` chains `tsx` scripts that `process.exit(1)`
   on failure. They assert with a local `check()`. Don't assume Jest/Vitest globals.
7. **No build step.** Everything runs from `.ts` via `tsx`. Don't add a bundler
   without a reason; production will likely run `tsx`/`node --import tsx` or compile.
8. **All source is ESM with `.js` import specifiers** (`import x from './y.js'`)
   pointing at `.ts` files — required by `moduleResolution: bundler`/NodeNext ESM.
   Keep the `.js` suffix on relative imports or resolution breaks.

## Glossary

- **Status / `status@broadcast`**: WhatsApp "story" posted to the special broadcast
  JID; visible to saved contacts you include in `statusJidList`.
- **Baileys**: unofficial WhatsApp Web library used to drive Status.
- **Companion / linked device**: a WhatsApp Web session paired via QR to a phone.
- **Warm-up**: gradually ramping a new number's daily post volume to look human.
- **Tier**: a bundle of anti-ban settings (caps, jitter, warm-up length, quiet hours) — `conservative` (default) or `standard`.
- **Sticky proxy**: one fixed egress IP kept for a session's whole life (no IP hopping).
- **Kill switch**: global/per-client pause honoured immediately by workers.
- **`planDay`**: the risk engine function that produces a day's jittered post times.
- **Signal keys**: Baileys' per-session cryptographic key store (many small rows).
