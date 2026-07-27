import type { Agent } from 'node:https';

/**
 * Per-session network egress (DECISIONS §D2). `kind` is the risk/quality tier;
 * `protocol` is the wire protocol of the proxy endpoint.
 */
export interface ProxyConfig {
  kind: 'mobile' | 'residential' | 'datacenter';
  protocol?: 'http' | 'https' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/** What gets merged into makeWASocket() — the socket and media-upload agents. */
export interface ConnectionOptions {
  agent?: Agent;
  fetchAgent?: Agent;
}

/**
 * Pluggable egress. The proxy-agent impl ships now; a phone-as-relay impl can
 * drop in later (DECISIONS §D2) without touching the session manager.
 */
export interface SessionTransport {
  connectionOptions(sessionId: string, proxy: ProxyConfig | null): ConnectionOptions;
  /** Drop any cached (sticky) agent for a session when it's torn down. */
  release?(sessionId: string): void;
}

/** No proxy — direct connection. For local/dev only; NOT for production scale. */
export class DirectTransport implements SessionTransport {
  connectionOptions(): ConnectionOptions {
    return {};
  }
}
