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
