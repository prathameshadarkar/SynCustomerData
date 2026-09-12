/**
 * server/llm.ts — the ONLY place in the codebase that knows about LLM providers.
 *
 * Every provider speaks the OpenAI chat-completions dialect, so switching is an env var:
 *   LLM_PROVIDERS=cerebras,groq,cloudflare        (tried in order, falls through on 429/5xx)
 *   GENERATION_MODEL=gpt-oss-120b                 (logical name; mapped per provider below)
 *   UTILITY_MODEL=gpt-oss-20b
 *
 * A `mock` provider is included so the whole pipeline can be exercised with no API keys
 * and no data leaving the server (used together with EXTERNAL_DATA_POLICY=none).
 */

export type Tier = 'generation' | 'utility';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tier: Tier;
  /** JSON schema the response must satisfy. When set, the adapter asks for structured output and validates. */
  jsonSchema?: Record<string, any>;
  schemaName?: string;
  maxTokens?: number;
  temperature?: number;
  taskName?: string;
  onWait?: (ms: number, reason: string) => void;
  onFallback?: (from: string, to: string, reason: string) => void;
}

export interface ChatResult {
  text: string;
  json?: any;
  provider: string;
  model: string;
  requestedModel: string;
  fallbackUsed: boolean;
  retryCount: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

// ----------------------------------------------------------------------------
// Provider definitions
// ----------------------------------------------------------------------------

interface ProviderDef {
  name: string;
  baseUrl: () => string;
  apiKey: () => string | undefined;
  /** Map logical model names to the provider's identifiers. */
  models: Record<string, string>;
  /** Whether provider supports response_format: json_schema. */
  supportsJsonSchema: boolean;
  /** Minimum ms between requests (soft pacing; real limits come from 429 headers). */
  minSpacingMs: number;
  /** Free-tier tokens-per-minute ceiling (prompt + max_tokens are both counted by Groq/Cerebras). */
  tpmLimit: number;
  /** Cap on max_tokens per request so one call cannot eat the whole per-minute budget. */
  maxOutputTokens?: number;
  /** Extra body fields (e.g. reasoning effort for gpt-oss). */
  extraBody?: (model: string) => Record<string, any>;
}

const CF_ACCOUNT = () => process.env.CF_ACCOUNT_ID || '';

const PROVIDERS: Record<string, ProviderDef> = {
  cerebras: {
    name: 'cerebras',
    baseUrl: () => process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1',
    apiKey: () => process.env.CEREBRAS_API_KEY,
    models: {
      'gpt-oss-120b': 'gpt-oss-120b',
      'gpt-oss-20b': 'gpt-oss-120b', // Cerebras free tier does not list 20b; use 120b
    },
    supportsJsonSchema: true,
    minSpacingMs: 1200,
    tpmLimit: 30000,
    maxOutputTokens: 2000,
    extraBody: () => ({ reasoning_effort: 'low' }),
  },
  groq: {
    name: 'groq',
    baseUrl: () => process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    apiKey: () => process.env.GROQ_API_KEY,
    models: {
      'gpt-oss-120b': 'openai/gpt-oss-120b',
      'gpt-oss-20b': 'openai/gpt-oss-20b',
    },
    supportsJsonSchema: true,
    minSpacingMs: 2000,
    tpmLimit: 8000,
    maxOutputTokens: 1300,
    extraBody: () => ({ reasoning_effort: 'low' }),
  },
  cloudflare: {
    name: 'cloudflare',
    baseUrl: () =>
      process.env.CF_BASE_URL || `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT()}/ai/v1`,
    apiKey: () => process.env.CF_API_TOKEN,
    models: {
      'gpt-oss-120b': '@cf/openai/gpt-oss-120b',
      'gpt-oss-20b': '@cf/openai/gpt-oss-20b',
    },
    supportsJsonSchema: false, // best-effort JSON via prompt + local validation/repair
    minSpacingMs: 500,
    tpmLimit: Infinity,
    maxOutputTokens: 2000,
  },
  /** Any other OpenAI-compatible endpoint (e.g. a university-hosted vLLM, or a paid vendor later). */
  openai_compatible: {
    name: 'openai_compatible',
    baseUrl: () => process.env.OPENAI_COMPAT_BASE_URL || '',
    apiKey: () => process.env.OPENAI_COMPAT_API_KEY,
    models: {},
    supportsJsonSchema: (process.env.OPENAI_COMPAT_JSON_SCHEMA || 'true') === 'true',
    minSpacingMs: 0,
    tpmLimit: Number(process.env.OPENAI_COMPAT_TPM || Infinity),
  },
  mock: {
    name: 'mock',
    baseUrl: () => 'mock://',
    apiKey: () => 'mock',
    models: { 'gpt-oss-120b': 'mock-120b', 'gpt-oss-20b': 'mock-20b' },
    supportsJsonSchema: true,
    minSpacingMs: 0,
    tpmLimit: Infinity,
  },
};

export function configuredProviders(): string[] {
  const raw = process.env.LLM_PROVIDERS || 'cerebras,groq,cloudflare';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && PROVIDERS[s]);
}

