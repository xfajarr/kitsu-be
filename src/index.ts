import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from './lib/logger';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { goalRoutes } from './routes/goals';
import { denRoutes } from './routes/dens';
import { portfolioRoutes } from './routes/portfolio';
import { transactionRoutes } from './routes/transactions';
import { questRoutes } from './routes/quests';
import { aiRoutes } from './routes/ai';
import { notFoundHandler, errorHandler } from './middleware/error';

function isAllowedOrigin(origin: string) {
  if (
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
  ) {
    return true;
  }
  const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim());
  return configuredOrigins.includes(origin);
}

const app = new Hono();

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin') || '';
  if (isAllowedOrigin(origin)) {
    c.res.headers.set('Access-Control-Allow-Origin', origin);
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    c.res.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  await next();
});

app.use('*', cors({
  origin: (origin) => isAllowedOrigin(origin) ? origin : null,
}));

app.route('/', healthRoutes);
app.route('/auth', authRoutes);
app.route('/users', userRoutes);
app.route('/goals', goalRoutes);
app.route('/dens', denRoutes);
app.route('/portfolio', portfolioRoutes);
app.route('/transactions', transactionRoutes);
app.route('/quests', questRoutes);
app.route('/ai', aiRoutes);

app.notFound(notFoundHandler);
app.onError(errorHandler);

const port = parseInt(process.env.PORT || '3001');

// Export for Vercel serverless (default export = fetch handler)
export default {
  fetch: app.fetch,
  port,
};

export const fetch = app.fetch;

// Start Bun server if running directly (not in serverless)
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  Bun.serve({
    fetch: app.fetch,
    port,
  });
  logger.info('SERVER', `🦊 Kitsu DeFi API starting on port ${port}`);
  logger.info('SERVER', `📚 API Documentation: http://localhost:${port}/docs`);
}
