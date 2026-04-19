import type { Context, Next } from 'hono';
import { z } from 'zod';
import { AppError } from './error';

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      const parsed = schema.parse(body);
      c.set('validatedBody', parsed);
      await next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AppError(
          JSON.stringify(error.issues),
          400,
          'VALIDATION_ERROR'
        );
      }
      throw error;
    }
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return async (c: Context, next: Next) => {
    try {
      const query = c.req.query();
      const parsed = schema.parse(query);
      c.set('validatedQuery', parsed);
      await next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AppError(
          JSON.stringify(error.issues),
          400,
          'VALIDATION_ERROR'
        );
      }
      throw error;
    }
  };
}
