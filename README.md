# Synthetic Discussion-Guide Transcript Generator

Generates evidence-informed synthetic undergraduate research participants and full moderator/participant
transcripts, grounded in your uploaded research material (PDF, CSV, XLSX, JSON, TXT). Runs for **$0** on
Vercel's Hobby plan using free-tier open-weight model providers. No Google/Gemini dependency.

```
Browser (React/Vite)  ──►  Express (server/app.ts; api/index.ts is the Vercel entry, start.ts the local one)
                              ├─ server/storage.ts    raw files + session index  → private Vercel Blob
                              ├─ server/retrieval.ts  parse → chunk → embed (bge-small, in-process) + BM25 → hybrid search → redact()
                              ├─ server/generation.ts persona sampling → 1 persona call + 1 call per guide section → local anti-copy check
                              └─ server/llm.ts        ONE adapter: Cerebras → Groq → Cloudflare Workers AI (gpt-oss-120b), OpenAI-compatible
```

## How generation works

1. **Ingest.** Each upload is stored privately, parsed on the server (`unpdf` for PDFs, `xlsx` for
   spreadsheets, native JSON/TXT), split into chunks (one row/record per chunk for tabular data), embedded
   with `bge-small-en-v1.5` running inside the function, and written to a per-session index.
2. **Persona.** For participant *i* the server samples a persona spec (year, school, major, familiarity,
   usage intensity, attitude, behaviour, living situation, speaking style) deterministically so participants
   differ in substance, then asks the model to write a name and background for it.
3. **Sections.** For every discussion-guide section the server retrieves the top ~6 chunks for *that section*
   (hybrid dense + BM25, ≤ ~1,200 tokens), applies the data-handling policy, and asks the model for the
   dialogue plus per-question summaries/sentiment/rating. Earlier sections are summarised for continuity.
4. **Safeguards.** Retrieved "distinctive spans" (quotes, named characters, proper nouns) are passed as
   "do not reuse", and a fully local 7-gram + distinctive-span check flags any verbatim overlap. No source text
   is sent to any model for that check.
5. **Output.** Same `participant` shape as before → result cards, TXT and CSV export unchanged.

Model: **gpt-oss-120b** for personas/dialogue, **gpt-oss-20b** for utility tasks — the same weights on all three
providers, so a fallback never changes the "voice".

## Data handling

* Raw uploaded files never leave the app's private storage.
* Only the retrieved excerpts needed for the current section are sent to the LLM provider, and every outbound
  request is logged locally (`[outbound] … chunks=6 tokens≈749 ids=…`) without the text itself.
* `EXTERNAL_DATA_POLICY` controls what crosses the boundary: `redacted` (default, PII scrubbed), `raw`,
  or `none` (nothing — pipeline still runs, ungrounded). Extend `redactText()` in `server/retrieval.ts`
  for study-specific name lists (`REDACT_NAMES`).
* Provider choice is one env var; nothing outside `server/llm.ts` knows a provider exists.

Layout: `api/index.js` (Vercel function entry, loads the esbuild bundle `api/_bundle/app.cjs` produced by `npm run build`) → `server/app.ts` (Express routes) → `server/*.ts` modules. `start.ts` runs the same app locally or on a VM. `vercel.json` rewrites `/api/*` to the function and everything else to the SPA.

---

## Deploy to Vercel (step by step)

### 0. Get free API keys (no card needed for any of these)
* **Cerebras** — https://cloud.cerebras.ai → *API Keys* → create key.
* **Groq** — https://console.groq.com → *API Keys* → create key.
* **Cloudflare (optional third fallback)** — https://dash.cloudflare.com → copy your *Account ID*;
  then *My Profile → API Tokens → Create Token → "Workers AI" template*.

### 1. Put the code on GitHub
Create a new repository and push this folder (`git init && git add . && git commit -m "Vercel + free-tier LLM migration" && git push`).
Do **not** commit `.env`, `public/`, `models/` or `.data/` — they are already in `.gitignore`.

