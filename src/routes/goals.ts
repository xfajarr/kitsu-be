import { Hono } from 'hono';
import { db } from '../db';
import { users, goals } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { jwtService } from '../lib/jwt';
import { log } from '../lib/logger';
import { priceService } from '../services/prices';
import { buildGoalDeploymentMessages } from '../services/contracts';

export const goalRoutes = new Hono();

const createGoalSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().max(512).optional(),
  emoji: z.string().max(8).optional(),
  targetTon: z.string().regex(/^\d+(\.\d{1,8})?$/),
  visibility: z.enum(['private', 'public']).default('private'),
  strategy: z.enum(['tonstakers', 'stonfi']).default('tonstakers'),
  dueDate: z.string().datetime().optional().nullable(),
});

const updateGoalSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  description: z.string().max(512).optional(),
  emoji: z.string().max(8).optional(),
  targetTon: z.string().regex(/^\d+(\.\d{1,8})?$/).optional(),
  visibility: z.enum(['private', 'public']).optional(),
  strategy: z.enum(['tonstakers', 'stonfi']).optional(),
  dueDate: z.string().datetime().optional().nullable(),
});

async function getCurrentUserId(c: any): Promise<string | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  
  const token = authHeader.slice(7);
  const payload = await jwtService.verifyToken(token);
  return payload?.userId || null;
}

// GET /goals - List user's goals
goalRoutes.get('/', async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const userGoals = await db.query.goals.findMany({
    where: and(eq(goals.userId, userId), eq(goals.isArchived, false)),
    orderBy: (goals, { desc }) => [desc(goals.createdAt)],
  });
  
  return c.json({
    success: true,
    data: {
      goals: userGoals.map(g => ({
        id: g.id,
        title: g.title,
        description: g.description,
        emoji: g.emoji,
        visibility: g.visibility,
        strategy: g.strategy,
        contractAddress: g.contractAddress,
        targetTon: g.targetTon,
        currentTon: g.currentTon,
        targetUsd: g.targetUsd,
        currentUsd: g.currentUsd,
        dueDate: g.dueDate,
        isArchived: g.isArchived,
        createdAt: g.createdAt,
      })),
    },
  });
});

// POST /goals - Create goal
goalRoutes.post('/', validateBody(createGoalSchema), async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const body = c.get('validatedBody') as z.infer<typeof createGoalSchema>;
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    return c.json({
      success: false,
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    }, 404);
  }

  const tonUsd = await priceService.tonToUsd(1);
  const targetUsd = (parseFloat(body.targetTon) * tonUsd).toFixed(2);
  const deadline = body.dueDate ? BigInt(Math.floor(new Date(body.dueDate).getTime() / 1000)) : 0n;
  const deployment = await buildGoalDeploymentMessages({
    owner: user.walletAddr,
    visibility: body.visibility,
    strategy: body.strategy,
    targetTon: body.targetTon,
    deadline,
    goalId: BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)),
  });
  
  const [newGoal] = await db.insert(goals).values({
    userId,
    title: body.title,
    description: body.description || null,
    emoji: body.emoji || null,
    visibility: body.visibility,
    strategy: body.strategy,
    contractAddress: deployment.address,
    targetTon: body.targetTon,
    currentTon: '0',
    targetUsd,
    currentUsd: '0',
    dueDate: body.dueDate ? new Date(body.dueDate) : null,
    isArchived: false,
  }).returning();
  
  log.api('Goal created', { userId, goalId: newGoal.id });
  
  return c.json({
    success: true,
    data: {
      goal: {
        id: newGoal.id,
        title: newGoal.title,
        description: newGoal.description,
        emoji: newGoal.emoji,
        visibility: newGoal.visibility,
        strategy: newGoal.strategy,
        contractAddress: newGoal.contractAddress,
        targetTon: newGoal.targetTon,
        currentTon: newGoal.currentTon,
        targetUsd: newGoal.targetUsd,
        currentUsd: newGoal.currentUsd,
        dueDate: newGoal.dueDate,
        isArchived: newGoal.isArchived,
        createdAt: newGoal.createdAt,
      },
      txParams: {
        messages: deployment.messages,
      },
    },
  }, 201);
});

// PATCH /goals/:id - Update goal
goalRoutes.patch('/:id', validateBody(updateGoalSchema), async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const { id } = c.req.param();
  const updates = c.get('validatedBody') as z.infer<typeof updateGoalSchema>;
  
  // Verify ownership
  const existingGoal = await db.query.goals.findFirst({
    where: and(eq(goals.id, id), eq(goals.userId, userId)),
  });
  
  if (!existingGoal) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Goal not found' },
    }, 404);
  }
  
  const updateData: any = {};
  if (updates.title) updateData.title = updates.title;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.emoji !== undefined) updateData.emoji = updates.emoji;
  if (updates.visibility) updateData.visibility = updates.visibility;
  if (updates.strategy) updateData.strategy = updates.strategy;
  if (updates.targetTon) {
    const tonUsd = await priceService.tonToUsd(1);
    updateData.targetTon = updates.targetTon;
    updateData.targetUsd = (parseFloat(updates.targetTon) * tonUsd).toFixed(2);
  }
  if (updates.dueDate !== undefined) updateData.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
  
  const [updatedGoal] = await db.update(goals)
    .set(updateData)
    .where(eq(goals.id, id))
    .returning();
  
  return c.json({
    success: true,
    data: {
      goal: {
        id: updatedGoal.id,
        title: updatedGoal.title,
        description: updatedGoal.description,
        emoji: updatedGoal.emoji,
        visibility: updatedGoal.visibility,
        strategy: updatedGoal.strategy,
        contractAddress: updatedGoal.contractAddress,
        targetTon: updatedGoal.targetTon,
        currentTon: updatedGoal.currentTon,
        targetUsd: updatedGoal.targetUsd,
        currentUsd: updatedGoal.currentUsd,
        dueDate: updatedGoal.dueDate,
        isArchived: updatedGoal.isArchived,
        createdAt: updatedGoal.createdAt,
      },
    },
  });
});

// DELETE /goals/:id - Archive goal
goalRoutes.delete('/:id', async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const { id } = c.req.param();
  
  // Verify ownership
  const existingGoal = await db.query.goals.findFirst({
    where: and(eq(goals.id, id), eq(goals.userId, userId)),
  });
  
  if (!existingGoal) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Goal not found' },
    }, 404);
  }
  
  await db.update(goals)
    .set({ isArchived: true })
    .where(eq(goals.id, id));
  
  log.api('Goal archived', { userId, goalId: id });
  
  return c.json({
    success: true,
    data: { archived: true },
  });
});
