import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { swaggerUI } from '@hono/swagger-ui';
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

app.use('*', cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:3000',
    'http://localhost:3001',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.request(c.req.method, c.req.path, c.res.status, duration);
});

app.get('/openapi.yaml', async (c) => {
  try {
    const yaml = await readFile(new URL('../openapi.yaml', import.meta.url), 'utf8');
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

app.get('/docs', swaggerUI({ url: '/openapi.yaml' }));

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
