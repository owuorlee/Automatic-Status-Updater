# STATE OF PLAY

Feature-by-feature truth. **This is the most important doc — never mistake a
tested-in-isolation library for a working feature.** "Done" below means "built and
unit-tested as an isolated module," NOT "wired into a running product." Nothing is
integrated; the product does not run end-to-end.

Legend: **Done** (built + self-tested in isolation) · **Partial** · **Stubbed** ·
**Not started** · **Broken**. Confidence = how sure we are it works *as verified*.

| Feature | Status | Where | What's missing | Confidence |
|---|---|---|---|---|
| Risk scheduling engine (tiers, warm-up ramp, jittered `planDay`, quiet hours) | **Done** | `src/risk/model.ts`, `rng.ts` | Not wired to any scheduler/DB; EAT offset is hardcoded UTC+3 (fine for Kenya, no DST) | High (unit-tested) |
| Image overlay pipeline (`renderStatusImage`) | **Done** | `src/media/overlay.ts` | Real product photos come from object storage (not built); **WhatsApp accepting the output is `[UNVERIFIED]`** | High for rendering; Unverified end-to-end |
| Caption service (Claude + fallback) | **Partial** | `src/caption/*` | **Real Anthropic API call `[UNVERIFIED]`** — only the deterministic fallback and an *injected fake* transport have run. No key ever used | High (fallback); Unverified (live API) |
| AES-256-GCM crypto | **Done** | `src/crypto/encryptor.ts` | — | High (unit-tested) |
| Encrypted auth adapter (in-memory) | **Done** | `src/wa/auth/state.ts`, `store.ts` | — | High (round-trip tested) |
| Encrypted auth adapter (Postgres) | **Partial** | `src/wa/auth/prismaStore.ts` | **Typechecked only — NEVER run against a database.** May have runtime bugs | Medium |
| Session manager (lifecycle, reconnect, ban auto-pause, kill switch) | **Done (vs fake socket)** | `src/wa/session/*` | **Never driven by a real Baileys socket `[UNVERIFIED]`**; browser fingerprint not yet per-session (see below) | High (orchestration logic); Unverified live |
| Disconnect classify / backoff / ban detector / state machine | **Done** | `src/wa/session/{classify,backoff,banDetector,stateMachine}.ts` | — | High (unit-tested) |
| Proxy transport (sticky per-session agent) | **Partial** | `src/wa/transport/*` | Agents are constructed + unit-checked, but **never used to actually tunnel Baileys→WhatsApp `[UNVERIFIED]`**; no proxy provider configured | Medium |
| Phase-1 proof (QR link + post one Status) | **Partial** | `src/phase1/link-and-post.ts` | Boots + renders QR (verified). **Posting a visible Status is `[UNVERIFIED]`** — the open Phase-1 gate. Uses file auth (demo only) | Medium |
| Data model (schema) | **Partial** | `prisma/schema.prisma` | Valid + client generates. **No datasource URL, no `prisma.config.ts`, no driver adapter, no migrations, no `PrismaClient` in code** | High (schema); Not started (usage) |
| The poster (planDay→caption→overlay→send glue) | **Not started** | — | The entire core loop wiring | — |
| Session pool/registry + rehydrate-on-boot | **Not started** | — | Managing many `SessionManager`s; loading active sessions at startup | — |
| Scheduler / job queue (BullMQ + Redis) | **Not started** | — | Redis, BullMQ, enqueue from `planDay`, consume + post | — |
| Object storage (photos + renders) | **Not started** | — | `imageKey`/`renderedKey`/`logoKey` referenced in schema; no storage client | — |
| Web dashboard (Next.js) | **Not started** | — | Entire frontend + API | — |
| Business auth/login | **Not started** | schema `passwordHash` only | Registration, login, session, per-tenant scoping | — |
| Product management + upload UI | **Not started** | — | CRUD + image upload | — |
| Live QR streaming (Redis pub/sub → SSE) | **Not started** | events exist in `events.ts` | Transport from worker → browser | — |
| Preferences (tier/language/quiet hours) UI | **Not started** | fields in schema | UI + API | — |
| Warm-up wiring (connection age → volume) | **Partial** | risk engine supports `ageDays` | Not connected to `WhatsappSession.connectedAt` | Low |
| Kill switches (persisted + honoured) | **Partial** | `SessionManager` honours `shouldRun`; `Business.paused` field exists | No persistence read/write, no propagation to workers | Low |
| Observability (health/metrics/alerts/log pipeline) | **Not started** | `pino` present, unused as a service | — | — |
| Consent/terms (secondary-number risk) | **Not started** | — | Client-facing copy + acceptance record | — |
| APK client | **Not started** | — | The entire distributable client | — |
| Deploy (Docker, compose, CI, staging) | **Not started** | — | Everything ops | — |
| Test framework + CI | **Partial** | hand-rolled `src/**/selftest.ts` | No Vitest/Jest, no coverage, no CI | Medium |

## Things that are faked / mocked / hardcoded / demo-only (will break in prod)

1. **Captions**: with no `ANTHROPIC_API_KEY`, the service silently returns
   deterministic **fallback** captions (by design). If you deploy without a key,
   every caption is a template — *looks* working, isn't AI. The real API path is
   unproven.
2. **Phase-1 proof auth** uses Baileys' `useMultiFileAuthState` (file store) —
   explicitly demo-only per Baileys docs. Production must use
   `useEncryptedAuthState` + `PrismaAuthStore`.
3. **`PrismaAuthStore`** compiles but has never executed a query. Treat as unproven
   until run against a real Postgres (roadmap M1).
4. **`DirectTransport`** (no proxy) is for local/dev only. Using it at scale defeats
   the entire anti-ban network strategy (DECISIONS §D2). Production must use
   `ProxyAgentTransport` with a real per-session proxy.
5. **Browser/device fingerprint**: `SessionManager` currently defaults **every**
   session to `Browsers.ubuntu('Chrome')`. DECISIONS §D2 requires a *stable but
   distinct-per-number* fingerprint (persist `WhatsappSession.browserFingerprint`
   and reuse it). Same fingerprint across 200 numbers is itself a ban signal — fix
   before multi-client (roadmap M2).
6. **Baileys WA version**: the Phase-1 proof fetches the live version; the
   `SessionManager` expects the caller to pass one. There is no shared version
   resolver yet — pick one place to resolve/pin it (roadmap M1).
7. **Self-tests are scripts, not a suite**: they prove logic but give no coverage
   metrics and don't run in CI. Don't cite them as production test coverage.

## The one thing to de-risk before anything else

**Post a real image Status from a real (secondary) number and see it appear.**
Everything downstream assumes Baileys `7.0.0-rc13` can do this. It is `[UNVERIFIED]`
and historically fragile. See `ROADMAP` TASK-001. If it fails, fall back to
`6.7.23` and record which version works before building the poster.
