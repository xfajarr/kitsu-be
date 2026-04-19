import app from './app';
import { logger } from './lib/logger';

const port = parseInt(process.env.PORT || '3001');

export default {
  port,
  fetch: app.fetch,
};

logger.info('SERVER', `🦊 Kitsu DeFi API starting on port ${port}`);
logger.info('SERVER', `📚 API Documentation: http://localhost:${port}/docs`);
