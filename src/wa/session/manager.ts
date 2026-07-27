import makeWASocket, {
  Browsers,
  type ConnectionState,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import type { EncryptedAuthState } from '../auth/state.js';
import type { ProxyConfig, SessionTransport } from '../transport/types.js';
import { classifyDisconnect } from './classify.js';
import { backoffDelay, type BackoffOptions } from './backoff.js';
import { BanDetector } from './banDetector.js';
import { canPost, transition, type SessionState } from './stateMachine.js';
import type { ManagerEvent, ManagerEventHandler } from './events.js';

/** Create a socket. Injectable so orchestration is testable without a network. */
export type SocketFactory = (
  config: Parameters<typeof makeWASocket>[0],
) => ReturnType<typeof makeWASocket>;

/** Schedule a callback; returns a cancel fn. Injectable for deterministic tests. */
export type ScheduleFn = (fn: () => void, ms: number) => () => void;

const realSchedule: ScheduleFn = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export interface SessionManagerDeps {
  sessionId: string;
  authState: EncryptedAuthState;
  transport: SessionTransport;
  proxy?: ProxyConfig | null;
  version: [number, number, number];
  browser?: [string, string, string];
  onEvent: ManagerEventHandler;
  createSocket?: SocketFactory;
  schedule?: ScheduleFn;
  backoff?: BackoffOptions;
  banDetector?: BanDetector;
  /** Current connection age in days, for warm-up-aware ban detection. */
  ageDays?: () => number;
  /** Kill switch: return false to keep the session paused (global/per-client). */
  shouldRun?: () => boolean;
  rng?: () => number;
}

/**
 * Owns one WhatsApp session's full lifecycle (requirement §2/§3): QR pairing,
 * connect, reconnect-with-backoff on transient drops, re-scan on real logout,
 * ban-signal auto-pause, and the kill switch. One instance per number; a crash
 * here never touches the web app (workers are separate processes, DECISIONS).
 */
export class SessionManager {
  state: SessionState = 'disconnected';
  private attempt = 0;
  private sock?: WASocket;
  private cancelReconnect?: () => void;
  private stopped = false;
  private readonly banDetector: BanDetector;
  private readonly logger = pino({ level: process.env.BAILEYS_LOG_LEVEL ?? 'silent' });

  constructor(private readonly deps: SessionManagerDeps) {
    this.banDetector = deps.banDetector ?? new BanDetector();
  }

  /** Begin connecting (or reconnecting after stop()). */
  start(): void {
    this.stopped = false;
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    if (!(this.deps.shouldRun?.() ?? true)) {
      this.setState('paused');
      return;
    }
    this.clearReconnect();
    this.setState(transition(this.state, 'connect'));

    const conn = this.deps.transport.connectionOptions(this.deps.sessionId, this.deps.proxy ?? null);
    const factory = this.deps.createSocket ?? (makeWASocket as SocketFactory);
    let sock: WASocket;
    try {
      sock = factory({
        version: this.deps.version,
        auth: this.deps.authState.state,
        logger: this.logger,
        browser: this.deps.browser ?? Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        agent: conn.agent,
        fetchAgent: conn.fetchAgent,
      });
    } catch (e) {
      this.emit({ type: 'error', sessionId: this.deps.sessionId, error: `socket-create: ${(e as Error).message}` });
      this.scheduleReconnect(backoffDelay(this.attempt++, this.deps.backoff, this.deps.rng));
      return;
    }

    this.sock = sock;
    sock.ev.on('creds.update', this.deps.authState.saveCreds);
    sock.ev.on('connection.update', (u) => this.onConnectionUpdate(u));
  }

  private onConnectionUpdate(u: Partial<ConnectionState>): void {
    if (u.qr) {
      this.setState(transition(this.state, 'qr'));
      this.emit({ type: 'qr', sessionId: this.deps.sessionId, qr: u.qr });
    }
    if (u.connection === 'open') {
      this.attempt = 0;
      this.setState(transition(this.state, 'open'));
      this.emit({ type: 'connected', sessionId: this.deps.sessionId, jid: this.sock?.user?.id });
    }
    if (u.connection === 'close') {
      this.handleClose(u.lastDisconnect);
    }
  }

  private handleClose(lastDisconnect: ConnectionState['lastDisconnect']): void {
    const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
      ?.statusCode;
    const cls = classifyDisconnect(code);

    const verdict = this.banDetector.record(
      { at: Date.now(), forced: cls.forced, reason: cls.reason },
      { ageDays: this.deps.ageDays?.() },
    );
    if (verdict.level !== 'ok') {
      this.emit({ type: 'ban-signal', sessionId: this.deps.sessionId, verdict });
      if (verdict.level === 'likely-banned') {
        this.pause(); // auto-pause; the ban-signal event already carries the reason
        return;
      }
    }

    switch (cls.action) {
      case 'logged-out':
        this.endSocket();
        this.setState(transition(this.state, 'logged_out'));
        this.emit({ type: 'needs-rescan', sessionId: this.deps.sessionId, reason: cls.reason });
        return;
      case 'fatal':
        this.endSocket();
        this.setState(transition(this.state, 'closed'));
        this.emit({ type: 'error', sessionId: this.deps.sessionId, error: `fatal: ${cls.reason}` });
        return;
      case 'reconnect-now':
        this.setState(transition(this.state, 'closed'));
        this.scheduleReconnect(0);
        return;
      case 'reconnect-backoff':
        this.setState(transition(this.state, 'closed'));
        this.scheduleReconnect(backoffDelay(this.attempt++, this.deps.backoff, this.deps.rng));
        return;
    }
  }

  private scheduleReconnect(ms: number): void {
    if (this.stopped) return;
    if (!(this.deps.shouldRun?.() ?? true)) {
      this.setState('paused');
      return;
    }
    this.clearReconnect();
    const schedule = this.deps.schedule ?? realSchedule;
    this.cancelReconnect = schedule(() => {
      this.cancelReconnect = undefined;
      this.connect();
    }, ms);
  }

  private clearReconnect(): void {
    this.cancelReconnect?.();
    this.cancelReconnect = undefined;
  }

  /** Kill switch / auto-pause. Honoured immediately. */
  pause(): void {
    this.clearReconnect();
    this.endSocket();
    this.setState('paused');
  }

  resume(): void {
    if (this.state === 'logged_out') return; // must re-scan, not just resume
    this.setState(transition(this.state, 'resume'));
    this.connect();
  }

  /** Permanent teardown (process shutdown, client removed). */
  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.endSocket();
    this.deps.transport.release?.(this.deps.sessionId);
  }

  canPost(): boolean {
    return canPost(this.state);
  }

  /** The live socket, only when connected — the poster uses this. */
  getSocket(): WASocket | undefined {
    return this.canPost() ? this.sock : undefined;
  }

  private endSocket(): void {
    try {
      this.sock?.end(undefined);
    } catch {
      /* already closed */
    }
    this.sock = undefined;
  }

  private setState(next: SessionState): void {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    this.emit({ type: 'state', sessionId: this.deps.sessionId, state: next, prev });
  }

  private emit(ev: ManagerEvent): void {
    try {
      this.deps.onEvent(ev);
    } catch {
      /* never let a subscriber throw into the manager */
    }
  }
}
