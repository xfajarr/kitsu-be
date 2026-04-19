import { Hono } from 'hono';
import { db } from '../db';
import { users, goals } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { jwtService } from '../lib/jwt';
import { log } from '../lib/logger';
import { priceService } from '../services/prices';
import { buildGoalClaimMessage, buildGoalConfigureMessage, buildGoalDeploymentMessages, buildGoalDepositMessage, buildGoalSyncYieldMessage, buildGoalTonstakersUnstakeMessage } from '../services/contracts';
import { getGoalOnchainSnapshotSafe } from '../services/vaults';
import { tonCenter } from '../services/toncenter';

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

const depositGoalSchema = z.object({
  amountTon: z.string().regex(/^\d+(\.\d{1,8})?$/),
});

const unwindTonstakersSchema = z.object({
  mode: z.enum(['standard', 'instant', 'best-rate']).default('best-rate'),
});

async function getCurrentUserId(c: any): Promise<string | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  
  const token = authHeader.slice(7);
  const payload = await jwtService.verifyToken(token);
  return payload?.userId || null;
}

async function getCurrentUser(c: any) {
  const userId = await getCurrentUserId(c);
  if (!userId) {
    return null;
  }

  return await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
}

async function mapGoalsWithSnapshots(goalList: any[], walletAddr?: string) {
  const tonUsd = await priceService.tonToUsd(1).catch(() => null);
  const onchainEntries = await Promise.all(
    goalList.map(async (goal) => [
      goal.id,
      goal.contractAddress ? await getGoalOnchainSnapshotSafe(goal.contractAddress, walletAddr) : null,
    ] as const),
  );
  const onchainByGoalId = new Map(onchainEntries);

  return goalList.map((g) => ({
    ...(onchainByGoalId.get(g.id)
      ? {
          currentTon: onchainByGoalId.get(g.id)!.currentTon,
          currentUsd: tonUsd !== null ? (parseFloat(onchainByGoalId.get(g.id)!.currentTon) * tonUsd).toFixed(2) : g.currentUsd,
          principalTon: onchainByGoalId.get(g.id)!.principalTon,
          yieldTon: onchainByGoalId.get(g.id)!.yieldTon,
          vaultValueTon: onchainByGoalId.get(g.id)!.vaultValueTon,
          totalPrincipalTon: onchainByGoalId.get(g.id)!.totalPrincipalTon,
          totalYieldTon: onchainByGoalId.get(g.id)!.totalYieldTon,
          canClaim: onchainByGoalId.get(g.id)!.canClaim,
          canUnwind: onchainByGoalId.get(g.id)!.canUnwind,
          tsTonBalance: onchainByGoalId.get(g.id)!.tsTonBalance,
          projectedVaultValueTon: onchainByGoalId.get(g.id)!.projectedVaultValueTon,
          liquidTonBalance: onchainByGoalId.get(g.id)!.liquidTonBalance,
          syncYieldTon: onchainByGoalId.get(g.id)!.syncYieldTon,
          isOnchainSynced: true,
          isLiveValue: onchainByGoalId.get(g.id)!.isLiveValue,
          lastStrategySyncTime: onchainByGoalId.get(g.id)!.lastStrategySyncTime || null,
        }
      : {
          currentTon: g.currentTon,
          currentUsd: g.currentUsd,
          principalTon: g.currentTon,
          yieldTon: '0',
          vaultValueTon: g.currentTon,
          totalPrincipalTon: g.currentTon,
          totalYieldTon: '0',
          canClaim: false,
          canUnwind: false,
          tsTonBalance: null,
          projectedVaultValueTon: null,
          liquidTonBalance: '0',
          syncYieldTon: null,
          isOnchainSynced: false,
          isLiveValue: false,
          lastStrategySyncTime: null,
        }),
    id: g.id,
    userId: g.userId,
    title: g.title,
    description: g.description,
    emoji: g.emoji,
    visibility: g.visibility,
    strategy: g.strategy,
    contractAddress: g.contractAddress,
    targetTon: g.targetTon,
    targetUsd: g.targetUsd,
    dueDate: g.dueDate,
    isArchived: g.isArchived,
    createdAt: g.createdAt,
  }));
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
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    return c.json({
      success: false,
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    }, 404);
  }

  const goalsWithSnapshots = await mapGoalsWithSnapshots(userGoals, user.walletAddr);
  
  return c.json({
    success: true,
    data: {
      goals: goalsWithSnapshots,
    },
  });
});

// GET /goals/public - Explore public goals that accept deposits
goalRoutes.get('/public', async (c) => {
  const user = await getCurrentUser(c);
  const publicGoals = await db.query.goals.findMany({
    where: and(eq(goals.visibility, 'public'), eq(goals.isArchived, false)),
    orderBy: (goals, { desc }) => [desc(goals.createdAt)],
  });

  return c.json({
    success: true,
    data: {
      goals: await mapGoalsWithSnapshots(publicGoals, user?.walletAddr),
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
      configureAfterDeploy: true,
    },
  }, 201);
});

// POST /goals/:id/configure - Configure strategy wallet after factory deployment
goalRoutes.post('/:id/configure', async (c) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  const { id } = c.req.param();
  const goal = await db.query.goals.findFirst({
    where: and(eq(goals.id, id), eq(goals.userId, user.id)),
  });

  if (!goal) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Goal not found' } }, 404);
  }

  if (!goal.contractAddress) {
    return c.json({ success: false, error: { code: 'NOT_DEPLOYED', message: 'Goal contract not deployed yet' } }, 503);
  }

  const info = await tonCenter.v2.getAddressInformation(goal.contractAddress);
  if (!info.result || info.result.state !== 'active') {
    return c.json({ success: false, error: { code: 'GOAL_NOT_READY', message: 'Goal contract is still being deployed. Retry configuration in a moment.' } }, 409);
  }

  const configuration = await buildGoalConfigureMessage({
    owner: user.walletAddr,
    strategy: goal.strategy as 'tonstakers' | 'stonfi',
    goalAddress: goal.contractAddress,
  });

  return c.json({
    success: true,
    data: {
      configure: {
        goalId: id,
        goalAddress: configuration.goalAddress,
        txParams: configuration.txParams,
      },
    },
  });
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

