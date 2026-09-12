/** Local / VM entrypoint: `npm run dev` or `npm start`. Not used on Vercel (see api/index.ts). */
import { start } from './server/app';

start();
