import { Hono } from 'hono';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { jwtService } from '../lib/jwt';
import { walletService } from '../lib/wallet';
import { log } from '../lib/logger';
import { Address } from '@ton/core';

export const authRoutes = new Hono();

const connectSchema = z.object({
  address: z.string().min(1),
  signature: z.string().optional(),
  timestamp: z.number().optional(),
});

function isLocalOrigin(origin: string | undefined) {
  if (!origin) {
    return false;
  }

  return origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
}

function allowLocalWalletBypass(origin: string | undefined) {
  const flag = process.env.ALLOW_LOCAL_WALLET_AUTH_BYPASS;
  const enabled = flag ? flag === 'true' : process.env.NODE_ENV !== 'production';
  return enabled && isLocalOrigin(origin);
}

function isAdminWallet(walletAddr: string) {
  const adminWallet = process.env.KITSU_ADMIN_WALLET?.trim();
  if (!adminWallet) {
    return false;
  }

  try {
    return Address.parse(walletAddr).toRawString() === Address.parse(adminWallet).toRawString();
  } catch {
    return walletAddr === adminWallet;
  }
}

// POST /auth/connect - Verify wallet signature and issue JWT
authRoutes.post('/connect', validateBody(connectSchema), async (c) => {
  const { address, signature, timestamp } = c.get('validatedBody') as z.infer<typeof connectSchema>;
  const origin = c.req.header('Origin');
  
  log.auth('Connect attempt', { address });
  
  // Verify wallet signature
  const shouldBypass = allowLocalWalletBypass(origin) && (!signature || !timestamp);
  const isValid = shouldBypass
    ? true
    : await walletService.verifySignature({ address, signature: signature || '', timestamp: timestamp || 0 });

  if (!isValid) {
    log.error('AUTH', 'Invalid signature', { address });
    return c.json({
      success: false,
      error: { code: 'INVALID_SIGNATURE', message: 'Wallet signature verification failed' },
    }, 401);
  }

  if (shouldBypass) {
    log.auth('Local wallet auth bypass enabled', { address, origin });
  }
  
  // Find or create user
  let user = await db.query.users.findFirst({
    where: eq(users.walletAddr, address),
  });
  
  if (!user) {
    log.auth('Creating new user', { address });
    const [newUser] = await db.insert(users).values({
      walletAddr: address,
      xp: 0,
      level: 1,
      streakDays: 0,
    }).returning();
    user = newUser;
  }
  
  // Generate JWT token
  const token = await jwtService.signToken({
    userId: user.id,
    walletAddr: user.walletAddr,
  });
  
  log.auth('User authenticated', { userId: user.id, address });
  
  return c.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        walletAddr: user.walletAddr,
        isAdmin: isAdminWallet(user.walletAddr),
        username: user.username,
        tonHandle: user.tonHandle,
        xp: user.xp,
        level: user.level,
        streakDays: user.streakDays,
        createdAt: user.createdAt,
      },
    },
  });
});

// GET /auth/me - Get current user
authRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' },
    }, 401);
  }
  
  const token = authHeader.slice(7);
  const payload = await jwtService.verifyToken(token);
  
  if (!payload) {
    return c.json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    }, 401);
  }
  
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.userId),
  });
  
  if (!user) {
    return c.json({
      success: false,
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    }, 404);
  }
  
  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        walletAddr: user.walletAddr,
        isAdmin: isAdminWallet(user.walletAddr),
        username: user.username,
        tonHandle: user.tonHandle,
        xp: user.xp,
        level: user.level,
        streakDays: user.streakDays,
        createdAt: user.createdAt,
      },
    },
  });
});