/** Accept provider-flavoured names in env (openai/gpt-oss-120b, @cf/openai/gpt-oss-120b) and reduce to the logical id. */
function normalizeLogical(name: string): string {
  return name.trim().replace(/^@cf\//, '').replace(/^openai\//, '');
}

export function logicalModel(tier: Tier): string {
  return normalizeLogical(
    tier === 'generation' ? process.env.GENERATION_MODEL || 'gpt-oss-120b' : process.env.UTILITY_MODEL || 'gpt-oss-20b'
  );
}

/** Smallest per-minute token budget among the usable providers — generation trims prompts to fit it. */
export function tightestTpm(): number {
  const avail = availableProviders();
  if (avail.length === 0) return 8000;
  return Math.min(...avail.map((n) => PROVIDERS[n].tpmLimit));
}

/** Largest max_tokens every usable provider can accept. */
export function outputTokenCap(): number {
  const avail = availableProviders();
  if (avail.length === 0) return 1300;
  return Math.min(...avail.map((n) => PROVIDERS[n].maxOutputTokens ?? 4000));
}

function resolveModel(p: ProviderDef, logical: string): string {
  if (p.name === 'openai_compatible') return process.env.OPENAI_COMPAT_MODEL || logical;
  return p.models[logical] || logical;
}

/** Providers that are actually usable right now (have credentials). */
export function availableProviders(): string[] {
  return configuredProviders().filter((n) => {
    const p = PROVIDERS[n];
    if (n === 'mock') return true;
    if (n === 'cloudflare') return Boolean(p.apiKey() && CF_ACCOUNT());
    if (n === 'openai_compatible') return Boolean(p.baseUrl());
    return Boolean(p.apiKey());
  });
}

// ----------------------------------------------------------------------------
// Pacing + retry helpers
// ----------------------------------------------------------------------------

const lastCall: Record<string, number> = {};
/** Remaining tokens in the current minute per provider, learned from x-ratelimit-* headers. */
const tokenBudget: Record<string, { remaining: number; resetAt: number }> = {};
let rrCounter = 0;

function parseResetMs(v: string | null): number {
  if (!v) return 60000;
  const m = v.match(/(?:(\d+)m)?(\d+(?:\.\d+)?)s/);
  if (m) return (Number(m[1] || 0) * 60 + parseFloat(m[2])) * 1000;
  const n = parseFloat(v);
  return isNaN(n) ? 60000 : n < 1000 ? n * 1000 : n;
}

function recordRateHeaders(provider: string, res: Response) {
  const rem = res.headers.get('x-ratelimit-remaining-tokens');
  if (rem === null) return;
  const remaining = Number(rem);
  if (isNaN(remaining)) return;
  tokenBudget[provider] = { remaining, resetAt: Date.now() + parseResetMs(res.headers.get('x-ratelimit-reset-tokens')) };
}

function hasRoomFor(provider: string, needTokens: number): boolean {
  const b = tokenBudget[provider];
  if (!b || b.resetAt <= Date.now()) return true; // unknown or window reset → assume ok
  return b.remaining >= needTokens;
}

const estimateReqTokens = (req: ChatRequest) =>
  Math.ceil(req.messages.reduce((a, m) => a + m.content.length, 0) / 4) + (req.maxTokens ?? 1500) + 200;
/** Providers that just exhausted their retries are skipped for a short cooldown (ms timestamp until which to skip). */
const cooldownUntil: Record<string, number> = {};
const COOLDOWN_MS = Number(process.env.LLM_PROVIDER_COOLDOWN_MS || 60000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response | null, bodyText: string): number | null {
  if (res) {
    const ra = res.headers.get('retry-after');
    if (ra) {
      const s = parseFloat(ra);
      if (!isNaN(s)) return Math.ceil(s * 1000);
    }
    // Groq/Cerebras style reset headers, e.g. "2.5s", "1m2s"
    for (const h of ['x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests']) {
      const v = res.headers.get(h);
      if (v) {
        const m = v.match(/(?:(\d+)m)?(\d+(?:\.\d+)?)s/);
        if (m) return (Number(m[1] || 0) * 60 + parseFloat(m[2])) * 1000;
        const n = parseFloat(v);
        if (!isNaN(n)) return n < 1000 ? n * 1000 : n;
      }
    }
  }
  const m = bodyText.match(/try again in\s+(\d+(?:\.\d+)?)\s*(ms|s)/i);
  if (m) return m[2] === 'ms' ? parseFloat(m[1]) : parseFloat(m[1]) * 1000;
  return null;
}

// ----------------------------------------------------------------------------
// JSON helpers
// ----------------------------------------------------------------------------

export function extractJson(text: string): any | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {}
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(t.slice(first, last + 1));
    } catch {}
  }
  return null;
}

