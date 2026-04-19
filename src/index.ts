import app from './app';
import { logger } from './lib/logger';

const port = parseInt(process.env.PORT || '3001');

// Export for Vercel serverless (default export = fetch handler)
export default {
  fetch: app.fetch,
  port,
};

// Also named export
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
