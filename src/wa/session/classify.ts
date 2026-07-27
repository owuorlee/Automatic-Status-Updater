import { DisconnectReason } from '@whiskeysockets/baileys';

/**
 * What to do when a Baileys connection closes, derived from the disconnect code
 * (requirement §2). This is the single place that decides reconnect-vs-rescan,
 * so it's pure and unit-tested.
 */
export type DisconnectAction = 'reconnect-now' | 'reconnect-backoff' | 'logged-out' | 'fatal';

export interface DisconnectClassification {
  action: DisconnectAction;
  reason: string;
  code: number | undefined;
  /** Counts as a suspicious/forced close for ban detection. */
  forced: boolean;
}

export function classifyDisconnect(code: number | undefined): DisconnectClassification {
  const c = (action: DisconnectAction, reason: string, forced: boolean): DisconnectClassification => ({
    action,
    reason,
    code,
    forced,
  });

  switch (code) {
    // Expected right after first pairing — reconnect immediately, not a signal.
    case DisconnectReason.restartRequired:
      return c('reconnect-now', 'restartRequired', false);

    // Ordinary transient drops — back off and retry.
    case DisconnectReason.connectionClosed:
      return c('reconnect-backoff', 'connectionClosed', false);

    // A real, unexpected logout: needs a human re-scan. Do NOT auto-reconnect.
    case DisconnectReason.loggedOut:
      return c('logged-out', 'loggedOut', true);

    // Corrupt session material — creds are unusable, must re-pair.
    case DisconnectReason.badSession:
      return c('logged-out', 'badSession', true);

    // Another device took over this session — stop and surface; don't fight it.
    case DisconnectReason.connectionReplaced:
      return c('fatal', 'connectionReplaced', true);

    // Network blips and everything unrecognised — cautious backoff reconnect.
    // (connectionLost / timedOut fall here; they share codes across versions,
    //  so we avoid duplicate switch labels and treat them as transient.)
    default:
      return c('reconnect-backoff', code == null ? 'unknown' : `code(${code})`, code != null);
  }
}
