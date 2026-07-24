import type { PrismaClient } from '@prisma/client';
import type { AuthStore } from './store.js';

/** Prisma 7 Bytes columns want Uint8Array<ArrayBuffer>; copy the Buffer into one. */
function toBytes(b: Buffer): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(b.byteLength);
  const u8 = new Uint8Array(ab);
  u8.set(b);
  return u8;
}

/**
 * Postgres-backed AuthStore (via Prisma). Creds live on the WhatsappSession row;
 * signal keys are one row each in SignalKey (they're written frequently, so we
 * upsert per key and index on sessionId). All values are ciphertext.
 *
 * The WhatsappSession row must already exist (created at onboarding). Running
 * this needs a live database; the logic it feeds is proven in state.ts's
 * self-test against the in-memory store.
 */
export class PrismaAuthStore implements AuthStore {
  constructor(
    private prisma: PrismaClient,
    private sessionId: string,
  ) {}

  async loadCreds(): Promise<Buffer | null> {
    const row = await this.prisma.whatsappSession.findUnique({
      where: { id: this.sessionId },
      select: { encCreds: true },
    });
    return row?.encCreds ? Buffer.from(row.encCreds) : null;
  }

  async saveCreds(enc: Buffer): Promise<void> {
    await this.prisma.whatsappSession.update({
      where: { id: this.sessionId },
      data: { encCreds: toBytes(enc) },
    });
  }

  async getKeys(category: string, ids: string[]): Promise<Record<string, Buffer | null>> {
    const rows = await this.prisma.signalKey.findMany({
      where: { sessionId: this.sessionId, category, keyId: { in: ids } },
      select: { keyId: true, encValue: true },
    });
    const out: Record<string, Buffer | null> = {};
    for (const id of ids) out[id] = null;
    for (const r of rows) out[r.keyId] = Buffer.from(r.encValue);
    return out;
  }

  async setKeys(
    entries: { category: string; keyId: string; enc: Buffer | null }[],
  ): Promise<void> {
    // One transaction so a burst of key writes is atomic per Baileys `set` call.
    await this.prisma.$transaction(
      entries.map((e) =>
        e.enc === null
          ? this.prisma.signalKey.deleteMany({
              where: { sessionId: this.sessionId, category: e.category, keyId: e.keyId },
            })
          : this.prisma.signalKey.upsert({
              where: {
                sessionId_category_keyId: {
                  sessionId: this.sessionId,
                  category: e.category,
                  keyId: e.keyId,
                },
              },
              create: {
                sessionId: this.sessionId,
                category: e.category,
                keyId: e.keyId,
                encValue: toBytes(e.enc),
              },
              update: { encValue: toBytes(e.enc) },
            }),
      ),
    );
  }

  async clear(): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.signalKey.deleteMany({ where: { sessionId: this.sessionId } }),
      this.prisma.whatsappSession.update({
        where: { id: this.sessionId },
        data: { encCreds: null },
      }),
    ]);
  }
}
