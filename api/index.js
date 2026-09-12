// @ts-nocheck
/**
 * Vercel entrypoint. `npm run build` bundles the whole Express server (server/app.ts and everything it
 * imports) into api/_bundle/app.cjs with esbuild, so Vercel's per-file TypeScript transpiler never has to
 * resolve our extensionless ESM imports. Files/folders in api/ starting with "_" are not turned into functions.
 */
import bundle from './_bundle/app.cjs';

const app = bundle.default ?? bundle;
export default app;
