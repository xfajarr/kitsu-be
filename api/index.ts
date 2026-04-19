import { handle } from 'hono/vercel';
import app from '../src/app';

export const runtime = 'nodejs';

export default handle(app);