### 2. Create the Vercel project
1. https://vercel.com/new → *Import* your repository (sign in with GitHub; the Hobby plan is free, no card).
2. Framework preset: leave **Other**. Build command and output are taken from `vercel.json`
   (`npm run build` → Vite writes to `public/`, then the embedding model is downloaded into `models/`).
3. Before clicking Deploy, open **Environment Variables** and add (Production + Preview):

   | Name | Value |
   |---|---|
   | `LLM_PROVIDERS` | `cerebras,groq,cloudflare` (drop any you don't have a key for) |
   | `CEREBRAS_API_KEY` | your key |
   | `GROQ_API_KEY` | your key |
   | `CF_ACCOUNT_ID` / `CF_API_TOKEN` | optional |
   | `EXTERNAL_DATA_POLICY` | `redacted` (switch to `raw` only after approval) |
   | `APP_PASSCODE` | any phrase — protects your free quota on the public URL |
   | `NODEJS_HELPERS` | `0` — turns off Vercel's request pre-parsing so Express handles bodies and uploads itself |

4. Click **Deploy**. First build takes ~3–5 minutes (it installs the ONNX runtime and downloads the 34 MB model).

### 3. Add private Blob storage (persistent sessions, uploads > 4 MB)
1. Project → **Storage** tab → *Create Database* → **Blob** → name it (e.g. `transcripts-store`) → *Connect to project*.
2. This injects `BLOB_READ_WRITE_TOKEN` automatically. **Redeploy** (Deployments → ⋯ → Redeploy) so the
   function picks it up. `/api/health` should now report `"storage": "blob"` and `"clientUploads": true`.
   Without Blob the app still works, but state lives in the function's `/tmp` and is lost between cold starts.

### 4. Verify
* If the UI shows "The server returned HTTP 500 with a non-JSON response…", the function crashed: open
  *Deployments → (latest) → Functions* and read the stack trace; also open `/api/health` directly in a tab.

* Open `https://<your-project>.vercel.app/api/health` — check `providers.available` lists your providers.
* Open the site, enter the passcode, click **Quick Test: Load Sample Dataset & Guide**, then **Generate Transcripts**
  with 2–3 participants. Watch *Deployments → Functions → Logs* for `[LLM]` and `[outbound]` lines.

### 5. Free-tier budget (for reference)
* **Groq alone is tight**: 8k tokens/min ≈ one participant per minute with waits. Adding a free Cerebras key
  (30k tokens/min) makes runs 3–4× faster; with several providers the adapter round-robins calls across them.
* Vercel Hobby: 300 s per request (each participant is its own request), 2 GB RAM, 4 CPU-hours/month,
  Blob 5 GB + 10k writes/month. Hobby **never bills** — it pauses if a limit is hit.
* Cerebras free: ~30k tokens/min, 1M tokens/day (≈ 80+ participants/day). Groq: 8k tokens/min, 200k/day.
  Cloudflare: 10k neurons/day (≈ 5–8 three-participant runs).
* Do **not** create extra Vercel accounts to stack quotas — it violates their fair-use terms. Reduce usage
  (fewer participants, "Standard" depth) or add a second provider key instead.

## Run locally
```bash
cp .env.example .env         # fill in at least one provider key, or set LLM_PROVIDERS=mock
npm install
npm run dev                  # http://localhost:3000 (Vite HMR + API)
npm run lint                 # type-check
npm run test:smoke           # offline checks: redaction, anti-copy, parsing, schema coercion
```
Production on any Node host: `npm run build && npm start` (serves `public/` and the API on `$PORT`).

## Switching models or providers later
* Different free provider or a paid one: add it to `PROVIDERS` in `server/llm.ts` (≈15 lines) or point
  `LLM_PROVIDERS=openai_compatible` at any OpenAI-compatible URL.
* Different model name: `GENERATION_MODEL` / `UTILITY_MODEL`.
* Different embedding model: `EMBED_MODEL` (any transformers.js feature-extraction model); re-ingest files.
