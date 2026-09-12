/**
 * Downloads the embedding model into ./models at build time so the deployed function never
 * fetches weights at runtime (faster cold starts, no dependency on the Hugging Face CDN in prod).
 * Skips silently if the files already exist. Safe to run repeatedly.
 */
import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';
import path from 'node:path';

const model = process.env.EMBED_MODEL || 'Xenova/bge-small-en-v1.5';
const dir = process.env.MODELS_DIR || path.resolve('models');
env.cacheDir = dir;
env.allowLocalModels = true;
env.allowRemoteModels = true;

const already = fs.existsSync(path.join(dir, model, 'onnx'));
if (already) {
  console.log(`[download-model] ${model} already present in ${dir}`);
  process.exit(0);
}
if ((process.env.EMBEDDINGS_PROVIDER || 'local') === 'none') {
  console.log('[download-model] EMBEDDINGS_PROVIDER=none, skipping');
  process.exit(0);
}
console.log(`[download-model] fetching ${model} → ${dir}`);
const t0 = Date.now();
const p = await pipeline('feature-extraction', model, { dtype: 'q8' });
await p(['warm-up'], { pooling: 'cls', normalize: true });
console.log(`[download-model] done in ${Date.now() - t0}ms`);