/** Minimal structural validator: required keys, types, enums, nested objects/arrays. */
export function validateAgainstSchema(value: any, schema: any, path = '$'): string[] {
  const errs: string[] = [];
  if (!schema || typeof schema !== 'object') return errs;
  const type = schema.type;
  if (type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return [`${path}: expected object`];
    }
    for (const req of schema.required || []) {
      if (!(req in value)) errs.push(`${path}.${req}: missing`);
    }
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in value) errs.push(...validateAgainstSchema(value[k], sub, `${path}.${k}`));
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    value.forEach((v, i) => errs.push(...validateAgainstSchema(v, schema.items, `${path}[${i}]`)));
  } else if (type === 'string') {
    if (typeof value !== 'string') errs.push(`${path}: expected string`);
    else if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: not in enum`);
  } else if (type === 'integer' || type === 'number') {
    if (typeof value !== 'number' || (type === 'integer' && !Number.isInteger(value))) {
      errs.push(`${path}: expected ${type}`);
    }
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') errs.push(`${path}: expected boolean`);
  }
  return errs;
}

/** Coerce obvious near-misses (numeric strings, enum casing) before failing. */
export function coerceToSchema(value: any, schema: any): any {
  if (!schema || value === undefined || value === null) return value;
  if (schema.type === 'object' && typeof value === 'object' && !Array.isArray(value)) {
    const out: any = { ...value };
    for (const [k, sub] of Object.entries<any>(schema.properties || {})) {
      if (k in out) out[k] = coerceToSchema(out[k], sub);
    }
    return out;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return value;
    return value.map((v) => coerceToSchema(v, schema.items));
  }
  if (schema.type === 'integer' && typeof value === 'string' && /^\s*-?\d+\s*$/.test(value)) {
    return parseInt(value, 10);
  }
  if (schema.type === 'integer' && typeof value === 'number') return Math.round(value);
  if (schema.type === 'number' && typeof value === 'string' && !isNaN(Number(value))) return Number(value);
  if (schema.type === 'string' && schema.enum && typeof value === 'string') {
    const hit = schema.enum.find((e: string) => e.toLowerCase() === value.trim().toLowerCase());
    if (hit) return hit;
  }
  if (schema.type === 'string' && typeof value === 'number') return String(value);
  return value;
}

/** Strict-mode schemas (Groq/OpenAI) require additionalProperties:false and all props required. */
function toStrictSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.type === 'object') {
    const props = schema.properties || {};
    return {
      ...schema,
      additionalProperties: false,
      required: Object.keys(props),
      properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, toStrictSchema(v)])),
    };
  }
  if (schema.type === 'array') return { ...schema, items: toStrictSchema(schema.items) };
  return schema;
}

// ----------------------------------------------------------------------------
// Core call
// ----------------------------------------------------------------------------

class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
    public waitMs: number | null
  ) {
    super(message);
  }
}

async function callProviderOnce(p: ProviderDef, model: string, req: ChatRequest, forceJsonMode: boolean): Promise<{ text: string; usage?: any }> {
  if (p.name === 'mock') return mockCompletion(req);

  const body: Record<string, any> = {
    model,
    messages: req.messages,
    temperature: req.temperature ?? (req.tier === 'generation' ? 0.9 : 0.3),
    max_tokens: Math.min(req.maxTokens ?? (req.tier === 'generation' ? 2000 : 1200), p.maxOutputTokens ?? 4000),
    stream: false,
    ...(p.extraBody ? p.extraBody(model) : {}),
  };

  if (req.jsonSchema) {
    if (p.supportsJsonSchema && !forceJsonMode) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: req.schemaName || 'response', strict: true, schema: toStrictSchema(req.jsonSchema) },
      };
    } else {
      body.response_format = { type: 'json_object' };
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.LLM_TIMEOUT_MS || 90000));
  let res: Response;
  try {
    res = await fetch(`${p.baseUrl().replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${p.apiKey()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    throw new ProviderError(`network error: ${e?.message || e}`, 0, true, 3000);
  }
  clearTimeout(timeout);

  recordRateHeaders(p.name, res);
  const text = await res.text();
  if (!res.ok) {
    // Groq (and OpenAI-style servers) reject output that fails the strict schema with a 400 that still
    // carries the model's raw text in error.failed_generation. Recover it and let our local
    // validate-and-repair path deal with it instead of treating the call as dead.
    if (res.status === 400 && req.jsonSchema) {
      try {
        const body = JSON.parse(text);
        const failed = body?.error?.failed_generation;
        if (typeof failed === 'string' && failed.trim()) {
          console.warn(`[LLM] ${p.name} rejected its own JSON (${body?.error?.code || 'json_validate_failed'}); recovering failed_generation locally`);
          return { text: failed, usage: body?.usage };
        }
      } catch {}
    }
    const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
    // 400 about the schema/JSON mode → caller retries in plain JSON mode
    const schemaProblem = res.status === 400 && /response_format|json_schema|schema|validate JSON|generate JSON|json_validate_failed/i.test(text);
    const err = new ProviderError(`${p.name} ${res.status}: ${text.slice(0, 300)}`, res.status, retryable || schemaProblem, retryAfterMs(res, text));
    (err as any).schemaProblem = schemaProblem;
    throw err;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderError(`${p.name}: non-JSON response envelope`, 502, true, 2000);
  }
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderError(`${p.name}: empty completion`, 502, true, 2000);
  }
  return { text: content, usage: parsed.usage };
}

