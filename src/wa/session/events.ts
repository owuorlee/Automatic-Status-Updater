import type { BanVerdict } from './banDetector.js';
import type { SessionState } from './stateMachine.js';

/**
 * Events the SessionManager emits. The dashboard subscribes for live QR/health
 * (via Redis pub/sub → SSE, per DECISIONS), and ops for alerts.
 */
export type ManagerEvent =
  | { type: 'state'; sessionId: string; state: SessionState; prev: SessionState }
  | { type: 'qr'; sessionId: string; qr: string }
  | { type: 'connected'; sessionId: string; jid?: string }
  | { type: 'ban-signal'; sessionId: string; verdict: BanVerdict }
  | { type: 'needs-rescan'; sessionId: string; reason: string }
  | { type: 'error'; sessionId: string; error: string };

export type ManagerEventHandler = (event: ManagerEvent) => void;
