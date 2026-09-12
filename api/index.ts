/**
 * Vercel entrypoint. Every /api/* request is rewritten here (see vercel.json) and handled by the
 * Express app; static assets in public/ are served by Vercel's CDN. Nothing else lives in api/.
 */
import app from '../server/app';

export default app;
