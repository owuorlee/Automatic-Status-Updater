/**
 * Verifies the encrypted auth adapter without a database:
 *   - AES-256-GCM round-trip, tamper detection, wrong-key rejection
 *   - creds persist across a simulated restart (the whole point of the adapter)
 *   - signal keys round-trip (incl. app-state-sync-key proto reconstruction)
 *   - key deletion works
 *   - stored bytes are ciphertext, unreadable with the wrong key
 * Run: npm run test:auth
 */
import { randomBytes } from 'node:crypto';
import { createEncryptor, generateKeyHex, KEY_LEN } from '../../crypto/encryptor.js';
import { InMemoryAuthStore } from './store.js';
import { useEncryptedAuthState } from './state.js';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}
function bytesEqual(a: Uint8Array, b: Uint8Array) {
  return Buffer.from(a).equals(Buffer.from(b));
}
const newKey = () => Buffer.from(generateKeyHex(), 'hex');

async function main() {
  console.log('Encrypted auth adapter self-test\n');

  console.log('AES-256-GCM primitive:');
  const enc = createEncryptor(newKey());
  const secret = randomBytes(200);
  const blob = enc.encrypt(secret);
  check('round-trips', bytesEqual(enc.decrypt(blob), secret));
  check('ciphertext differs from plaintext', !bytesEqual(blob.subarray(28), secret));
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 0xff;
  check('tamper detected (auth tag)', throws(() => enc.decrypt(tampered)));
  check('wrong key rejected', throws(() => createEncryptor(newKey()).decrypt(blob)));
  check('bad key length rejected', throws(() => createEncryptor(randomBytes(KEY_LEN - 1))));

  console.log('\nCreds persistence across a simulated restart:');
  const store = new InMemoryAuthStore();
  const a1 = await useEncryptedAuthState(store, enc);
  check('fresh creds initialised', !!a1.state.creds.noiseKey && a1.state.creds.registered === false);
  a1.state.creds.registered = true;
  a1.state.creds.me = { id: '254712345678:1@s.whatsapp.net', name: 'Test Biz' };
  await a1.saveCreds();

  const a2 = await useEncryptedAuthState(store, enc); // "restart" — new instance, same store
  check('registered flag survived', a2.state.creds.registered === true);
  check('me.id survived', a2.state.creds.me?.id === '254712345678:1@s.whatsapp.net');
  check('noiseKey survived intact', bytesEqual(a2.state.creds.noiseKey.private, a1.state.creds.noiseKey.private));

  console.log('\nSignal key store round-trip:');
  const preKey = { private: randomBytes(32), public: randomBytes(32) };
  const sessionVal = randomBytes(64);
  const appKey = {
    keyData: randomBytes(32),
    fingerprint: { rawId: 1, currentIndex: 2, deviceIndexes: [0, 1] },
    timestamp: 1720000000,
  };
  await a2.state.keys.set({
    'pre-key': { '1': preKey },
    session: { 'sig::1': sessionVal },
    'app-state-sync-key': { key1: appKey },
  } as never);

  const gotPre = await a2.state.keys.get('pre-key', ['1']);
  check('pre-key round-trips', bytesEqual(gotPre['1'].private, preKey.private) && bytesEqual(gotPre['1'].public, preKey.public));
  const gotSession = await a2.state.keys.get('session', ['sig::1']);
  check('session buffer round-trips', bytesEqual(gotSession['sig::1'] as Uint8Array, sessionVal));
  const gotApp = await a2.state.keys.get('app-state-sync-key', ['key1']);
  check('app-state-sync-key reconstructed as proto', !!gotApp['key1'] && bytesEqual(gotApp['key1'].keyData as Uint8Array, appKey.keyData));

  console.log('\nKey deletion:');
  await a2.state.keys.set({ 'pre-key': { '1': null } } as never);
  const afterDel = await a2.state.keys.get('pre-key', ['1']);
  check('deleted pre-key is gone', afterDel['1'] === undefined);

  console.log('\nEncryption at rest:');
  const raw = store._rawCreds();
  check('stored creds are not plaintext JSON', !!raw && throws(() => JSON.parse(raw.toString('utf-8'))));
  let wrongKeyThrew = false;
  try {
    await useEncryptedAuthState(store, createEncryptor(newKey()));
  } catch {
    wrongKeyThrew = true;
  }
  check('store is undecryptable with a different key', wrongKeyThrew);

  console.log('');
  if (failures > 0) {
    console.error(`❌ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('✅ Encrypted auth adapter OK (crypto + persistence + key store + at-rest).');
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
