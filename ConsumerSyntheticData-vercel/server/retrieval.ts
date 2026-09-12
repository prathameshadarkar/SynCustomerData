/**
 * server/retrieval.ts — vendor-independent RAG over uploaded research material.
 *
 * Pipeline:  raw file (storage) → parse (unpdf / xlsx / csv / json / txt, all in-process)
 *            → chunk → embed (bge-small-en-v1.5 via transformers.js, in-process) + BM25
 *            → per-session index (JSON in storage) → hybrid search → token budget → redact()
 *
 * Nothing in this module calls an external LLM. The only external network access is an optional
 * one-time model download if the weights were not bundled at build time (see scripts/download-model.mjs).
 */
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { storage, keys, readJson, writeJson } from './storage';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type SourceRole = 'guide' | 'research' | 'prior_evidence';

export interface Chunk {
  id: string;
  fileId: string;
  fileName: string;
  sourceRole: SourceRole;
  /** Human-readable location: "p.3", "row 12", "item 4", "¶7". */
  locator: string;
  text: string;
}

export interface SessionIndex {
  version: 2;
  embedModel: string | null;
  dims: number;
  chunks: Chunk[];
  /** base64-encoded Float32 vectors, aligned with `chunks`; empty strings when embeddings unavailable. */
  vectors: string[];
  updatedAt: string;
}

export interface RetrievedChunk extends Chunk {
  score: number;
  rank: number;
}

export type ExternalDataPolicy = 'raw' | 'redacted' | 'none';

export function externalDataPolicy(): ExternalDataPolicy {
  const v = (process.env.EXTERNAL_DATA_POLICY || 'redacted').toLowerCase();
  return v === 'raw' || v === 'none' ? v : 'redacted';
}

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

// ----------------------------------------------------------------------------
// Parsing
// ----------------------------------------------------------------------------

export interface ParsedDoc {
  /** Units that should not be split across chunks when possible (pages / rows / records / paragraphs). */
  units: { locator: string; text: string }[];
  kind: 'pdf' | 'tabular' | 'json' | 'text';
}

async function parsePdf(buf: Buffer): Promise<ParsedDoc> {
  // unpdf bundles a serverless-friendly pdf.js (no canvas, no dynamic requires) — safe on Vercel.
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages: string[] = Array.isArray(text) ? text : [String(text)];
  const units = pages
    .map((t, i) => ({ locator: `p.${i + 1}`, text: normalizeWs(t) }))
    .filter((u) => u.text.length > 0);
  if (units.length === 0) {
    console.warn('[retrieval] PDF produced no extractable text (scanned image?). OCR is not enabled.');
  }
  return { units, kind: 'pdf' };
}

function rowsToUnits(rows: Record<string, any>[], sheetLabel = ''): { locator: string; text: string }[] {
  const units: { locator: string; text: string }[] = [];
  rows.forEach((row, i) => {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined || String(v).trim() === '') continue;
      parts.push(`${String(k).trim()}: ${String(v).trim()}`);
    }
    if (parts.length === 0) return;
    units.push({ locator: `${sheetLabel}row ${i + 1}`, text: parts.join(' | ') });
  });
  return units;
}

function parseTabular(buf: Buffer, ext: string): ParsedDoc {
  const wb = ext === '.csv' ? XLSX.read(buf.toString('utf8'), { type: 'string' }) : XLSX.read(buf, { type: 'buffer' });
  const units: { locator: string; text: string }[] = [];
  const multi = wb.SheetNames.length > 1;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
    units.push(...rowsToUnits(rows, multi ? `${name} ` : ''));
  }
  return { units, kind: 'tabular' };
}

function flattenJson(v: any, prefix = ''): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v !== 'object') return [`${prefix || 'value'}: ${String(v)}`];
  if (Array.isArray(v)) return v.flatMap((x, i) => flattenJson(x, prefix ? `${prefix}[${i}]` : `[${i}]`));
  return Object.entries(v).flatMap(([k, x]) => flattenJson(x, prefix ? `${prefix}.${k}` : k));
}

function parseJson(buf: Buffer): ParsedDoc {
  const text = buf.toString('utf8');
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return parseText(buf);
  }
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
    ? Object.values(data).find((v) => Array.isArray(v) && v.length > 1) || [data]
    : [data];
  const units = (arr as any[]).map((item, i) => ({
    locator: `item ${i + 1}`,
    text: typeof item === 'object' ? flattenJson(item).join(' | ') : String(item),
  }));
  return { units: units.filter((u) => u.text.trim()), kind: 'json' };
}

