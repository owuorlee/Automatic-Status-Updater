import {
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import type { Encryptor } from '../../crypto/encryptor.js';
import { type AuthStore, serialize, deserialize } from './store.js';

export interface EncryptedAuthState {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

/**
 * A drop-in replacement for Baileys' `useMultiFileAuthState` that persists the
 * auth state through an `AuthStore`, encrypting every value at rest. Mirrors the
 * reference implementation's semantics (incl. the app-state-sync-key proto
 * reconstruction on read) so Baileys behaves identically — it just never sees
 * plaintext on disk.
 *
 * Pass the returned `state` to `makeWASocket({ auth: state })` and wire
 * `sock.ev.on('creds.update', saveCreds)`.
 */
export async function useEncryptedAuthState(
  store: AuthStore,
  enc: Encryptor,
): Promise<EncryptedAuthState> {
  const credsBlob = await store.loadCreds();
  const creds: AuthenticationCreds = credsBlob
    ? (deserialize(enc.decrypt(credsBlob)) as AuthenticationCreds)
    : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const encMap = await store.getKeys(type, ids);
        const data: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          const blob = encMap[id];
          if (!blob) continue;
          let value = deserialize(enc.decrypt(blob));
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
          }
          data[id] = value as SignalDataTypeMap[T];
        }
        return data;
      },
      set: async (data) => {
        const entries: { category: string; keyId: string; enc: Buffer | null }[] = [];
        for (const category of Object.keys(data)) {
          const bucket = data[category as keyof SignalDataTypeMap];
          if (!bucket) continue;
          for (const id of Object.keys(bucket)) {
            const value = (bucket as Record<string, unknown>)[id];
            entries.push({
              category,
              keyId: id,
              enc: value ? enc.encrypt(serialize(value)) : null,
            });
          }
        }
        if (entries.length) await store.setKeys(entries);
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      await store.saveCreds(enc.encrypt(serialize(state.creds)));
    },
  };
}
