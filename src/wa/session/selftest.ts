/**
 * Verifies the session layer without a network or database:
 *   - disconnect classification, backoff, ban detector, state machine (pure)
 *   - the SessionManager orchestration, driven by a scripted fake socket:
 *     pair → connect → transient-drop reconnect → real-logout re-scan,
 *     plus ban auto-pause and the kill switch.
 * Run: npm run test:session
 */
import { EventEmitter } from 'node:events';
import { DisconnectReason, type WASocket } from '@whiskeysockets/baileys';
import { createEncryptor, generateKeyHex } from '../../crypto/encryptor.js';
import { InMemoryAuthStore } from '../auth/store.js';
import { useEncryptedAuthState } from '../auth/state.js';
import { DirectTransport } from '../transport/types.js';
import { classifyDisconnect } from './classify.js';
import { backoffDelay } from './backoff.js';
import { BanDetector } from './banDetector.js';
import { transition, canPost } from './stateMachine.js';
import { SessionManager, type ScheduleFn, type SocketFactory } from './manager.js';
import type { ManagerEvent } from './events.js';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

// ── classify ────────────────────────────────────────────────────────────────
console.log('Disconnect classification:');
check('restartRequired => reconnect-now, not forced', (() => {
  const c = classifyDisconnect(DisconnectReason.restartRequired);
  return c.action === 'reconnect-now' && !c.forced;
})());
check('loggedOut => logged-out, forced', (() => {
  const c = classifyDisconnect(DisconnectReason.loggedOut);
  return c.action === 'logged-out' && c.forced;
})());
check('badSession => logged-out (re-scan)', classifyDisconnect(DisconnectReason.badSession).action === 'logged-out');
check('connectionReplaced => fatal', classifyDisconnect(DisconnectReason.connectionReplaced).action === 'fatal');
check('connectionClosed => reconnect-backoff, not forced', (() => {
  const c = classifyDisconnect(DisconnectReason.connectionClosed);
  return c.action === 'reconnect-backoff' && !c.forced;
})());
check('unknown code => reconnect-backoff, forced', (() => {
  const c = classifyDisconnect(9999);
  return c.action === 'reconnect-backoff' && c.forced;
})());

// ── backoff ─────────────────────────────────────────────────────────────────
console.log('\nBackoff:');
const opts = { baseMs: 1000, maxMs: 60_000, factor: 2, jitter: 0.3 };
const mid = [0, 1, 2, 3, 4, 5].map((a) => backoffDelay(a, opts, () => 0.5));
check('grows then caps', mid[0] < mid[1] && mid[1] < mid[2] && mid[5] <= opts.maxMs, mid.join(','));
check('jitter floor respects base', backoffDelay(0, opts, () => 0) >= opts.baseMs);
check('cap holds at high attempt', backoffDelay(50, opts, () => 1) <= opts.maxMs * 1.3 + 1);

// ── ban detector ────────────────────────────────────────────────────────────
console.log('\nBan detector:');
check('logout during warm-up => likely-banned', new BanDetector().record({ at: 0, forced: true, reason: 'loggedOut' }, { ageDays: 2 }).level === 'likely-banned');
check('logout on aged number => suspicious', new BanDetector().record({ at: 0, forced: true, reason: 'loggedOut' }, { ageDays: 60 }).level === 'suspicious');
check('few transient drops => ok', new BanDetector().record({ at: 0, forced: false, reason: 'connectionClosed' }).level === 'ok');
check('many forced drops => escalates', (() => {
  const d = new BanDetector({ suspiciousThreshold: 3, bannedThreshold: 5 });
  let last = d.record({ at: 1, forced: true, reason: 'code(x)' });
  for (let i = 2; i <= 5; i++) last = d.record({ at: i, forced: true, reason: 'code(x)' });
  return last.level === 'likely-banned';
})());

// ── state machine ─────────────────────────────────────────────────────────────
console.log('\nState machine:');
check('disconnected +connect => connecting', transition('disconnected', 'connect') === 'connecting');
check('connecting +qr => qr_pending', transition('connecting', 'qr') === 'qr_pending');
check('qr_pending +open => connected', transition('qr_pending', 'open') === 'connected');
check('connected +closed => disconnected', transition('connected', 'closed') === 'disconnected');
check('any +pause => paused', transition('connected', 'pause') === 'paused');
check('paused +resume => disconnected', transition('paused', 'resume') === 'disconnected');
check('logged_out +resume stays logged_out', transition('logged_out', 'resume') === 'logged_out');
check('only connected can post', canPost('connected') && !canPost('qr_pending'));