function parseText(buf: Buffer): ParsedDoc {
  const text = buf.toString('utf8').replace(/\r\n/g, '\n');
  const paras = text
    .split(/\n\s*\n/)
    .map(normalizeWs)
    .filter(Boolean);
  return { units: paras.map((t, i) => ({ locator: `¶${i + 1}`, text: t })), kind: 'text' };
}

function normalizeWs(s: string) {
  return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export async function parseFile(buf: Buffer, filename: string): Promise<ParsedDoc> {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return parsePdf(buf);
  if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') return parseTabular(buf, ext);
  if (ext === '.json') return parseJson(buf);
  return parseText(buf);
}

// ----------------------------------------------------------------------------
// Chunking
// ----------------------------------------------------------------------------

const TARGET_CHARS = 900;
const MAX_CHARS = 1400;
const OVERLAP_CHARS = 120;
const MAX_CHUNKS_PER_FILE = Number(process.env.MAX_CHUNKS_PER_FILE || 4000);

export function chunkDocument(doc: ParsedDoc, fileId: string, fileName: string, sourceRole: SourceRole): Chunk[] {
  const chunks: Chunk[] = [];
  const push = (locator: string, text: string) => {
    const t = text.trim();
    if (t.length < 20) return;
    chunks.push({ id: `${fileId}-c${chunks.length + 1}`, fileId, fileName, sourceRole, locator, text: t });
  };

  if (doc.kind === 'tabular' || doc.kind === 'json') {
    // One row/record per chunk: keeps participant-level statements intact for both retrieval and anti-copy checks.
    for (const u of doc.units) {
      if (u.text.length <= MAX_CHARS) push(u.locator, u.text);
      else splitLong(u.text).forEach((piece, i) => push(`${u.locator}${i ? ` (${i + 1})` : ''}`, piece));
      if (chunks.length >= MAX_CHUNKS_PER_FILE) break;
    }
    return chunks;
  }

  // Prose: merge paragraphs within a page/unit up to TARGET_CHARS, split very long ones with overlap.
  for (const u of doc.units) {
    const paras = u.text.split(/\n\s*\n|\n(?=\s*(?:[-•*]|\d+[.)]))/).map((p) => p.trim()).filter(Boolean);
    let buffer = '';
    for (const p of paras) {
      if ((buffer + '\n' + p).length > TARGET_CHARS && buffer) {
        push(u.locator, buffer);
        buffer = p;
      } else {
        buffer = buffer ? `${buffer}\n${p}` : p;
      }
      if (buffer.length > MAX_CHARS) {
        const pieces = splitLong(buffer);
        pieces.slice(0, -1).forEach((piece) => push(u.locator, piece));
        buffer = pieces[pieces.length - 1];
      }
    }
    if (buffer) push(u.locator, buffer);
    if (chunks.length >= MAX_CHUNKS_PER_FILE) break;
  }
  return chunks;
}

function splitLong(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + TARGET_CHARS);
    if (end < text.length) {
      const cut = text.lastIndexOf('. ', end);
      if (cut > i + TARGET_CHARS / 2) end = cut + 1;
    }
    out.push(text.slice(i, end).trim());
    if (end >= text.length) break;
    i = Math.max(end - OVERLAP_CHARS, i + 1);
  }
  return out.filter(Boolean);
}

// ----------------------------------------------------------------------------
// Embeddings (in-process, transformers.js)
// ----------------------------------------------------------------------------

const EMBED_MODEL = process.env.EMBED_MODEL || 'Xenova/bge-small-en-v1.5';
let embedderPromise: Promise<((texts: string[]) => Promise<Float32Array[]>) | null> | null = null;

export function embeddingsEnabled(): boolean {
  return (process.env.EMBEDDINGS_PROVIDER || 'local') !== 'none';
}

