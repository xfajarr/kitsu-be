import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { notFoundHandler, errorHandler } from './middleware/error';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { goalRoutes } from './routes/goals';
import { denRoutes } from './routes/dens';
import { portfolioRoutes } from './routes/portfolio';
import { transactionRoutes } from './routes/transactions';
import { questRoutes } from './routes/quests';
import { aiRoutes } from './routes/ai';
import { logger } from './lib/logger';

const app = new Hono();

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
    .map((value) => value.trim())
    .filter(Boolean);

  return configuredOrigins.includes(origin);
}

app.use('*', cors({
  origin: (origin) => {
    if (!origin) {
      return '*';
    }

    return isAllowedOrigin(origin) ? origin : '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));

app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.request(c.req.method, c.req.path, c.res.status, duration);
});

app.get('/openapi.yaml', async (c) => {
  try {
    const yaml = await readFile(join(process.cwd(), 'openapi.yaml'), 'utf8');
    return c.text(yaml, 200, {
      'content-type': 'application/yaml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    });
  } catch (error) {
    logger.warn('OPENAPI', 'openapi.yaml could not be served', error);
    c.status(404);
    return c.json({
      success: false,
      error: {
        code: 'OPENAPI_NOT_FOUND',
        message: 'openapi.yaml is not available in this deployment',
      },
    });
  }
});

app.get('/docs', (c) => {
  return c.html(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kitsu API Docs</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 32px; max-width: 720px; margin: 0 auto; }
      code { background: #f4f4f5; padding: 2px 6px; border-radius: 6px; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1>Kitsu API Docs</h1>
    <p>OpenAPI spec tersedia di <a href="/openapi.yaml"><code>/openapi.yaml</code></a>.</p>
    <p>Gunakan spec itu di Swagger Editor/Postman kalau butuh UI interaktif.</p>
  </body>
</html>`);
});

app.route('/health', healthRoutes);
app.route('/auth', authRoutes);
app.route('/users', userRoutes);
app.route('/goals', goalRoutes);
app.route('/dens', denRoutes);
app.route('/portfolio', portfolioRoutes);
app.route('/transactions', transactionRoutes);
app.route('/quests', questRoutes);
app.route('/ai', aiRoutes);

app.get('/', (c) => {
  return c.json({
    name: 'Kitsu DeFi API',
    version: '1.0.0',
    description: 'Gamified DeFi savings app on TON blockchain',
    documentation: '/docs',
    openapi: '/openapi.yaml',
    endpoints: {
      health: 'GET /health',
      auth: ['POST /auth/connect', 'GET /auth/me'],
      users: ['GET /users/:id', 'PATCH /users/me', 'GET /users/leaderboard'],
      goals: ['GET /goals', 'POST /goals', 'PATCH /goals/:id', 'DELETE /goals/:id'],
      dens: ['GET /dens', 'GET /dens/mine', 'POST /dens', 'GET /dens/:id', 'POST /dens/:id/join', 'POST /dens/:id/leave'],
      portfolio: ['GET /portfolio', 'GET /portfolio/prices'],
      transactions: ['POST /transactions/deposit', 'POST /transactions/withdraw', 'POST /transactions/stake', 'POST /transactions/unstake', 'GET /transactions/history'],
      quests: ['GET /quests', 'POST /quests/:id/claim'],
      ai: ['POST /ai/chat'],
    },
  });
});

app.notFound(notFoundHandler);
app.onError(errorHandler);

export default app;
