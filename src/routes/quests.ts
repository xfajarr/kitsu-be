import { Hono } from 'hono';
import { db } from '../db';
import { users, quests, activityLog } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { jwtService } from '../lib/jwt';
import { gamificationService, QUEST_DEFINITIONS } from '../services/gamification';
import { log } from '../lib/logger';

export const questRoutes = new Hono();

async function getCurrentUserId(c: any): Promise<string | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const payload = await jwtService.verifyToken(token);
  return payload?.userId || null;
}

// GET /quests - User's quests with progress
questRoutes.get('/', async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  // Get user's existing quest progress
  const userQuests = await db.query.quests.findMany({
    where: eq(quests.userId, userId),
  });
  
  // Map quest progress
  const questProgress = new Map(userQuests.map(q => [q.questKey, q]));
  
  // Build quest list from definitions
  const questList = QUEST_DEFINITIONS.map(def => {
    const existing = questProgress.get(def.key);
    
    return {
      id: existing?.id || `quest-${def.key}`,
      questKey: def.key,
      title: def.title,
      hint: def.hint,
      reward: def.reward,
      progress: existing?.progress || 0,
      completed: existing?.completed || false,
    };
  });
  
  return c.json({
    success: true,
    data: { quests: questList },
  });
});

// POST /quests/:id/claim - Claim quest XP reward
questRoutes.post('/:id/claim', async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const { id } = c.req.param();
  
  // Find the quest
  const quest = await db.query.quests.findFirst({
    where: and(eq(quests.id, id), eq(quests.userId, userId)),
  });
  
  if (!quest) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Quest not found' },
    }, 404);
  }
  
  if (!quest.completed) {
    return c.json({
      success: false,
      error: { code: 'QUEST_INCOMPLETE', message: 'Quest is not yet completed' },
    }, 400);
  }
  
  // Get user
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  
  if (!user) {
    return c.json({
      success: false,
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    }, 404);
  }
  
  // Award XP
  const xpAwarded = gamificationService.calculateXp('quest_completed');
  const newTotalXp = user.xp + xpAwarded;
  const levelInfo = gamificationService.calculateLevelFromXp(newTotalXp);
  
  // Update user XP and level
  await db.update(users)
    .set({ xp: newTotalXp, level: levelInfo.level })
    .where(eq(users.id, userId));
  
  // Mark quest as claimed by deleting it (or we could add a claimed flag)
  await db.delete(quests).where(eq(quests.id, id));
  
  // Log activity
  await db.insert(activityLog).values({
    userId,
    type: 'quest_claimed',
    data: { questKey: quest.questKey },
    xpEarned: xpAwarded,
  });
  
  log.api('Quest claimed', { userId, questId: id, xpAwarded });
  
  return c.json({
    success: true,
    data: {
      claimed: true,
      xpAwarded,
      newTotalXp,
      newLevel: levelInfo.level,
    },
  });
});