async function getEmbedder() {
  if (!embeddingsEnabled()) return null;
  if (!embedderPromise) {
    embedderPromise = (async () => {
      try {
        const tf: any = await import('@huggingface/transformers');
        const modelsDir = process.env.MODELS_DIR || path.join(process.cwd(), 'models');
        const bundled = fs.existsSync(path.join(modelsDir, EMBED_MODEL));
        tf.env.cacheDir = bundled ? modelsDir : process.env.VERCEL ? '/tmp/models' : modelsDir;
        tf.env.allowLocalModels = true;
        tf.env.allowRemoteModels = !bundled || process.env.ALLOW_REMOTE_MODELS === 'true';
        if (bundled) {
          tf.env.localModelPath = modelsDir;
        }
        const t0 = Date.now();
        const pipe = await tf.pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' });
        console.log(`[retrieval] embedding model ${EMBED_MODEL} ready in ${Date.now() - t0}ms (${bundled ? 'bundled' : 'downloaded'})`);
        return async (texts: string[]) => {
          const out: Float32Array[] = [];
          const B = 16;
          for (let i = 0; i < texts.length; i += B) {
            const batch = texts.slice(i, i + B).map((t) => t.slice(0, 2000));
            const res = await pipe(batch, { pooling: 'cls', normalize: true });
            const list: number[][] = res.tolist();
            for (const row of list) out.push(Float32Array.from(row));
          }
          return out;
        };
      } catch (e: any) {
        console.warn(`[retrieval] embedding model unavailable (${e?.message || e}); falling back to BM25-only retrieval.`);
        return null;
      }
    })();
  }
  return embedderPromise;
}

const f32ToB64 = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
const b64ToF32 = (s: string) => {
  const b = Buffer.from(s, 'base64');
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

// ----------------------------------------------------------------------------
// BM25
// ----------------------------------------------------------------------------

const STOP = new Set(
  'a an the and or of to in on for with at by from as is are was were be been it its this that these those i you he she they we me my your our their his her them us do does did not no yes so if then than too very can could would should will just about into over after before between out up down off again further once here there when where why how all any both each few more most other some such only own same s t don now what which who whom whose'.split(
    ' '
  )
);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w));
}

class BM25 {
  private df = new Map<string, number>();
  private tf: Map<string, number>[] = [];
  private len: number[] = [];
  private avg = 1;
  constructor(docs: string[], private k1 = 1.4, private b = 0.75) {
    for (const d of docs) {
      const toks = tokenize(d);
      const m = new Map<string, number>();
      for (const t of toks) m.set(t, (m.get(t) || 0) + 1);
      for (const t of m.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
      this.tf.push(m);
      this.len.push(toks.length);
    }
    this.avg = this.len.reduce((a, b) => a + b, 0) / Math.max(1, this.len.length);
  }
  score(query: string): number[] {
    const q = Array.from(new Set(tokenize(query)));
    const N = this.tf.length;
    const scores = new Array(N).fill(0);
    for (const term of q) {
      const df = this.df.get(term);
      if (!df) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (let i = 0; i < N; i++) {
        const f = this.tf[i].get(term);
        if (!f) continue;
        scores[i] += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.len[i]) / this.avg));
      }
    }
    return scores;
  }
}

// ----------------------------------------------------------------------------
// Index lifecycle (per session, cached in memory while the instance is warm)
// ----------------------------------------------------------------------------

interface LoadedIndex {
  idx: SessionIndex;
  vecs: (Float32Array | null)[];
  bm25: BM25;
}

const cache = new Map<string, LoadedIndex>();

function emptyIndex(): SessionIndex {
  return { version: 2, embedModel: null, dims: 0, chunks: [], vectors: [], updatedAt: new Date().toISOString() };
}

async function loadIndex(sessionId: string): Promise<LoadedIndex> {
  const hit = cache.get(sessionId);
  if (hit) return hit;
  const idx = (await readJson<SessionIndex>(keys.index(sessionId))) || emptyIndex();
  const loaded: LoadedIndex = {
    idx,
    vecs: idx.vectors.map((v) => (v ? b64ToF32(v) : null)),
    bm25: new BM25(idx.chunks.map((c) => c.text)),
  };
  cache.set(sessionId, loaded);
  return loaded;
}

async function saveIndex(sessionId: string, loaded: LoadedIndex) {
  loaded.idx.updatedAt = new Date().toISOString();
  loaded.bm25 = new BM25(loaded.idx.chunks.map((c) => c.text));
  cache.set(sessionId, loaded);
  await writeJson(keys.index(sessionId), loaded.idx);
}

export interface IngestResult {
  chunks: number;
  embedded: boolean;
  kind: ParsedDoc['kind'];
  units: number;
  ms: number;
}

