import type { Context, Next } from 'hono';
import { jwtService } from '../lib/jwt';
import { log } from '../lib/logger';
import { AppError } from './error';

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Missing or invalid authorization header', 401, 'UNAUTHORIZED');
  }

  const token = authHeader.slice(7);
  const payload = await jwtService.verifyToken(token);
  
  if (!payload) {
    throw new AppError('Invalid or expired token', 401, 'INVALID_TOKEN');
  }

  c.set('userId', payload.userId);
  c.set('walletAddr', payload.walletAddr);
  
  await next();
}

// Extend Hono's context type
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    walletAddr: string;
    validatedBody: unknown;
    validatedQuery: unknown;
  }
}
