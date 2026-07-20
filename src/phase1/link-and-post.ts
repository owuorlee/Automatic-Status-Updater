/**
 * Phase 1 — the risky-primitive proof.
 *
 * Goal (and the ONLY exit criterion for this phase): link a real WhatsApp
 * number via QR, post one Status to `status@broadcast`, and confirm on the
 * phone that it actually appears. We build nothing else until this is proven,
 * because posting Status via Baileys is unofficial and has historically been
 * flaky/version-dependent (see docs/DECISIONS.md, risk H4).
 *
 * This deliberately uses `useMultiFileAuthState` (Baileys' demo-only auth
 * store). That is CORRECT for a throwaway proof and is replaced by an
 * encrypted, DB-backed adapter in Phase 3 — do not ship this file to prod.
 *
 * Run:  npm run phase1
 * Then: scan the QR (WhatsApp → Linked devices → Link a device) and watch the
 *       terminal. Verify on the phone: Updates tab → "My status".
 */
import makeWASocket, {
  Browsers,
  DisconnectReason,
  delay,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { readFile } from 'node:fs/promises';

// Load .env if present (Node >=20.6 built-in; no dependency needed).
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file — defaults apply */
}

const AUTH_DIR = process.env.AUTH_DIR ?? '.auth/phase1';
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL ?? 'silent' });

let posted = false; // ensure we only post once even if `open` fires twice

function toJid(raw: string): string {
  const s = raw.trim();
  if (s.includes('@')) return s;
  return `${s.replace(/\D/g, '')}@s.whatsapp.net`;
}

async function postStatusOnce(sock: WASocket, contacts: Set<string>): Promise<void> {
  if (posted) return;
  posted = true;

  const ownJid = jidNormalizedUser(sock.user!.id);

  // Build the audience. Status is E2E-encrypted per recipient, so an empty
  // statusJidList means literally nobody can decrypt it. We either honour an
  // explicit override, or use the synced contacts, always including ourselves.
  let audience: string[];
  const override = process.env.STATUS_AUDIENCE?.trim();
  if (override) {
    audience = override.split(',').map(toJid).filter(Boolean);
  } else {
    audience = [...contacts].filter((j) => j.endsWith('@s.whatsapp.net'));
  }
  if (!audience.includes(ownJid)) audience.push(ownJid);

  console.log(`\n→ Posting status to ${audience.length} recipient(s).`);

  const imagePath = process.env.IMAGE_PATH ?? process.argv[2];
  try {
    if (imagePath) {
      const media = await readFile(imagePath);
      const caption = process.env.CAPTION ?? 'Phase 1 proof ✅ automated status post';
      await sock.sendMessage(
        'status@broadcast',
        { image: media, caption },
        { broadcast: true, statusJidList: audience },
      );
      console.log(`✅ IMAGE status posted from ${imagePath}`);
    } else {
      const text = process.env.STATUS_TEXT ?? 'Phase 1 proof ✅ (text status)';
      await sock.sendMessage(
        'status@broadcast',
        { text },
        {
          broadcast: true,
          statusJidList: audience,
          backgroundColor: process.env.BG_COLOR ?? '#128C7E',
          font: 3,
        },
      );
      console.log('✅ TEXT status posted.');
    }
    console.log('   Verify now on the linked phone: Updates tab → "My status".');
  } catch (err) {
    console.error('❌ Status post FAILED. This is the signal Phase 1 exists to catch.');
    console.error(err);
  }

  // Keep the socket alive briefly so the media upload / ack completes.
  console.log('\n(keeping the connection open 20s to flush the upload, then exiting)');
  await delay(20_000);
  process.exit(0);
}

async function start(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`WhatsApp Web version ${version.join('.')} (isLatest=${isLatest})`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    // A stable, plausible companion fingerprint. In prod (Phase 3+) this is
    // persisted per-number and never churned across reconnects.
    browser: Browsers.ubuntu('Chrome'),
    // Don't hijack presence from the owner's phone.
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  const contacts = new Set<string>();

  sock.ev.on('creds.update', saveCreds);

  // Collect synced contacts so we can broadcast the status to a real audience.
  sock.ev.on('messaging-history.set', ({ contacts: c }) => {
    for (const ct of c ?? []) if (ct.id) contacts.add(ct.id);
  });
  sock.ev.on('contacts.upsert', (c) => {
    for (const ct of c) if (ct.id) contacts.add(ct.id);
  });

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      console.log('\n┌─────────────────────────────────────────────┐');
      console.log('│ Scan in WhatsApp → Linked devices → Link a  │');
      console.log('│ device. (Use a SECONDARY number.)           │');
      console.log('└─────────────────────────────────────────────┘\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'connecting') console.log('… connecting');

    if (connection === 'open') {
      console.log(`\n✅ Connected as ${sock.user?.id}`);
      console.log('   Waiting a few seconds for contacts to sync…');
      await delay(4_000);
      await postStatusOnce(sock, contacts);
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;
      const name = code != null ? (DisconnectReason[code] ?? String(code)) : 'unknown';
      console.log(`\n⚠️  Connection closed. code=${code} (${name})`);

      if (code === DisconnectReason.loggedOut) {
        console.log('   → Permanent logout. Delete the auth dir and re-scan.');
        process.exit(1);
      } else if (code === DisconnectReason.restartRequired) {
        console.log('   → restartRequired (expected right after first pair). Reconnecting…');
        void start();
      } else if (!posted) {
        console.log('   → Transient drop. Reconnecting in 3s…');
        setTimeout(() => void start(), 3_000);
      }
    }
  });
}

process.on('SIGINT', () => {
  console.log('\nInterrupted. Bye.');
  process.exit(0);
});

start().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
