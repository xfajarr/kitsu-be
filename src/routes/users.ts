import { Hono } from 'hono';
import { db } from '../db/index.js';
import { users, leaderboard } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { jwtService } from '../lib/jwt.js';
import { log } from '../lib/logger.js';

export const userRoutes = new Hono();

const updateProfileSchema = z.object({
  username: z.string().min(1).max(64).optional(),
  tonHandle: z.string().max(128).optional(),
});

// Helper to get current user from token
async function getCurrentUser(c: any) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.slice(7);
  const payload = await jwtService.verifyToken(token);
  if (!payload) return null;
  
  return db.query.users.findFirst({
    where: eq(users.id, payload.userId),
  });
}

// GET /users/:id - Get user profile
userRoutes.get('/:id', async (c) => {
  const { id } = c.req.param();
  
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
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

// PATCH /users/me - Update profile
userRoutes.patch('/me', validateBody(updateProfileSchema), async (c) => {
  const user = await getCurrentUser(c);
  
  if (!user) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const updates = c.get('validatedBody') as z.infer<typeof updateProfileSchema>;
  
  const [updatedUser] = await db.update(users)
    .set(updates)
    .where(eq(users.id, user.id))
    .returning();
  
  log.api('Profile updated', { userId: user.id });
  
  return c.json({
    success: true,
    data: {
      user: {
        id: updatedUser.id,
        walletAddr: updatedUser.walletAddr,
        username: updatedUser.username,
        tonHandle: updatedUser.tonHandle,
        xp: updatedUser.xp,
        level: updatedUser.level,
        streakDays: updatedUser.streakDays,
      },
    },
  });
});

// GET /users/leaderboard - Top users by XP
userRoutes.get('/leaderboard', async (c) => {
  const topUsers = await db.query.users.findMany({
    orderBy: [desc(users.xp)],
    limit: 100,
  });
  
  const leaderboardData = topUsers.map((user, index) => ({
    rank: index + 1,
    userId: user.id,
    username: user.username || `User_${user.id.slice(0, 8)}`,
    xp: user.xp,
    level: user.level,
  }));
  
  return c.json({
    success: true,
    data: {
      leaderboard: leaderboardData,
    },
  });
});
