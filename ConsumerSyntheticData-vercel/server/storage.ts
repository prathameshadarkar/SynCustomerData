/**
 * server/storage.ts — where raw uploads and per-session state live.
 *
 * Two backends behind one interface:
 *   - Vercel Blob (private store) when BLOB_READ_WRITE_TOKEN is set (production on Vercel)
 *   - Local filesystem otherwise (dev, or any VM host). DATA_DIR overrides the location.
 *
 * Raw files never leave this storage; only parsed chunks flow onward to retrieval,
 * and only budgeted/redacted chunks flow from retrieval to the LLM adapter.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface StorageBackend {
  readonly kind: 'blob' | 'fs';
  putBytes(key: string, data: Buffer | string, contentType?: string): Promise<void>;
  getBytes(key: string): Promise<Buffer | null>;
  del(key: string | string[]): Promise<void>;
  /** List keys under a prefix (non-recursive semantics are fine; we use flat per-session prefixes). */
  list(prefix: string): Promise<string[]>;
}

// ----------------------------------------------------------------------------
// Local filesystem backend
// ----------------------------------------------------------------------------

class FsBackend implements StorageBackend {
  readonly kind = 'fs' as const;
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
  }
  private p(key: string) {
    const safe = key.replace(/\.\./g, '_');
    return path.join(this.root, safe);
  }
  async putBytes(key: string, data: Buffer | string) {
    const fp = this.p(key);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, data);
  }
  async getBytes(key: string) {
    const fp = this.p(key);
    return fs.existsSync(fp) ? fs.readFileSync(fp) : null;
  }
  async del(key: string | string[]) {
    for (const k of Array.isArray(key) ? key : [key]) {
      const fp = this.p(k);
      try {
        if (fs.existsSync(fp)) fs.rmSync(fp, { recursive: true, force: true });
        // prune now-empty parent directories up to the storage root
        let dir = path.dirname(fp);
        while (dir.startsWith(this.root) && dir !== this.root && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        }
      } catch {}
    }
  }
  async list(prefix: string) {
    const dir = this.p(prefix);
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    const walk = (d: string, rel: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r);
        else out.push(`${prefix.replace(/\/$/, '')}/${r}`);
      }
    };
    walk(dir, '');
    return out;
  }
}

// ----------------------------------------------------------------------------
// Vercel Blob backend (private access)
// ----------------------------------------------------------------------------

class BlobBackend implements StorageBackend {
  readonly kind = 'blob' as const;
  private mod: Promise<typeof import('@vercel/blob')>;
  constructor() {
    this.mod = import('@vercel/blob');
  }
  async putBytes(key: string, data: Buffer | string, contentType = 'application/octet-stream') {
    const { put } = await this.mod;
    await put(key, data, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    } as any);
  }
  async getBytes(key: string) {
    const { get } = await this.mod;
    try {
      const res: any = await get(key, { access: 'private', useCache: false } as any);
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      const chunks: Uint8Array[] = [];
      const reader = (res.stream as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c)));
    } catch (e: any) {
      if (e?.name === 'BlobNotFoundError' || /not found/i.test(e?.message || '')) return null;
      throw e;
    }
  }
  async del(key: string | string[]) {
    const { del } = await this.mod;
    const keys = Array.isArray(key) ? key : [key];
    if (keys.length === 0) return;
    try {
      await del(keys);
    } catch (e: any) {
      console.warn('[storage] blob del warning:', e?.message || e);
    }
  }
  async list(prefix: string) {
    const { list } = await this.mod;
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page: any = await list({ prefix, cursor, limit: 1000 } as any);
      for (const b of page.blobs || []) out.push(b.pathname);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }
}

// ----------------------------------------------------------------------------
// Singleton + key helpers
// ----------------------------------------------------------------------------

let backend: StorageBackend | null = null;

export function storage(): StorageBackend {
  if (backend) return backend;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    backend = new BlobBackend();
    console.log('[storage] using Vercel Blob (private)');
  } else {
    const root = process.env.DATA_DIR || path.join(process.env.VERCEL ? os.tmpdir() : process.cwd(), '.data');
    backend = new FsBackend(root);
    console.log(`[storage] using local filesystem at ${root}`);
  }
  return backend;
}

export function safeSessionId(sessionId: string): string {
  return (sessionId || 'default-session').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export const keys = {
  sessionPrefix: (sid: string) => `sessions/${safeSessionId(sid)}/`,
  session: (sid: string) => `sessions/${safeSessionId(sid)}/session.json`,
  index: (sid: string) => `sessions/${safeSessionId(sid)}/index.json`,
  raw: (sid: string, fileId: string, filename: string) =>
    `sessions/${safeSessionId(sid)}/raw/${fileId}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
  /** Where the browser uploads directly (client upload) before the server ingests it. */
  incoming: (sid: string, filename: string) =>
    `sessions/${safeSessionId(sid)}/incoming/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
};

export async function readJson<T>(key: string): Promise<T | null> {
  const buf = await storage().getBytes(key);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString('utf8')) as T;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await storage().putBytes(key, JSON.stringify(value), 'application/json');
}

/** Whether client-direct uploads (browser → Blob) are available. */
export function clientUploadsEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}