/** Parse + chunk + embed one raw file (already stored) and merge into the session index. */
export async function ingestFile(
  sessionId: string,
  fileId: string,
  fileName: string,
  sourceRole: SourceRole,
  buf: Buffer
): Promise<IngestResult> {
  const t0 = Date.now();
  const doc = await parseFile(buf, fileName);
  const chunks = chunkDocument(doc, fileId, fileName, sourceRole);
  const embed = await getEmbedder();
  let vectors: string[] = chunks.map(() => '');
  let dims = 0;
  if (embed && chunks.length > 0) {
    const vs = await embed(chunks.map((c) => `${c.fileName} ${c.locator}: ${c.text}`));
    vectors = vs.map(f32ToB64);
    dims = vs[0]?.length || 0;
  }

  const loaded = await loadIndex(sessionId);
  // Replace any previous chunks for this fileId (re-ingest is idempotent).
  const keep = loaded.idx.chunks.map((c, i) => [c, i] as const).filter(([c]) => c.fileId !== fileId);
  loaded.idx.chunks = [...keep.map(([c]) => c), ...chunks];
  loaded.idx.vectors = [...keep.map(([, i]) => loaded.idx.vectors[i]), ...vectors];
  loaded.idx.embedModel = embed ? EMBED_MODEL : loaded.idx.embedModel;
  loaded.idx.dims = dims || loaded.idx.dims;
  loaded.vecs = loaded.idx.vectors.map((v) => (v ? b64ToF32(v) : null));
  await saveIndex(sessionId, loaded);

  return { chunks: chunks.length, embedded: Boolean(embed), kind: doc.kind, units: doc.units.length, ms: Date.now() - t0 };
}

export async function removeFileFromIndex(sessionId: string, fileId: string) {
  const loaded = await loadIndex(sessionId);
  const keep = loaded.idx.chunks.map((c, i) => [c, i] as const).filter(([c]) => c.fileId !== fileId);
  loaded.idx.chunks = keep.map(([c]) => c);
  loaded.idx.vectors = keep.map(([, i]) => loaded.idx.vectors[i]);
  loaded.vecs = loaded.idx.vectors.map((v) => (v ? b64ToF32(v) : null));
  await saveIndex(sessionId, loaded);
}

export async function clearIndex(sessionId: string) {
  cache.delete(sessionId);
  await storage().del(keys.index(sessionId));
}

export async function indexStats(sessionId: string) {
  const loaded = await loadIndex(sessionId);
  const byFile: Record<string, number> = {};
  for (const c of loaded.idx.chunks) byFile[c.fileId] = (byFile[c.fileId] || 0) + 1;
  return { chunks: loaded.idx.chunks.length, byFile, embedModel: loaded.idx.embedModel, dims: loaded.idx.dims };
}

// ----------------------------------------------------------------------------
// Search
// ----------------------------------------------------------------------------

export interface SearchOptions {
  k?: number;
  /** Hard cap on total tokens of returned chunk text. */
  tokenBudget?: number;
  roles?: SourceRole[];
  /** Prefer spreading results across files (round-robin re-rank). */
  diversify?: boolean;
}

export async function search(sessionId: string, query: string, opts: SearchOptions = {}): Promise<RetrievedChunk[]> {
  const loaded = await loadIndex(sessionId);
  const { idx } = loaded;
  if (idx.chunks.length === 0) return [];
  const k = opts.k ?? 6;
  const budget = opts.tokenBudget ?? 1200;

  const candidates = idx.chunks.map((_, i) => i).filter((i) => !opts.roles || opts.roles.includes(idx.chunks[i].sourceRole));
  if (candidates.length === 0) return [];

  // Lexical ranking
  const bm = loaded.bm25.score(query);
  const lexRank = [...candidates].sort((a, b) => bm[b] - bm[a]);

  // Dense ranking (if we have vectors)
  let denseRank: number[] = [];
  const embed = await getEmbedder();
  if (embed && loaded.vecs.some(Boolean)) {
    const [q] = await embed([query]);
    const cos = (i: number) => {
      const v = loaded.vecs[i];
      if (!v) return -1;
      let s = 0;
      for (let d = 0; d < v.length; d++) s += v[d] * q[d];
      return s;
    };
    denseRank = [...candidates].sort((a, b) => cos(b) - cos(a));
  }

  // Reciprocal rank fusion
  const fused = new Map<number, number>();
  const add = (rank: number[], w: number) => rank.forEach((i, r) => fused.set(i, (fused.get(i) || 0) + w / (60 + r)));
  add(lexRank, denseRank.length ? 0.4 : 1);
  if (denseRank.length) add(denseRank, 0.6);
  // Drop chunks with zero lexical AND no dense signal (pure noise)
  let ordered = [...fused.entries()]
    .filter(([i]) => bm[i] > 0 || denseRank.length > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([i, s]) => ({ i, s }));

  if (opts.diversify !== false) {
    // Interleave by file so one long PDF doesn't crowd out the CSV of participant statements.
    const byFile = new Map<string, { i: number; s: number }[]>();
    for (const o of ordered) {
      const f = idx.chunks[o.i].fileId;
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f)!.push(o);
    }
    const queues = [...byFile.values()];
    const mixed: { i: number; s: number }[] = [];
    let any = true;
    while (any && mixed.length < k * 3) {
      any = false;
      for (const q of queues) {
        const n = q.shift();
        if (n) {
          mixed.push(n);
          any = true;
        }
      }
    }
    ordered = mixed;
  }

  const out: RetrievedChunk[] = [];
  let used = 0;
  for (const o of ordered) {
    if (out.length >= k) break;
    const c = idx.chunks[o.i];
    const t = estimateTokens(c.text);
    if (used + t > budget && out.length > 0) continue;
    out.push({ ...c, score: o.s, rank: out.length + 1 });
    used += t;
  }
  return out;
}

