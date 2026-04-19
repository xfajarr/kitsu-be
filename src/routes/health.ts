import { Hono } from 'hono';
import { client } from '../db';
import { log } from '../lib/logger';

export const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  const startTime = Date.now();
  let dbStatus = 'disconnected';
  
  try {
    await client.unsafe('SELECT 1');
    dbStatus = 'connected';
  } catch (error) {
    log.error('HEALTH', 'Database connection failed', error);
    dbStatus = 'error';
  }
  
  const responseTime = Date.now() - startTime;
  
  return c.json({
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: {
        status: dbStatus,
        responseTime: `${responseTime}ms`,
      },
    },
  });
});
