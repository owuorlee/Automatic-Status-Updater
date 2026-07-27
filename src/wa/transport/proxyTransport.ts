import type { Agent } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ConnectionOptions, ProxyConfig, SessionTransport } from './types.js';

function proxyUrl(p: ProxyConfig): string {
  const scheme = p.protocol ?? 'http';
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? '')}@`
    : '';
  return `${scheme}://${auth}${p.host}:${p.port}`;
}

function buildAgent(p: ProxyConfig): Agent {
  const url = proxyUrl(p);
  return (p.protocol === 'socks5' ? new SocksProxyAgent(url) : new HttpsProxyAgent(url)) as unknown as Agent;
}

/**
 * Binds each session to its own proxy agent and caches it for the session's
 * lifetime — "sticky" egress (DECISIONS §D2): a session must not hop IPs on
 * every reconnect, so we reuse one agent until the session is released.
 */
export class ProxyAgentTransport implements SessionTransport {
  private cache = new Map<string, Agent>();

  connectionOptions(sessionId: string, proxy: ProxyConfig | null): ConnectionOptions {
    if (!proxy) return {};
    let agent = this.cache.get(sessionId);
    if (!agent) {
      agent = buildAgent(proxy);
      this.cache.set(sessionId, agent);
    }
    // Same agent for the socket and media uploads so both share the egress IP.
    return { agent, fetchAgent: agent };
  }

  release(sessionId: string): void {
    const agent = this.cache.get(sessionId);
    if (agent) {
      agent.destroy();
      this.cache.delete(sessionId);
    }
  }
}
