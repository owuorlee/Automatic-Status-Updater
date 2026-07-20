# Architecture Decision Record — WhatsApp Status Poster

This file is the durable record of the Phase 0 decisions. Read it before changing
the topology, the network layer, or the Baileys version.

## Context / priorities (from the operator)

- Target: SMBs in Kenya. WhatsApp Status is the sales channel.
- **Ban-resistance is a first-class functional requirement**, weighted equally with
  "posts reliably." The operator explicitly asked to optimise for *most effective +
  most efficient + most secure against banning*, and has accepted build complexity.
- Scale target: **50–200 concurrent numbers from day one.**
- Numbers linked will be **secondary numbers**, with onboarding that drives the
  business's customers to *save the number* (so Status has an audience).
- Distribution: sold as a sideloaded **APK**, not via Play Store.
- Baileys is unofficial; ban risk is understood and accepted.

## D1 — Topology: centralized backend + APK is the client

**Decision:** Baileys sessions run **server-side** in an isolated worker fleet.
The **APK is the business-owner's client** (registration, QR linking, native-camera
catalogue upload, health view, push alerts for "re-scan needed"). It is *not* where
Baileys runs. Sideloaded off-Play-Store to avoid policy review of an automation tool.

**Why not on-device Baileys (running the socket inside each phone's APK):**

- Ban-resistance is won mainly at (1) network identity, (2) behavioural realism,
  (3) account provenance, (4) fingerprint stability — not at "is it literally the
  phone." Central control lets us enforce (2) and (4) *uniformly across all 200
  numbers* and push risk-model fixes instantly. On-device fragments that control: a
  misbehaving client you cannot see or correct is a ban waiting to happen.
- Android background execution (Doze, battery optimisation, force-stop, OEM killers)
  cannot deliver reliable 24/7 human-schedule posting. Missed posting windows fail
  the "effective" requirement, and there is no central observability or kill-switch —
  which the spec explicitly requires.
- The one thing on-device wins — an authentic per-phone mobile IP — is recovered
  centrally via D2. A WhatsApp Web companion connecting from a *different but
  plausible* network than the phone is normal behaviour anyway.

## D2 — Network identity: per-session sticky, geo-matched egress (pluggable)

**Decision:** Every session egresses through its **own sticky, Kenya-geo-matched
proxy**, **mobile-IP preferred**, bound behind a pluggable `SessionTransport`
interface. Plus device-fingerprint hygiene: a stable, distinct-but-plausible
companion `browser` identity **persisted per number and reused across reconnects**,
drawn from a realistic pool — never churned.

**Why:**

- The dominant IP-level ban signal is **many accounts from one datacenter IP/ASN**.
  Sticky per-session residential/mobile IPs local to Kenya eliminate it.
- **Mobile (4G/CGNAT) IPs are the strongest** hiding place: real users share them, so
  WhatsApp cannot punish the IP by reputation without hurting real customers.
- **Sticky** matters: an account whose companion hops IPs each reconnect looks
  compromised. One egress is pinned per number for its lifetime.
- **Pluggable transport** = we ship with commercial mobile/residential proxies now
  (reliable, scalable), and keep an optional **phone-as-relay "max stealth" mode**
  (the client's APK tunnels its own session's socket over the owner's real
  connection: same-owner IP, zero proxy cost) as a drop-in for high-value clients
  later. Same engine, swappable egress.

**Cost:** dedicated mobile proxies are the expensive tier; geo residential is cheaper.
Provider + tier are config-driven so risk tier ↔ egress quality can be tuned per client.

## D3 — Baileys version: pin `7.0.0-rc13`, keep it swappable

**Decision:** Pin **exactly** `@whiskeysockets/baileys@7.0.0-rc13`, wrapped behind a
posting adapter. Fallback: `6.7.23`.

**Why:** As of this writing the dist-tags are `legacy → 6.7.23`, `latest → 7.0.0-rc13`.
For an *unofficial* library, tracking WhatsApp's current protocol matters more than
nominal API stability — a stable-but-abandoned version bit-rots against WhatsApp's
servers. We pin an exact RC (no range surprises) and validate it with the Phase 1
live-post gate; if it fails there, drop to `6.7.23` without touching callers.

## D4 — Status reach depends on contacts (product constraint, not a bug)

Status is E2E-encrypted per recipient; the post carries a `statusJidList` audience.
A brand-new number with no contacts reaches nobody. Onboarding **must** drive
customers to save the number, and we broadcast to the synced contact list. This is
why D-context chose "secondary number + drive saves." Set client expectations that
reach starts low and grows.

## Open logistics (do not block Phase 1 scaffolding, but needed soon)

- Is server/Postgres/Redis/domain/Anthropic key already provisioned, or greenfield?
- Branding assets: self-serve upload in the app, or operator-onboarded?
- A test WhatsApp number for the Phase 1 live-post sign-off.
- Budget ceiling per number/month (bounds the D2 proxy tier).

## Stack (confirmed)

Next.js (App Router) + TS dashboard/API/SSE · Postgres + Prisma · Redis + BullMQ ·
Baileys worker fleet (separate processes) · S3-compatible media store · sharp+SVG
image overlay · Anthropic Messages API (Haiku-class default) for captions.
