import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR'
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFoundHandler(c: Context) {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
  }, 404);
}

export function errorHandler(err: Error, c: Context) {
  console.error('Error:', err);

  if (err instanceof AppError) {
    return c.json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    }, err.statusCode);
  }

  if (err instanceof HTTPException) {
    return c.json({
      success: false,
      error: {
        code: 'HTTP_EXCEPTION',
        message: err.message,
      },
    }, err.status);
  }

  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  }, 500);
}
