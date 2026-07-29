# ARCHITECTURE

How the system is meant to fit together, and how the built parts already do.
Target-state components that don't exist yet are marked **[PLANNED]**.
Read `docs/DECISIONS.md` for the *why* behind topology/network/version choices.

## Topology (DECISIONS §D1, §D2)

**Centralised backend + Android APK as the client.** The automation engine
(Baileys sessions, scheduler, rendering, captions) runs **server-side** in a
worker fleet. The **APK** [PLANNED] is only the business owner's onboarding/
management surface (register, scan QR, upload products, see health). It is *not*
where Baileys runs. Chosen over on-device Baileys because central control gives
uniform anti-ban behaviour, observability, kill switches, and reliable 24/7
posting that Android background limits cannot.

Each session egresses through its **own sticky, Kenya-geo-matched proxy**
(mobile IP preferred) so 200 numbers don't all appear from one datacenter IP —
the dominant ban signal. The transport is pluggable so a future "phone-as-relay"
mode can drop in.

```
                          ┌───────────────────────────── operator's server(s) ───────────────────────────┐
  Business owner          │                                                                                │
  (Android APK)  ──HTTPS──┼──►  Web app / API (Next.js) [PLANNED]                                          │
   • register             │      • auth, product CRUD, preferences                                         │
   • scan QR   ◄──SSE─────┼──    • streams live QR + session health  ◄── Redis pub/sub [PLANNED]           │
   • upload products      │      • enqueues nothing directly; reads DB                                     │
   • health view          │            │                    ▲                                              │
                          │            ▼                    │                                              │
                          │      Postgres (Prisma)      Redis + BullMQ [PLANNED]                           │
                          │      tenants/sessions/          durable jobs (jittered delays),                │
                          │      products/queue/history     pub/sub for QR/health                          │
                          │            ▲                    │                                              │
                          │            │                    ▼                                              │
                          │      Worker fleet (separate processes) [PLANNED entrypoint]                    │
                          │        • SessionManager per number  ── proxy ──►  WhatsApp (status@broadcast)  │
                          │        • poster: planDay→caption→overlay→send [PLANNED glue]                   │
                          │        • rehydrate encrypted sessions on boot [PLANNED]                        │
                          │            │            │             │                                        │
                          │      Anthropic API   sharp render   Object storage [PLANNED]                   │
                          └────────────────────────────────────────────────────────────────────────────────┘
```

The web app and workers are **separate processes** so a crashing socket never
takes down the dashboard (DECISIONS / requirement §Isolation).

## Runtime data flow (target)

1. **Onboarding**: APK → API creates a `Business` + a `WhatsappSession` row. A
   worker starts a `SessionManager` for it → emits `qr` events → published to
   Redis → SSE → shown in the APK. On scan, Baileys pairs; `creds.update` fires;
   `useEncryptedAuthState` encrypts + persists creds/keys to Postgres.
2. **Scheduling**: a planner runs `planDay()` per active session (using tier +
   connection age for warm-up) → enqueues one delayed BullMQ job per post time.
3. **Posting**: the job fires → load product → `generateCaption()` (pre-generated
   ideally) → `renderStatusImage()` → `SessionManager.getSocket()` →
   `sendMessage('status@broadcast', {image, caption}, {statusJidList, broadcast:true})`
   → write `ScheduledPost` terminal status + history.
4. **Health/failure**: disconnects flow through `classifyDisconnect` →
   reconnect-with-backoff, or re-scan on logout, or auto-pause on ban signals;
   all surfaced as `ManagerEvent`s for the dashboard/alerts.

### What actually flows today

Only in isolation, via self-tests: `planDay` produces times; `generateCaption`
returns text (fallback/injected); `renderStatusImage` returns a JPEG buffer;
`SessionManager` drives a **fake** socket through its lifecycle; `useEncryptedAuthState`
round-trips through an **in-memory** store. No process ties these together yet.

## Data model (`prisma/schema.prisma`, Postgres)

All rows tenant-scoped by `businessId`. `Bytes` columns hold **AES-256-GCM
ciphertext**, never plaintext.

```
Business 1───* WhatsappSession 1───* SignalKey
   │                   │ 1
   │                   └───0..1 Proxy
   ├───* Product
   ├───* Template
   └───* ScheduledPost *───0..1 Product
                       *───0..1 WhatsappSession
```