// POST /goals/:id/sync - Sync live TonStakers yield into the GoalVault
goalRoutes.post('/:id/sync', async (c) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  const { id } = c.req.param();
  const goal = await db.query.goals.findFirst({ where: and(eq(goals.id, id), eq(goals.userId, user.id)) });

  if (!goal) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Goal not found' } }, 404);
  }

  if (!goal.contractAddress) {
    return c.json({ success: false, error: { code: 'NOT_DEPLOYED', message: 'Goal contract not deployed yet' } }, 503);
  }

  const snapshot = await getGoalOnchainSnapshotSafe(goal.contractAddress, user.walletAddr);
  if (!snapshot?.syncYieldTon || parseFloat(snapshot.syncYieldTon) <= 0) {
    return c.json({ success: false, error: { code: 'ALREADY_SYNCED', message: 'No additional TonStakers yield needs syncing right now' } }, 409);
  }

  return c.json({
    success: true,
    data: {
      sync: {
        goalId: id,
        amount: snapshot.syncYieldTon,
        txParams: { messages: [buildGoalSyncYieldMessage(goal.contractAddress, snapshot.syncYieldTon)] },
      },
    },
  });
});

// POST /goals/:id/unwind - Request TonStakers unstake back to the GoalVault
goalRoutes.post('/:id/unwind', validateBody(unwindTonstakersSchema), async (c) => {
  const user = await getCurrentUser(c);

  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  const { id } = c.req.param();
  const body = c.get('validatedBody') as z.infer<typeof unwindTonstakersSchema>;
  const goal = await db.query.goals.findFirst({ where: and(eq(goals.id, id), eq(goals.userId, user.id)) });

  if (!goal) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Goal not found' } }, 404);
  }

  if (!goal.contractAddress) {
    return c.json({ success: false, error: { code: 'NOT_DEPLOYED', message: 'Goal contract not deployed yet' } }, 503);
  }

  const snapshot = await getGoalOnchainSnapshotSafe(goal.contractAddress, user.walletAddr);
  if (snapshot?.strategy !== 'tonstakers') {
    return c.json({ success: false, error: { code: 'UNSUPPORTED_STRATEGY', message: 'This unwind flow is currently implemented for TonStakers goals only' } }, 400);
  }

  if (!snapshot.tsTonBalance || parseFloat(snapshot.tsTonBalance) <= 0) {
    return c.json({ success: false, error: { code: 'NOTHING_TO_UNWIND', message: 'There is no tsTON position to unstake from this goal right now' } }, 409);
  }

  return c.json({
    success: true,
    data: {
      unwind: {
        goalId: id,
        amount: snapshot.tsTonBalance,
        mode: body.mode,
        txParams: { messages: [buildGoalTonstakersUnstakeMessage(goal.contractAddress, snapshot.tsTonBalance, body.mode)] },
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

// POST /goals/:id/deposit - Deposit to goal
goalRoutes.post('/:id/deposit', validateBody(depositGoalSchema), async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const { id } = c.req.param();
  const body = c.get('validatedBody') as z.infer<typeof depositGoalSchema>;
  
  const goal = await db.query.goals.findFirst({
    where: eq(goals.id, id),
  });
  
  if (!goal) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Goal not found' },
    }, 404);
  }
  
  if (!goal.contractAddress) {
    return c.json({
      success: false,
      error: { code: 'NOT_DEPLOYED', message: 'Goal contract not deployed yet' },
    }, 503);
  }
  
  const txMessage = buildGoalDepositMessage(goal.contractAddress, body.amountTon, goal.strategy as 'tonstakers' | 'stonfi');
  
  log.api('Goal deposit', { userId, goalId: id, amount: body.amountTon });
  
  return c.json({
    success: true,
    data: {
      deposit: {
        goalId: id,
        amount: body.amountTon,
        txParams: { messages: [txMessage] },
      },
    },
  });
});

// POST /goals/:id/claim - Claim from goal (withdraw principal + yield)
goalRoutes.post('/:id/claim', async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const { id } = c.req.param();
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    return c.json({
      success: false,
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    }, 404);
  }
  
  const goal = await db.query.goals.findFirst({
    where: eq(goals.id, id),
  });
  
  if (!goal) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Goal not found' },
    }, 404);
  }
  
  if (!goal.contractAddress) {
    return c.json({
      success: false,
      error: { code: 'NOT_DEPLOYED', message: 'Goal contract not deployed yet' },
    }, 503);
  }

  const snapshot = await getGoalOnchainSnapshotSafe(goal.contractAddress, user.walletAddr);
  if (snapshot && !snapshot.canClaim) {
    return c.json({
      success: false,
      error: { code: 'GOAL_NOT_SETTLED', message: 'Goal funds are still locked in strategy or target is not settled yet' },
    }, 400);
  }
  
  const txMessage = buildGoalClaimMessage(goal.contractAddress);
  
  log.api('Goal claim', { userId, goalId: id });
  
  return c.json({
    success: true,
    data: {
      claim: {
        goalId: id,
        txParams: { messages: [txMessage] },
      },
    },
  });
});