/**
 * chat(): try providers in order. 429/5xx → wait (bounded) and retry same provider a couple of
 * times, then fall through to the next provider. Non-retryable errors propagate immediately.
 */
export async function chat(req: ChatRequest): Promise<ChatResult> {
  const providers = availableProviders();
  if (providers.length === 0) {
    throw new Error(
      'No LLM provider is configured. Set at least one of CEREBRAS_API_KEY, GROQ_API_KEY, CF_API_TOKEN(+CF_ACCOUNT_ID), or LLM_PROVIDERS=mock for offline testing.'
    );
  }
  const logical = logicalModel(req.tier);
  let retries = 0;
  let lastErr: any = null;

  // Order: failover keeps the configured order; round_robin (default when >1 provider) rotates the
  // starting provider per call so per-minute budgets add up instead of one provider taking every hit.
  const routing = (process.env.LLM_ROUTING || 'round_robin').toLowerCase();
  const start = routing === 'failover' || providers.length < 2 ? 0 : rrCounter++ % providers.length;
  const ordered = [...providers.slice(start), ...providers.slice(0, start)];
  const need = estimateReqTokens(req);

  for (let pi = 0; pi < ordered.length; pi++) {
    const p = PROVIDERS[ordered[pi]];
    const model = resolveModel(p, logical);
    const coolingDown = (cooldownUntil[p.name] || 0) > Date.now();
    const othersUsable = ordered.some(
      (n, j) => j !== pi && (cooldownUntil[n] || 0) <= Date.now() && hasRoomFor(n, need)
    );
    if (coolingDown && othersUsable) {
      console.log(`[LLM] skipping ${p.name} (cooling down after recent failures)`);
      continue;
    }
    if (!hasRoomFor(p.name, need) && othersUsable) {
      console.log(`[LLM] skipping ${p.name} (only ${tokenBudget[p.name]?.remaining} tokens left this minute, need ≈${need})`);
      continue;
    }
    if (!hasRoomFor(p.name, need)) {
      // Nobody else can take it: wait for this provider's window to reset instead of burning a 429.
      const waitMs = Math.max(1000, Math.min(65000, (tokenBudget[p.name]?.resetAt || Date.now()) - Date.now() + 500));
      const reason = `${p.name}'s free-tier minute budget is used up; waiting ${Math.ceil(waitMs / 1000)}s for it to reset…`;
      console.log(`[LLM] ${reason}`);
      req.onWait?.(waitMs, reason);
      await sleep(waitMs);
    }
    const maxAttempts = 3;
    let forceJsonMode = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // soft pacing
      const since = Date.now() - (lastCall[p.name] || 0);
      if (since < p.minSpacingMs) await sleep(p.minSpacingMs - since);

      try {
        console.log(`[LLM] task=${req.taskName || '-'} provider=${p.name} model=${model} attempt=${attempt}`);
        const out = await callProviderOnce(p, model, req, forceJsonMode);
        lastCall[p.name] = Date.now();

        const result: ChatResult = {
          text: out.text,
          provider: p.name,
          model,
          requestedModel: logical,
          fallbackUsed: pi > 0,
          retryCount: retries,
          usage: out.usage,
        };

        if (req.jsonSchema) {
          let json = extractJson(out.text);
          if (json) json = coerceToSchema(json, req.jsonSchema);
          const errs = json ? validateAgainstSchema(json, req.jsonSchema) : ['no JSON object found'];
          if (errs.length > 0) {
            console.warn(`[LLM] schema validation failed (${errs.length}): ${errs.slice(0, 5).join('; ')}`);
            if (attempt < maxAttempts) {
              retries++;
              // Ask the same provider to repair its own output — cheap and usually works.
              req = {
                ...req,
                messages: [
                  ...req.messages,
                  { role: 'assistant', content: out.text.slice(0, 12000) },
                  {
                    role: 'user',
                    content: `Your previous answer did not match the required JSON schema. Problems: ${errs
                      .slice(0, 8)
                      .join('; ')}. Return ONLY a corrected JSON object that satisfies the schema. No commentary.`,
                  },
                ],
              };
              continue;
            }
            throw new Error(`Model output failed schema validation: ${errs.slice(0, 5).join('; ')}`);
          }
          result.json = json;
        }
        return result;
      } catch (e: any) {
        lastCall[p.name] = Date.now();
        lastErr = e;
        if (e instanceof ProviderError) {
          if ((e as any).schemaProblem && !forceJsonMode) {
            console.warn(`[LLM] ${p.name} rejected json_schema; retrying in json_object mode`);
            forceJsonMode = true;
            continue;
          }
          if (!e.retryable) throw e;
          retries++;
          if (attempt < maxAttempts) {
            const wait = (e as any).schemaProblem ? 800 : Math.min(e.waitMs ?? (attempt === 1 ? 4000 : 10000), 45000) + 500;
            const reason =
              e.status === 429
                ? `Free-tier rate limit on ${p.name}; retrying in ${Math.ceil(wait / 1000)}s…`
                : `${p.name} is busy; retrying in ${Math.ceil(wait / 1000)}s…`;
            console.warn(`[LLM] ${reason} (${e.message.slice(0, 120)})`);
            req.onWait?.(wait, reason);
            await sleep(wait);
            continue;
          }
          // exhausted this provider → cool it down and move to the next one
          cooldownUntil[p.name] = Date.now() + COOLDOWN_MS;
          const next = ordered[pi + 1];
          if (next) {
            const reason = `Switching from ${p.name} to ${next} after repeated ${e.status || 'network'} errors…`;
            console.warn(`[LLM] ${reason}`);
            req.onFallback?.(p.name, next, reason);
          }
          break;
        }
        // schema failure after max attempts or unknown error → try next provider once
        if (attempt >= maxAttempts) break;
        retries++;
      }
    }
  }

  throw new Error(
    `All configured LLM providers failed (${providers.join(' → ')}). Last error: ${lastErr?.message || lastErr}`
  );
}

