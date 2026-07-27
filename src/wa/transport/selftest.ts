/**
 * Verifies proxy transport wiring + stickiness without a real proxy.
 * Run: npm run test:transport
 */
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { DirectTransport, type ProxyConfig } from './types.js';
import { ProxyAgentTransport } from './proxyTransport.js';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const httpProxy: ProxyConfig = { kind: 'residential', protocol: 'http', host: '10.0.0.1', port: 8080, username: 'u', password: 'p' };
const socksProxy: ProxyConfig = { kind: 'mobile', protocol: 'socks5', host: '10.0.0.2', port: 1080 };

console.log('Transport self-test\n');

const direct = new DirectTransport();
check('DirectTransport => no agent', direct.connectionOptions().agent === undefined);

const t = new ProxyAgentTransport();

const a1 = t.connectionOptions('sess-A', httpProxy);
check('http proxy => HttpsProxyAgent', a1.agent instanceof HttpsProxyAgent);
check('socket + media share one agent (same egress IP)', a1.agent === a1.fetchAgent);

const a1b = t.connectionOptions('sess-A', httpProxy);
check('sticky: same session reuses the same agent', a1.agent === a1b.agent);

const a2 = t.connectionOptions('sess-B', httpProxy);
check('different session => different agent', a1.agent !== a2.agent);

const s1 = t.connectionOptions('sess-C', socksProxy);
check('socks5 proxy => SocksProxyAgent', s1.agent instanceof SocksProxyAgent);

check('null proxy => no agent', t.connectionOptions('sess-D', null).agent === undefined);

t.release('sess-A');
const a1c = t.connectionOptions('sess-A', httpProxy);
check('after release, a fresh agent is created', a1c.agent !== a1.agent);

console.log('');
if (failures > 0) {
  console.error(`❌ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✅ Transport OK (agent selection + sticky binding + release).');
