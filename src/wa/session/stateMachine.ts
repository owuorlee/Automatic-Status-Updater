/**
 * The session lifecycle surfaced to the dashboard (requirement §3):
 *   disconnected → connecting → qr_pending → connected → logged_out
 * plus `paused` for the kill switch. Pure transition function; the manager
 * drives it from Baileys events.
 */
export type SessionState =
  | 'disconnected'
  | 'connecting'
  | 'qr_pending'
  | 'connected'
  | 'logged_out'
  | 'paused';

export type SessionEventType =
  | 'connect'
  | 'qr'
  | 'open'
  | 'closed'
  | 'logged_out'
  | 'pause'
  | 'resume';

export function transition(state: SessionState, event: SessionEventType): SessionState {
  // The kill switch wins from any state.
  if (event === 'pause') return 'paused';
  // A hard logout wins from any state except paused (a paused session stays put).
  if (event === 'logged_out') return state === 'paused' ? 'paused' : 'logged_out';

  switch (event) {
    case 'connect':
      // Allowed from any non-paused state (incl. re-scan from logged_out).
      return state === 'paused' ? 'paused' : 'connecting';
    case 'qr':
      return state === 'connecting' ? 'qr_pending' : state;
    case 'open':
      return state === 'connecting' || state === 'qr_pending' ? 'connected' : state;
    case 'closed':
      // Transient close; the manager decides whether/when to reconnect.
      return state === 'connected' || state === 'connecting' || state === 'qr_pending'
        ? 'disconnected'
        : state;
    case 'resume':
      // Resume from pause, but a logged-out session still needs a re-scan.
      return state === 'paused' ? 'disconnected' : state;
    default:
      return state;
  }
}

/** Only a fully connected session may post. */
export function canPost(state: SessionState): boolean {
  return state === 'connected';
}