| Model | Key fields | Notes |
|---|---|---|
| `Business` | `id`, `email`(unique), `passwordHash`, `name`, `timezone`(=Africa/Nairobi), `riskTier`(conservative), `paused`, `plan` | Tenant + per-client kill switch (`paused`). |
| `WhatsappSession` | `id`, `businessId`, `phoneJid?`, `connectionState`, `encCreds?`(Bytes), `browserFingerprint?`, `connectedAt?`, `warmupStartedAt?`, `lastSeenAt?`, `lastDisconnectCode?`, `forcedDisconnects`, `proxyId?`(unique) | `encCreds` = encrypted Baileys creds. Age (`connectedAt`) drives warm-up. |
| `SignalKey` | `id`, `sessionId`, `category`, `keyId`, `encValue`(Bytes); unique `(sessionId,category,keyId)` | One row per Baileys signal key (written frequently). |
| `Proxy` | `id`, `label`, `kind`(mobile/residential/datacenter), `host`, `port`, `geo`(KE), `encUsername?`, `encPassword?`, `active` | Per-session egress; creds encrypted. |
| `Product` | `id`, `businessId`, `name`, `description?`, `priceText`, `category?`, `imageKey?`, `active`, `doNotPost` | `imageKey` = object-storage key (not bytes). |
| `Template` | `id`, `businessId`, `accentColor`, `onAccentColor`, `logoKey?`, `captionTone`, `captionLanguage`, `emojiDensity`, `includePrice`, `includeCta`, `isDefault` | Branding + caption style per client. |
| `ScheduledPost` | `id`, `businessId`, `productId?`, `sessionId?`, `scheduledAt`, `status`(queued→…), `jobId?`, `caption?`, `renderedKey?`, `attempt`, `error?`, `postedAt?` | **Unified queue + history** in one table. |

Enums: `RiskTier`, `ConnectionState`, `ProxyKind`, `PostStatus`, `CaptionLanguage`.
Indexes exist on tenant + hot query paths; review before launch (roadmap M5).

**Gaps**: no datasource URL (Prisma 7 → `prisma.config.ts` + driver adapter,
[PLANNED]); no migrations; `PrismaClient` is never instantiated in code.

## Auth / sessions / permissions

- **WhatsApp session auth**: handled by `useEncryptedAuthState` + `AuthStore`.
  Creds + signal keys are AES-256-GCM encrypted with `ENCRYPTION_KEY` and stored
  per-session. Rehydrated on worker boot [PLANNED].
- **Business/user auth for the dashboard**: **[PLANNED]** — `Business.passwordHash`
  exists in the schema; no login/session/JWT code yet. Choose an approach in
  roadmap M3 (e.g. Auth.js/Lucia + httpOnly cookies) and scope **every** query by
  `businessId`.
- **Operator vs business roles**: **[PLANNED]** — not modelled beyond per-tenant
  isolation.

## Frontend state management

**[PLANNED]** — no frontend exists. When built (Next.js App Router), prefer server
components + server actions for data, and SSE (not polling) for live QR/health.

## Key architectural decisions (extend *with* these, not against)

1. **Pure logic vs I/O separation.** The valuable, ban-relevant logic (risk
   scheduling, disconnect classification, backoff, ban detection, state machine,
   crypto, serialization) is written as **pure, deterministic, injectable**
   functions/classes with their own self-tests. I/O (Baileys socket, DB, network)
   is a thin outer shell. **Keep new logic testable this way.** The `SessionManager`
   takes an injectable `createSocket` and `schedule` precisely so it can be tested
   without a network — imitate that pattern for the poster and scheduler.
2. **Pluggable seams.** `AuthStore` (in-memory ↔ Prisma), `SessionTransport`
   (direct ↔ proxy ↔ future phone-relay), and the caption `transport` (real ↔ fake)
   are interfaces on purpose. Add backends behind them; don't hardcode.
3. **Graceful degradation over hard failure** in the post pipeline. Captions fall
   back to a deterministic local caption; a caption/API problem must never block a
   post. Preserve this property everywhere on the posting path.
4. **Anti-ban is functional, not cosmetic.** Conservative defaults, warm-up gating
   on connection age, jitter, min-gaps, quiet hours, sticky per-session IPs, stable
   device fingerprints, ban-signal auto-pause. Every volume/timing/network change
   must be justified through the ban-risk lens.
5. **Single-server-friendly, fleet-ready.** Design so 10→200 sessions is a capacity
   decision. Workers are separate processes; sessions pin to workers; state lives in
   Postgres/Redis so restarts don't force re-scans.
6. **No official API exists.** The whole thing rides an unofficial library that can
   break on WhatsApp's whims. Keep the Baileys surface behind an adapter and keep the
   Phase-1 smoke test as a guard.
