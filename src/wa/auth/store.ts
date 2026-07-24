import { BufferJSON } from '@whiskeysockets/baileys';

/**
 * Persistence abstraction for encrypted auth material. Splitting this from the
 * Baileys glue (state.ts) and the crypto (encryptor.ts) means the whole
 * serialize→encrypt→store→decrypt→deserialize loop is testable against an
 * in-memory store, while the Postgres binding (prismaStore.ts) stays thin.
 *
 * Every Buffer that crosses this interface is CIPHERTEXT.
 */
export interface AuthStore {
  loadCreds(): Promise<Buffer | null>;
  saveCreds(enc: Buffer): Promise<void>;
  getKeys(category: string, ids: string[]): Promise<Record<string, Buffer | null>>;
  setKeys(entries: { category: string; keyId: string; enc: Buffer | null }[]): Promise<void>;
  clear(): Promise<void>;
}

/** Baileys-compatible JSON (handles Buffers/Uint8Arrays) → bytes, and back. */
export function serialize(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, BufferJSON.replacer));
}
export function deserialize(buf: Buffer): unknown {
  return JSON.parse(buf.toString('utf-8'), BufferJSON.reviver);
}

/** In-memory store for tests and local runs. Not for production. */
export class InMemoryAuthStore implements AuthStore {
  private creds: Buffer | null = null;
  private keys = new Map<string, Buffer>();
  private k(category: string, id: string) {
    return `${category}::${id}`;
  }
  async loadCreds() {
    return this.creds;
  }
  async saveCreds(enc: Buffer) {
    this.creds = enc;
  }
  async getKeys(category: string, ids: string[]) {
    const out: Record<string, Buffer | null> = {};
    for (const id of ids) out[id] = this.keys.get(this.k(category, id)) ?? null;
    return out;
  }
  async setKeys(entries: { category: string; keyId: string; enc: Buffer | null }[]) {
    for (const e of entries) {
      const key = this.k(e.category, e.keyId);
      if (e.enc === null) this.keys.delete(key);
      else this.keys.set(key, e.enc);
    }
  }
  async clear() {
    this.creds = null;
    this.keys.clear();
  }
  /** Test helper: peek at raw stored bytes (to prove they're ciphertext). */
  _rawCreds() {
    return this.creds;
  }
}
