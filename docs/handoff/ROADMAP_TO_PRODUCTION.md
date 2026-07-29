# ROADMAP TO PRODUCTION

Every remaining task from today to launch, in dependency order, grouped into
milestones. Each task is sized for a single short agent session. **Do tasks in a
milestone roughly in order; respect `Depends on`.** Priority: **P0** blocks launch,
**P1** should-have, **P2** post-launch. If low on capacity, cut P2 then P1; never cut P0.

Conventions used below:
- "engine" = the tested libraries in `src/` (risk, media, caption, wa/*).
- "imitate X" = copy the existing pattern in file X rather than inventing one.
- Every task ends by updating `PROGRESS_LOG.md` and a focused commit (see `QUALITY_STANDARDS.md`).

Milestones: **M1** core loop · **M2** scheduling & multi-client · **M3** dashboard
& onboarding · **M4** security & hardening · **M5** testing & observability · **M6**
deploy & launch.

---

## M1 — Core loop (single client, no scheduler)

### TASK-001: Verify a real Status actually posts (the Phase-1 gate)
- Milestone: M1 · Priority: **P0** · Depends on: none
- Why: everything assumes Baileys `7.0.0-rc13` can post an image Status; this is `[UNVERIFIED]` and historically fragile.
- Files to touch: none (runtime verification) → then record result in `PROGRESS_LOG.md` and `docs/DECISIONS.md` §D3.
- Approach: `cp .env.example .env`; set `IMAGE_PATH` to a real JPEG; `npm run phase1`; scan with a **secondary** number; confirm the Status is visible on the phone. If it does NOT appear: `npm i -E @whiskeysockets/baileys@6.7.23`, re-run, compare. Requires a human with a phone — coordinate with the operator.
- Acceptance criteria: a Status posted from a linked number is visibly present under "My status"; the working Baileys version is recorded.
- How to verify: visual confirmation on the phone + a `PROGRESS_LOG` entry stating the version.
- Out of scope: any refactor of the proof; the DB; the scheduler.

### TASK-002: Prisma runtime client (Prisma 7 driver adapter + singleton)
- Milestone: M1 · Priority: **P0** · Depends on: none
- Why: the schema exists but no code can talk to Postgres; Prisma 7 needs a driver adapter.
- Files to touch: `prisma.config.ts` (new), `src/db/client.ts` (new), `package.json` (add `@prisma/adapter-pg`, `pg`).
- Approach: create `prisma.config.ts` with the datasource URL from `DATABASE_URL` (Prisma 7 loads env here); in `src/db/client.ts` export a `PrismaClient` singleton constructed with `new PrismaAdapterPg(...)`. Follow current Prisma 7 docs (do NOT guess the API — read them).
- Acceptance criteria: a throwaway script `prisma.$queryRaw\`SELECT 1\`` succeeds against a local Postgres.
- How to verify: run the script; expect a `[{ '?column?': 1 }]`-style result. `npx prisma validate` still passes.
- Out of scope: migrations (TASK-003); business logic.

### TASK-003: Initial migration
- Milestone: M1 · Priority: **P0** · Depends on: TASK-002
- Why: no tables exist.
- Files to touch: `prisma/migrations/**` (generated).
- Approach: with a local Postgres + `DATABASE_URL` set, `npx prisma migrate dev --name init`.
- Acceptance criteria: all models become tables; `npx prisma migrate status` is clean.
- How to verify: `npx prisma migrate status`; inspect tables (`\dt`).
- Out of scope: seed data; indexes tuning (TASK-035).

### TASK-004: Integration-test `PrismaAuthStore` against real Postgres
- Milestone: M1 · Priority: **P0** · Depends on: TASK-002, TASK-003
- Why: `prismaStore.ts` is typechecked but never executed — unproven.
- Files to touch: `src/wa/auth/prismaStore.integration.ts` (new), `package.json` (script `test:auth:db`).
- Approach: create a `Business` + `WhatsappSession` row; imitate `src/wa/auth/selftest.ts` but pass `new PrismaAuthStore(prisma, sessionId)` instead of `InMemoryAuthStore`. Round-trip creds + several signal keys; assert equality; clean up.
- Acceptance criteria: creds + `pre-key`/`session`/`app-state-sync-key` round-trip through Postgres, encrypted at rest.
- How to verify: `npm run test:auth:db` exits 0 (needs a running Postgres).
- Out of scope: the in-memory tests (leave them).

### TASK-005: The poster module
- Milestone: M1 · Priority: **P0** · Depends on: TASK-001
- Why: the missing glue that ties caption + overlay + socket into one post.
- Files to touch: `src/wa/poster.ts` (new), `src/wa/poster.selftest.ts` (new), `package.json` (script `test:poster`).
- Approach: `postProductStatus({ sock, product, template, audience, caption? })`: if no caption, call `generateCaption`; load the product image bytes; `renderStatusImage`; then `sock.sendMessage('status@broadcast', { image, caption }, { broadcast:true, statusJidList: audience })`. Keep `sock` injectable (imitate the fake-socket pattern in `src/wa/session/selftest.ts`).
- Acceptance criteria: with a fake sock, the emitted `sendMessage` call has the correct JID, `image` buffer, `caption`, `broadcast:true`, and a non-empty `statusJidList`; a caption failure still yields a post (fallback).
- How to verify: `npm run test:poster` exits 0.
- Out of scope: scheduling; audience computation from contacts (keep it a param).

### TASK-006: Per-session browser fingerprint
- Milestone: M1 · Priority: **P0** · Depends on: none
- Why: every session currently uses the same `Browsers.ubuntu('Chrome')` — identical fingerprints across numbers is a ban signal (DECISIONS §D2).
- Files to touch: `src/wa/session/fingerprint.ts` (new + selftest), `src/wa/session/manager.ts`.
- Approach: derive a **stable, distinct** fingerprint per session from a realistic pool (seed with `sessionId`), persist to `WhatsappSession.browserFingerprint`, and pass it as `browser` to `makeWASocket`. Never randomise on reconnect.
- Acceptance criteria: same `sessionId` → same fingerprint across calls; different sessions differ; values come from a plausible pool.
- How to verify: `npm run test:session` (extend it) exits 0.
- Out of scope: proxy wiring.

### TASK-007: Shared Baileys version resolver
- Milestone: M1 · Priority: **P0** · Depends on: none
- Why: two call sites resolve the WA version differently; centralise + provide an offline fallback.
- Files to touch: `src/wa/version.ts` (new), update `src/phase1/link-and-post.ts` to use it.
- Approach: wrap `fetchLatestBaileysVersion()` with a cached pinned fallback `[2,3000,0]`-style constant; export `resolveWaVersion()`.
- Acceptance criteria: returns a `[number,number,number]`; falls back offline without throwing.
- How to verify: unit test with network disabled returns the fallback.
- Out of scope: pinning strategy debates (record any change in DECISIONS).

### TASK-008: Worker entrypoint — real single-session core loop
- Milestone: M1 · Priority: **P0** · Depends on: TASK-002, TASK-004, TASK-005, TASK-006, TASK-007
- Why: first time the product actually runs: link a number and post a real product Status.
- Files to touch: `src/worker/index.ts` (new), `package.json` (script `worker`).
- Approach: load one `WhatsappSession` from DB → `useEncryptedAuthState(new PrismaAuthStore(...))` → `SessionManager` with a **real** `makeWASocket` + `DirectTransport` (proxy comes in M2) → on `connected`, call `postProductStatus` for one active product. Log via pino.
- Acceptance criteria: [human] links a secondary number; one real branded product Status appears on the phone.
- How to verify: `npm run worker` + a scan; visual confirmation; `ScheduledPost`/log records success.
- Out of scope: scheduling, multi-session, proxies.

---

## M2 — Scheduling & multi-client

### TASK-009: Redis + BullMQ queue module
- Milestone: M2 · Priority: **P0** · Depends on: TASK-002
- Why: durable, delayed, restart-surviving post jobs.
- Files to touch: `src/queue/index.ts` (new), `package.json` (add `bullmq`, `ioredis`), `.env.example` (`REDIS_URL`).
- Approach: create a `postQueue` + a typed job payload `{ scheduledPostId }`. Expose `enqueuePost(payload, delayMs, jobId)`.
- Acceptance criteria: enqueue a delayed job; a worker receives it after the delay (against local Redis).
- How to verify: a small script enqueues + consumes; needs Redis running.
- Out of scope: the planner (TASK-010).

### TASK-010: Planner — `planDay` → enqueued jobs + `ScheduledPost` rows
- Milestone: M2 · Priority: **P0** · Depends on: TASK-009, TASK-005
- Why: turns the risk schedule into concrete durable jobs.
- Files to touch: `src/scheduler/planner.ts` (new + selftest).
- Approach: per active session compute `ageDays` from `connectedAt`; run `planDay({tier, ageDays, localDate, rng})`; for each time, insert a `ScheduledPost` (status `queued`) and `enqueuePost` with the delay + the row id as `jobId`. Pick products round-robin honouring `doNotPost`/`active`.
- Acceptance criteria: unit test with a fake queue asserts N jobs at the N planned times and N `ScheduledPost` rows.
- How to verify: `npm run test:planner` exits 0.
- Out of scope: cron/trigger of the planner itself (a simple daily tick is fine; note it).

### TASK-011: Queue consumer → poster
- Milestone: M2 · Priority: **P0** · Depends on: TASK-010, TASK-005, TASK-008
- Why: execute a scheduled post.
- Files to touch: `src/worker/postProcessor.ts` (new + selftest).
- Approach: on job → load `ScheduledPost`+product+session → check `canPost()` + kill switch → `postProductStatus` → set status `posted`/`failed` + `postedAt`/`error`. Respect `attempt` for retries.
- Acceptance criteria: fake sock + fake job drives a `queued` row to `posted`; a thrown post sets `failed` with a real error string.
- How to verify: `npm run test:postprocessor` exits 0.
- Out of scope: dashboard display.

### TASK-012: Session pool + rehydrate-on-boot
- Milestone: M2 · Priority: **P0** · Depends on: TASK-004, TASK-006, TASK-007
- Why: run many sessions and survive restarts without re-scans.
- Files to touch: `src/worker/sessionPool.ts` (new + selftest), `src/worker/index.ts`.
- Approach: `Map<sessionId, SessionManager>`; on boot, load all non-logged-out sessions and `start()` each; expose `add/remove/get`. Cap concurrent starts.
- Acceptance criteria: unit test with a fake `createSocket` starts N managers and `stop()` tears them down and releases transports.
- How to verify: `npm run test:pool` exits 0.
- Out of scope: proxy binding (TASK-013).

### TASK-013: Bind `ProxyAgentTransport` to DB proxy rows
- Milestone: M2 · Priority: **P0** · Depends on: TASK-012
- Why: the anti-ban network layer (DECISIONS §D2) must actually be used.
- Files to touch: `src/worker/sessionPool.ts`, `src/wa/transport/*` (a loader).
- Approach: for each session read its `Proxy` row, decrypt `encUsername`/`encPassword`, build `ProxyConfig`, pass `ProxyAgentTransport`. Fall back to `DirectTransport` only if explicitly allowed (dev).
- Acceptance criteria: unit test builds a `ProxyConfig` from a fake proxy row + decryptor; no proxy → Direct (dev flag) or error (prod).
- How to verify: `npm run test:pool` (extended) exits 0.
- Out of scope: buying/provisioning proxies (operator decision).

### TASK-014: Persisted kill switch + live propagation
- Milestone: M2 · Priority: **P0** · Depends on: TASK-012
- Why: operator must pause globally/per-client and have workers honour it immediately.
- Files to touch: `src/worker/killSwitch.ts` (new), `sessionPool.ts`.
- Approach: `shouldRun(sessionId)` reads `Business.paused` + a global flag; a Redis pub/sub channel toggles live → pool pauses/resumes affected managers.
- Acceptance criteria: setting `paused=true` pauses the manager within a few seconds; unit test with fakes verifies the wiring.
- How to verify: `npm run test:killswitch` exits 0.
- Out of scope: the dashboard toggle UI (M3).

### TASK-015: Pre-generate captions at enqueue time
- Milestone: M2 · Priority: **P1** · Depends on: TASK-010
- Why: a live API blip at fire time must not stall a post.
- Files to touch: `src/scheduler/planner.ts`.
- Approach: when creating each `ScheduledPost`, call `generateCaption` and store `.caption`. The processor uses the stored caption; regenerates only if missing.
- Acceptance criteria: a job whose fire-time API is down still posts (uses stored caption).
- How to verify: unit test with a failing transport at fire time still posts.
- Out of scope: caption A/B logic.

### TASK-016: Persist warm-up + ban-signal state across restarts
- Milestone: M2 · Priority: **P1** · Depends on: TASK-012
- Why: warm-up age and ban detection must survive process restarts.
- Files to touch: `sessionPool.ts`, `manager.ts`, DB writes on events.
- Approach: on connect set `connectedAt`/`warmupStartedAt`; on disconnect persist `forcedDisconnects`/`lastDisconnectCode`; `ageDays()` derives from `connectedAt`; seed `BanDetector` from recent persisted signals.
- Acceptance criteria: unit test shows `ageDays` computed from `connectedAt`; forced-disconnect counter persists.
- How to verify: `npm run test:pool` (extended) exits 0.
- Out of scope: alerting (TASK-034).

---

## M3 — Dashboard & onboarding

### TASK-017: Scaffold Next.js app + convert repo to workspaces
- Milestone: M3 · Priority: **P0** · Depends on: none (do before other M3)
- Why: the engine is a flat package; the web app and worker should be separate workspace apps sharing the engine.
- Files to touch: root `package.json` (workspaces), move `src/*` engine into `packages/core`, new `apps/web` (Next.js App Router + TS), `apps/worker` (wraps `src/worker`).
- Approach: incrementally; keep import paths working; `apps/web` starts as a single page. **Do not rewrite engine code** — just relocate and re-export.
- Acceptance criteria: `npm run dev -w apps/web` serves a page; `npm test` still green.
- How to verify: open the dev URL; run `npm test`.
- Out of scope: any feature pages (later tasks). This is a big task — if it can't fit one session, split into "scaffold web" and "relocate engine to packages/core."

### TASK-018: Business auth (register/login, per-tenant scoping)
- Milestone: M3 · Priority: **P0** · Depends on: TASK-017, TASK-002
- Why: tenants must authenticate; every query scoped by `businessId`.
- Files to touch: `apps/web/**` (auth routes), a session helper, `package.json` (auth lib + `argon2`/`bcrypt`).
- Approach: pick one well-supported approach (Auth.js or Lucia) with httpOnly cookies; hash passwords into `Business.passwordHash`; a `getTenant()` helper every handler must call.
- Acceptance criteria: register → login → authenticated session; protected routes redirect; a second tenant cannot read the first's rows.
- How to verify: manual flow + a test asserting cross-tenant read is denied.
- Out of scope: operator/admin roles (note as future).

### TASK-019: Product CRUD API + image upload to object storage
- Milestone: M3 · Priority: **P0** · Depends on: TASK-018, TASK-023
- Why: businesses need to manage the catalogue that gets posted.
- Files to touch: `apps/web/**` (product routes + minimal UI).
- Approach: presigned-URL upload to object storage → store `imageKey`; CRUD `Product` rows (validated, tenant-scoped). Enforce image size/type at the boundary.
- Acceptance criteria: create/list/update/delete a product with a photo; image retrievable via key; `doNotPost`/`active` honoured.
- How to verify: manual CRUD + a test on the API.
- Out of scope: bulk import.

### TASK-020: Live QR linking via SSE
- Milestone: M3 · Priority: **P0** · Depends on: TASK-012, TASK-017
- Why: businesses link WhatsApp by scanning a QR shown in the app.
- Files to touch: worker publishes `ManagerEvent`s to Redis pub/sub; `apps/web` SSE route subscribes; a link page.
- Approach: worker → Redis channel `session:{id}` → web SSE endpoint streams `qr`/`state`/`connected` → page renders QR (client-side QR image) and live status.
- Acceptance criteria: [human] opens the link page, sees a live QR, scans it, status flips to `connected` without refresh.
- How to verify: manual end-to-end.
- Out of scope: health dashboard (TASK-021).

### TASK-021: Session health + post history views
- Milestone: M3 · Priority: **P1** · Depends on: TASK-020
- Why: operators/owners need visibility.
- Files to touch: `apps/web/**` (dashboard pages).
- Approach: show connection state, warm-up stage/age, upcoming queue (`ScheduledPost` where `queued`), recent posts/errors.
- Acceptance criteria: pages render real data with loading/empty/error states.
- How to verify: manual with seeded data.
- Out of scope: charts/metrics (TASK-034).

### TASK-022: Preferences UI (tier, language, quiet hours, pause)
- Milestone: M3 · Priority: **P1** · Depends on: TASK-018
- Why: per-client configurability without code changes.
- Files to touch: `apps/web/**`, `Business`/`Template` writes.
- Approach: form to edit `riskTier`, caption language/tone, quiet hours, and the `paused` kill switch; validate; changes affect the next planner run.
- Acceptance criteria: changing a preference persists and changes scheduling/behaviour.
- How to verify: manual; confirm planner uses new values.
- Out of scope: multi-template management (future).

### TASK-023: Object storage client
- Milestone: M3 · Priority: **P0** · Depends on: none (needed by TASK-019)
- Why: photos + renders can't live in Postgres.
- Files to touch: `src/storage/index.ts` (or `packages/core`), `.env.example` (bucket creds), `package.json` (S3-compatible SDK).
- Approach: thin `put/get/presignUpload/presignGet` over an S3-compatible store (R2/Backblaze/S3). Keys match schema (`imageKey`/`renderedKey`/`logoKey`).
- Acceptance criteria: put + get + presign round-trip against a real bucket.
- How to verify: integration test against a test bucket.
- Out of scope: CDN.

---

## M4 — Security & hardening

### TASK-024: gitignore `.claude/`; secrets audit
- Milestone: M4 · Priority: **P0** · Depends on: none
- Why: `.claude/settings.local.json` is untracked but not ignored — a `git add -A` could commit it.
- Files to touch: `.gitignore`.
- Approach: add `.claude/`; grep history/tree for any secret-looking strings.
- Acceptance criteria: `git check-ignore .claude/settings.local.json` matches; `git ls-files` shows no secrets/`.env`.
- How to verify: run those git commands.
- Out of scope: rotating any real secret (none exist yet).

### TASK-025: Enforce secrets at boot
- Milestone: M4 · Priority: **P0** · Depends on: TASK-008
- Why: a missing/short `ENCRYPTION_KEY` must fail loudly, never silently degrade.
- Files to touch: a `src/config/env.ts` loader.
- Approach: validate required env at startup (see TASK-026 zod); refuse to boot without `ENCRYPTION_KEY`/`DATABASE_URL` in the worker. Document that the key is unrotatable (re-scan cost).
- Acceptance criteria: worker exits with a clear message if `ENCRYPTION_KEY` is absent/invalid.
- How to verify: run worker without the var → non-zero exit + message.
- Out of scope: a secret manager integration (note for the operator's host).

### TASK-026: Input validation at every boundary (zod)
- Milestone: M4 · Priority: **P0** · Depends on: TASK-017
- Why: never trust the client or the environment.
- Files to touch: API route handlers, `src/config/env.ts`, upload handlers; `package.json` (`zod`).
- Approach: schema-validate request bodies/params, env vars, and upload metadata; reject with 400 + message.
- Acceptance criteria: invalid inputs return 400 with a real message; unit tests cover representative cases.
- How to verify: tests + manual bad requests.
- Out of scope: business rules beyond shape validation.

### TASK-027: Error handling, boundaries, and user-facing states
- Milestone: M4 · Priority: **P0** · Depends on: TASK-017
- Why: no swallowed exceptions; every failure has a real message + state.
- Files to touch: API error envelope, Next.js `error.tsx`/`loading.tsx`, empty states.
- Approach: a consistent error response shape; frontend error/loading/empty components; no empty `catch`.
- Acceptance criteria: forced failures (DB down, API 500) render real messages, not blank screens.
- How to verify: simulate failures; observe states.
- Out of scope: full design polish.

### TASK-028: Rate limiting + security headers
- Milestone: M4 · Priority: **P0** · Depends on: TASK-017
- Why: protect auth/upload endpoints; standard headers.
- Files to touch: web middleware.
- Approach: per-IP/tenant rate limits (Redis-backed) on auth + upload; set CORS, CSP, HSTS, X-Content-Type-Options.
- Acceptance criteria: limits enforced (429 on abuse); headers present on responses.
- How to verify: hammer an endpoint; inspect response headers.
- Out of scope: WAF.

### TASK-029: Structured logging pipeline
- Milestone: M4 · Priority: **P1** · Depends on: TASK-008, TASK-017
- Why: debuggability without leaking secrets.
- Files to touch: a shared `logger`, web + worker.
- Approach: pino with request/session ids; **redact** creds/keys/tokens; JSON in prod.
- Acceptance criteria: logs are structured JSON; no secret ever appears in a log.
- How to verify: grep logs for known secret patterns → none.
- Out of scope: log shipping (host concern).

### TASK-030: Consent/terms for secondary-number risk
- Milestone: M4 · Priority: **P1** · Depends on: TASK-018
- Why: clients must acknowledge ban risk + secondary-number guidance (brief requirement).
- Files to touch: onboarding flow + an acceptance record (a `Business` field or table).
- Approach: show plain-language terms; block onboarding until accepted; store timestamp/version.
- Acceptance criteria: cannot link a number without accepting; acceptance recorded.
- How to verify: manual; DB shows acceptance.
- Out of scope: legal review (operator).

### TASK-031: Dependency audit
- Milestone: M4 · Priority: **P2** · Depends on: none
- Why: no known-vuln deps at launch.
- Files to touch: possibly `package.json` pins.
- Approach: `npm audit`; patch/pin criticals; record any accepted risk in `PROGRESS_LOG`.
- Acceptance criteria: no unaddressed critical/high vulns.
- How to verify: `npm audit` output.
- Out of scope: major version bumps without reason (see QUALITY_STANDARDS).

---

## M5 — Testing & observability

### TASK-032: Adopt Vitest; migrate self-tests
- Milestone: M5 · Priority: **P1** · Depends on: TASK-017
- Why: real runner, coverage, CI-friendly.
- Files to touch: `vitest.config.ts`, `src/**/*.selftest.ts` → `*.test.ts`, `package.json`.
- Approach: keep the assertions; move `check()` scripts into Vitest `test()`/`expect()`. Keep behaviour identical.
- Acceptance criteria: `npm test` runs Vitest green; coverage report emitted.
- How to verify: `npm test`; open coverage.
- Out of scope: adding new test cases beyond parity (do that per-feature).

### TASK-033: Health checks + readiness
- Milestone: M5 · Priority: **P1** · Depends on: TASK-008, TASK-017
- Why: deploys/monitoring need liveness/readiness.
- Files to touch: web `/healthz`, worker heartbeat.
- Approach: `/healthz` pings DB + Redis; worker writes a heartbeat/`lastSeenAt`.
- Acceptance criteria: endpoints return healthy/unhealthy correctly.
- How to verify: hit endpoints with deps up/down.
- Out of scope: dashboards.

### TASK-034: Metrics + ban-signal alerts
- Milestone: M5 · Priority: **P1** · Depends on: TASK-012, TASK-033
- Why: operator must see active sessions, posts/day, success rate, reconnects, and be alerted on ban signals/backlog.
- Files to touch: metrics module; alert hook (email/webhook).
- Approach: counters/gauges from `ManagerEvent`s + queue depth; alert when `ban-signal` fires or backlog exceeds a threshold.
- Acceptance criteria: metrics observable; a simulated ban signal triggers an alert.
- How to verify: fire a fake ban-signal; observe alert.
- Out of scope: a full Grafana stack (optional).

### TASK-035: DB indexes review + migration
- Milestone: M5 · Priority: **P1** · Depends on: TASK-003
- Why: hot queries (queue polling, tenant lists) must be indexed at scale.
- Files to touch: `prisma/schema.prisma` + migration.
- Approach: verify existing `@@index`es cover real query patterns; add any missing; migrate.
- Acceptance criteria: `EXPLAIN` on the main queries uses indexes.
- How to verify: run `EXPLAIN` on the scheduler/dashboard queries.
- Out of scope: partitioning.

### TASK-036: Backups + restore runbook
- Milestone: M5 · Priority: **P2** · Depends on: TASK-039
- Why: session loss = mass re-scan; DB loss = catastrophe.
- Files to touch: `docs/` runbook, a backup script/cron.
- Approach: scheduled `pg_dump`; documented restore; note `ENCRYPTION_KEY` must be backed up **separately and securely**.
- Acceptance criteria: a restore is tested on staging and documented.
- How to verify: perform a test restore.
- Out of scope: PITR (optional).

### TASK-037: CI pipeline
- Milestone: M5 · Priority: **P1** · Depends on: TASK-032
- Why: never merge a red build.
- Files to touch: `.github/workflows/ci.yml`.
- Approach: on PR: install, `typecheck`, `test`, `prisma validate`. (Add a Postgres/Redis service for integration tests if feasible.)
- Acceptance criteria: CI runs green on a PR; fails on a broken PR.
- How to verify: open a PR.
- Out of scope: CD (M6).

---

## M6 — Deploy & launch

### TASK-038: Dockerize web + worker
- Milestone: M6 · Priority: **P0** · Depends on: TASK-017
- Why: reproducible deploys.
- Files to touch: `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `.dockerignore`.
- Approach: multi-stage builds; run via node/tsx; small runtime images.
- Acceptance criteria: both images build and boot locally.
- How to verify: `docker build` + `docker run` each.
- Out of scope: registry/CD.

### TASK-039: docker-compose full stack
- Milestone: M6 · Priority: **P0** · Depends on: TASK-038, TASK-003
- Why: one-command Postgres + Redis + web + worker.
- Files to touch: `docker-compose.yml`, deploy env docs.
- Approach: services for postgres, redis, web, worker; run migrations on deploy; healthchecks.
- Acceptance criteria: `docker compose up` brings up the whole system; a manual post works.
- How to verify: bring it up; exercise the core loop.
- Out of scope: multi-node.

### TASK-040: Single-VPS deploy + restart-without-losing-links
- Milestone: M6 · Priority: **P0** · Depends on: TASK-039, TASK-012
- Why: the brief's key operational property.
- Files to touch: `docs/DEPLOY.md`.
- Approach: deploy the compose stack to one Linux VPS; verify sessions rehydrate from encrypted DB state after a restart (no re-scan).
- Acceptance criteria: restart the stack → previously-linked sessions reconnect automatically.
- How to verify: link a number, restart, confirm reconnect without re-scan.
- Out of scope: autoscaling (fleet is a later capacity decision).

### TASK-041: Staging environment
- Milestone: M6 · Priority: **P1** · Depends on: TASK-040
- Acceptance criteria: staging mirrors prod config; a smoke test passes there before prod.

### TASK-042: Rollback plan
- Milestone: M6 · Priority: **P1** · Depends on: TASK-040
- Acceptance criteria: a documented, tested rollback (previous image + migration-down strategy).

### TASK-043: Pre-launch checklist + sign-off
- Milestone: M6 · Priority: **P0** · Depends on: all P0 above
- Why: don't launch with a P0 gap.
- Files to touch: `docs/LAUNCH_CHECKLIST.md`.
- Approach: enumerate + verify: Phase-1 posting proven; encryption + secrets; proxies live; validation/rate-limit/headers; error states; health/alerts; backups; restart-safe; consent terms.
- Acceptance criteria: every P0 task done + checklist signed.
- How to verify: walk the checklist.
- Out of scope: P2 items.

### TASK-044: APK client
- Milestone: M6 · Priority: **P2** · Depends on: TASK-020, TASK-019
- Why: the actual distributable for business owners (DECISIONS §D1).
- Approach: a native shell (or React Native) wrapping the dashboard flows — onboarding, QR link, product upload with native camera, health, push for re-scan. Sideloaded (no Play Store).
- Acceptance criteria: an installable APK can onboard a client and show link status.
- How to verify: install on a device; run onboarding.
- Out of scope: Play Store submission.

### TASK-045: Operator guide
- Milestone: M6 · Priority: **P2** · Depends on: TASK-043
- Approach: how to onboard a client, recommended default risk settings, and the client-facing secondary-number/risk terms.
- Acceptance criteria: a competent operator can onboard a client using only the guide.