// ----------------------------------------------------------------------------
// Mock provider: schema-driven canned output so the pipeline can run with zero keys.
// ----------------------------------------------------------------------------

function mockFill(schema: any, hint: string, depth = 0): any {
  if (!schema) return null;
  switch (schema.type) {
    case 'object': {
      const o: any = {};
      for (const [k, sub] of Object.entries<any>(schema.properties || {})) o[k] = mockFill(sub, k, depth + 1);
      return o;
    }
    case 'array': {
      const n = schema.minItems ?? 2;
      return Array.from({ length: n }, (_, i) => mockFill(schema.items, `${hint}_${i + 1}`, depth + 1));
    }
    case 'string':
      if (schema.enum) return schema.enum[0];
      if (/transcript/i.test(hint)) {
        return `Moderator: Could you walk me through that?\nParticipant: Sure — this is a mock answer generated without any external model. It follows the section's questions and stays in character.\nModerator: What would you change?\nParticipant: Mostly the wait times; I plan around them now.`;
      }
      if (/name/i.test(hint)) return 'Mock Participant';
      return `[mock ${hint}]`;
    case 'integer':
      return /age/i.test(hint) ? 20 : 3;
    case 'number':
      return 3;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

async function mockCompletion(req: ChatRequest): Promise<{ text: string }> {
  await sleep(150);
  if (req.jsonSchema) return { text: JSON.stringify(mockFill(req.jsonSchema, req.schemaName || 'root')) };
  const last = req.messages[req.messages.length - 1]?.content || '';
  if (/extract/i.test(last) && /discussion guide/i.test(last)) {
    return { text: 'Section 1: Warm-up\n1. Mock extracted question one?\n2. Mock extracted question two?' };
  }
  return { text: 'Mock completion (no external provider configured).' };
}
