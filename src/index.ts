import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
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

// CORS middleware
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

// Request logging middleware
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.request(c.req.method, c.req.path, c.res.status, duration);
});

// Serve OpenAPI spec
app.get('/openapi.yaml', serveStatic({ path: './openapi.yaml' }));

// Swagger UI documentation
app.get('/docs', swaggerUI({ url: '/openapi.yaml' }));

// API routes
app.route('/health', healthRoutes);
app.route('/auth', authRoutes);
app.route('/users', userRoutes);
app.route('/goals', goalRoutes);
app.route('/dens', denRoutes);
app.route('/portfolio', portfolioRoutes);
app.route('/transactions', transactionRoutes);
app.route('/quests', questRoutes);
app.route('/ai', aiRoutes);

// Root endpoint
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

// Error handling
app.notFound(notFoundHandler);
app.onError(errorHandler);

// Export for Bun
const port = parseInt(process.env.PORT || '3001');

export default {
  port,
  fetch: app.fetch,
};

logger.info('SERVER', `🦊 Kitsu DeFi API starting on port ${port}`);
logger.info('SERVER', `📚 API Documentation: http://localhost:${port}/docs`);