// ── manager orchestration (fake socket) ───────────────────────────────────────
async function managerScenarios() {
  console.log('\nManager: pair → reconnect → logout:');
  const enc = createEncryptor(Buffer.from(generateKeyHex(), 'hex'));
  const authState = await useEncryptedAuthState(new InMemoryAuthStore(), enc);

  let currentEv: EventEmitter;
  let createCount = 0;
  const createSocket: SocketFactory = () => {
    createCount++;
    const ev = new EventEmitter();
    currentEv = ev;
    return { ev, user: { id: '254712345678:1@s.whatsapp.net' }, end: () => {}, logout: async () => {} } as unknown as WASocket;
  };

  const pending: { fn: () => void; ms: number }[] = [];
  const schedule: ScheduleFn = (fn, ms) => {
    const e = { fn, ms };
    pending.push(e);
    return () => {
      const i = pending.indexOf(e);
      if (i >= 0) pending.splice(i, 1);
    };
  };
  const flush = () => pending.splice(0).forEach((e) => e.fn());

  const events: ManagerEvent[] = [];
  const mgr = new SessionManager({
    sessionId: 'sess-1',
    authState,
    transport: new DirectTransport(),
    version: [2, 3000, 0],
    onEvent: (e) => events.push(e),
    createSocket,
    schedule,
    ageDays: () => 60, // aged number, so logout is "suspicious" not auto-banned here
  });

  mgr.start();
  check('start => connecting, socket created', mgr.state === 'connecting' && createCount === 1);

  currentEv!.emit('connection.update', { qr: 'QR-CODE-1' });
  check('qr => qr_pending + qr event', mgr.state === 'qr_pending' && events.some((e) => e.type === 'qr'));

  currentEv!.emit('connection.update', { connection: 'open' });
  check('open => connected + can post', mgr.state === 'connected' && mgr.canPost() && !!mgr.getSocket());

  // Transient drop (restartRequired) → immediate reconnect.
  currentEv!.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: DisconnectReason.restartRequired } } },
  });
  check('restartRequired => reconnect scheduled at 0ms', pending.length === 1 && pending[0].ms === 0);
  flush();
  check('reconnect created a new socket', createCount === 2 && mgr.state === 'connecting');

  currentEv!.emit('connection.update', { connection: 'open' });
  check('reconnected => connected again', mgr.state === 'connected');

  // Real logout → re-scan, no reconnect.
  currentEv!.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: DisconnectReason.loggedOut } } },
  });
  check('loggedOut => logged_out + needs-rescan, no reconnect', mgr.state === 'logged_out' && events.some((e) => e.type === 'needs-rescan') && pending.length === 0);

  console.log('\nManager: ban auto-pause during warm-up:');
  const events2: ManagerEvent[] = [];
  let ev2Count = 0;
  const mgr2 = new SessionManager({
    sessionId: 'sess-2',
    authState: await useEncryptedAuthState(new InMemoryAuthStore(), enc),
    transport: new DirectTransport(),
    version: [2, 3000, 0],
    onEvent: (e) => events2.push(e),
    createSocket: () => {
      ev2Count++;
      const ev = new EventEmitter();
      currentEv = ev;
      return { ev, user: { id: 'x:1@s.whatsapp.net' }, end: () => {}, logout: async () => {} } as unknown as WASocket;
    },
    schedule,
    ageDays: () => 2, // warm-up → logout is treated as a ban
  });
  mgr2.start();
  currentEv!.emit('connection.update', { connection: 'open' });
  currentEv!.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: DisconnectReason.loggedOut } } },
  });
  const banned = events2.find((e) => e.type === 'ban-signal');
  check('warm-up logout => ban-signal likely-banned + paused', banned?.type === 'ban-signal' && banned.verdict.level === 'likely-banned' && mgr2.state === 'paused' && pending.length === 0);

  console.log('\nManager: kill switch:');
  let created3 = 0;
  const mgr3 = new SessionManager({
    sessionId: 'sess-3',
    authState: await useEncryptedAuthState(new InMemoryAuthStore(), enc),
    transport: new DirectTransport(),
    version: [2, 3000, 0],
    onEvent: () => {},
    createSocket: () => {
      created3++;
      return { ev: new EventEmitter(), end: () => {}, logout: async () => {} } as unknown as WASocket;
    },
    schedule,
    shouldRun: () => false,
  });
  mgr3.start();
  check('shouldRun=false => paused, no socket created', mgr3.state === 'paused' && created3 === 0);
}

managerScenarios()
  .then(() => {
    console.log('');
    if (failures > 0) {
      console.error(`❌ ${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log('✅ Session layer OK (classify + backoff + ban detect + state machine + manager).');
  })
  .catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