/** All chunk texts for the anti-copy checker (local only; never sent anywhere). */
export async function overlapCorpus(sessionId: string, roles: SourceRole[] = ['prior_evidence', 'research']): Promise<string[]> {
  const loaded = await loadIndex(sessionId);
  return loaded.idx.chunks.filter((c) => roles.includes(c.sourceRole)).map((c) => c.text);
}

/**
 * Distinctive spans that synthetic participants must not reuse: quoted passages, proper-noun
 * phrases, and named characters. Computed locally; a short list is passed to the model as
 * "do not reuse", the full list feeds the local overlap check.
 */
export async function distinctiveSpans(sessionId: string, limit = 40): Promise<string[]> {
  const texts = await overlapCorpus(sessionId);
  const counts = new Map<string, number>();
  const bump = (s: string) => counts.set(s, (counts.get(s) || 0) + 1);
  for (const t of texts) {
    for (const m of t.matchAll(/["“]([^"”]{20,200})["”]/g)) bump(m[1].trim());
    for (const m of t.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g)) {
      const s = m[1];
      if (!/^(The|And|But|For|With|Section|Part|Question|Moderator|Participant)\b/.test(s)) bump(s);
    }
  }
  // Rare proper nouns / unique quotes are the distinctive ones; very common ones are just domain vocabulary.
  return [...counts.entries()]
    .filter(([s, n]) => n <= 3 || s.length > 40)
    .sort((a, b) => b[0].length - a[0].length)
    .slice(0, limit)
    .map(([s]) => s);
}

// ----------------------------------------------------------------------------
// Redaction hook — applied to every chunk before it crosses to an LLM provider.
// ----------------------------------------------------------------------------

const PII_PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/https?:\/\/\S+/gi, '[url]'],
  [/\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]'],
  [/\b[Nn]\d{8}\b/g, '[student-id]'], // NYU-style N-numbers
  [/\b\d{9}\b/g, '[id-number]'],
  [/\b(?:participant|respondent|interviewee)\s*#?\s*\d{1,4}\b/gi, 'a participant'],
  [/\b[pP]\d{1,4}\b/g, 'a participant'],
  [/\b(?:[A-Z]\.\s?){1,2}[A-Z][a-z]+\b/g, '[name]'], // initials + surname
];

export function redactText(text: string, extraNames: string[] = []): string {
  let out = text;
  for (const [re, rep] of PII_PATTERNS) out = out.replace(re, rep);
  for (const n of extraNames) {
    if (n.trim().length < 3) continue;
    out = out.replace(new RegExp(`\\b${n.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '[name]');
  }
  return out;
}

/** Apply the configured policy. `none` returns an empty list: nothing leaves the server. */
export function applyPolicy(chunks: RetrievedChunk[], policy = externalDataPolicy()): RetrievedChunk[] {
  if (policy === 'none') return [];
  if (policy === 'raw') return chunks;
  const extra = (process.env.REDACT_NAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
  return chunks.map((c) => ({ ...c, text: redactText(c.text, extra), fileName: c.fileName.replace(/[^\w.-]/g, '_') }));
}

/** Format chunks for a prompt, with stable [E#] labels the model can cite. */
export function formatEvidence(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '(no evidence excerpts provided for this section)';
  return chunks.map((c, i) => `[E${i + 1}] (${c.fileName}, ${c.locator}, ${c.sourceRole}) ${c.text}`).join('\n\n');
}

/** Local audit trail of what crossed the boundary (never includes the text itself). */
export function auditOutbound(taskName: string, chunks: RetrievedChunk[], policy: ExternalDataPolicy) {
  const tokens = chunks.reduce((a, c) => a + estimateTokens(c.text), 0);
  console.log(
    `[outbound] task=${taskName} policy=${policy} chunks=${chunks.length} tokens≈${tokens} ids=${chunks.map((c) => c.id).join(',') || '-'}`
  );
}
