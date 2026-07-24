/**
 * AES-256-GCM authenticated encryption for secrets at rest (WhatsApp creds/keys,
 * proxy credentials). Blob layout: [ 12-byte IV | 16-byte tag | ciphertext ].
 * GCM gives us tamper-detection for free — decrypt throws if the blob or key is
 * wrong, which is exactly what we want for stored session material.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LEN = 12;
const TAG_LEN = 16;
export const KEY_LEN = 32;

export interface Encryptor {
  encrypt(plain: Buffer): Buffer;
  decrypt(blob: Buffer): Buffer;
}

export function createEncryptor(key: Buffer): Encryptor {
  if (key.length !== KEY_LEN) {
    throw new Error(`Encryption key must be ${KEY_LEN} bytes, got ${key.length}.`);
  }
  return {
    encrypt(plain) {
      const iv = randomBytes(IV_LEN);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ct]);
    },
    decrypt(blob) {
      if (blob.length < IV_LEN + TAG_LEN) throw new Error('Ciphertext too short.');
      const iv = blob.subarray(0, IV_LEN);
      const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const ct = blob.subarray(IV_LEN + TAG_LEN);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]);
    },
  };
}

/** Load a 32-byte key from an env var (64 hex chars, or base64). */
export function keyFromEnv(value = process.env.ENCRYPTION_KEY): Buffer {
  if (!value) throw new Error('ENCRYPTION_KEY is not set.');
  const buf = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  if (buf.length !== KEY_LEN) {
    throw new Error('ENCRYPTION_KEY must decode to 32 bytes (64 hex chars or base64).');
  }
  return buf;
}

/** Generate a fresh key for `ENCRYPTION_KEY` (hex). Run once, store as a secret. */
export function generateKeyHex(): string {
  return randomBytes(KEY_LEN).toString('hex');
}
