import { Hono } from 'hono';
import { db } from '../db/index.js';
import { dens, goals, denDeposits, activityLog } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { jwtService } from '../lib/jwt.js';
import { gamificationService } from '../services/gamification.js';
import { priceService } from '../services/prices.js';
import { log } from '../lib/logger.js';
import { buildGoalClaimMessage, buildGoalDepositMessage, buildNestDepositMessage, buildNestWithdrawMessage, mapDenStrategy } from '../services/contracts.js';

export const transactionRoutes = new Hono();

const depositSchema = z.object({
  type: z.enum(['vault', 'goal', 'den']),
  targetId: z.string().uuid(),
  amountTon: z.string().regex(/^\d+(\.\d{1,8})?$/),
});

const withdrawSchema = z.object({
  type: z.enum(['vault', 'goal', 'den']),
  sourceId: z.string().uuid(),
  amountTon: z.string().regex(/^\d+(\.\d{1,8})?$/),
});

async function getCurrentUserId(c: any): Promise<string | null> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const payload = await jwtService.verifyToken(token);
  return payload?.userId || null;
}

// POST /transactions/deposit - Initiate deposit
transactionRoutes.post('/deposit', validateBody(depositSchema), async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const body = c.get('validatedBody') as z.infer<typeof depositSchema>;
  const amount = parseFloat(body.amountTon);
  
  // Validate target exists and build tx params
  let txMessages: Array<{ address: string; amount: string; payload?: string }>;
  
  if (body.type === 'den') {
    const den = await db.query.dens.findFirst({
      where: eq(dens.id, body.targetId),
    });
    if (!den) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Den not found' },
      }, 404);
    }

    if (!den.contractAddress) {
      return c.json({
        success: false,
        error: { code: 'CONFIG_ERROR', message: 'This NestVault has not been deployed yet' },
      }, 503);
    }
    txMessages = [buildNestDepositMessage(den.contractAddress, body.amountTon, mapDenStrategy(den.strategy as 'steady' | 'adventurous'))];
    
    // Create deposit record
    await db.insert(denDeposits).values({
      denId: body.targetId,
      userId,
      amountTon: body.amountTon,
    });
    
  } else if (body.type === 'goal') {
    const goal = await db.query.goals.findFirst({
      where: eq(goals.id, body.targetId),
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
        error: { code: 'CONFIG_ERROR', message: 'This GoalVault has not been deployed yet' },
      }, 503);
    }

    txMessages = [buildGoalDepositMessage(goal.contractAddress, body.amountTon, goal.strategy as 'tonstakers' | 'stonfi')];
    
    // Update goal progress with USD value
    const tonPrice = await priceService.tonToUsd(1);
    const addedUsd = amount * tonPrice;
    const currentAmount = parseFloat(goal.currentUsd);
    const currentTon = parseFloat(goal.currentTon || '0');
    
    await db.update(goals)
      .set({ currentUsd: (currentAmount + addedUsd).toFixed(2), currentTon: (currentTon + amount).toFixed(8) })
      .where(eq(goals.id, body.targetId));
  } else {
    txMessages = [{ address: process.env.VAULT_ADDRESS || '', amount: body.amountTon, payload: `deposit_${body.type}` }];
  }
  
  // Log activity and award XP
  const xpEarned = gamificationService.calculateXp('deposit');
  
  await db.insert(activityLog).values({
    userId,
    type: 'deposit',
    data: { type: body.type, targetId: body.targetId, amount: body.amountTon },
    xpEarned,
  });
  
  log.api('Deposit initiated', { userId, type: body.type, amount: body.amountTon });
  
  return c.json({
    success: true,
    data: {
      transaction: {
        id: crypto.randomUUID(),
        type: 'deposit',
        amount: body.amountTon,
        txParams: {
          messages: txMessages,
        },
        status: 'pending',
        xpEarned,
      },
    },
  });
});

// POST /transactions/withdraw - Initiate withdraw
transactionRoutes.post('/withdraw', validateBody(withdrawSchema), async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const body = c.get('validatedBody') as z.infer<typeof withdrawSchema>;
  
  let txMessages: Array<{ address: string; amount: string; payload?: string; stateInit?: string }>;
  
  if (body.type === 'den') {
    const den = await db.query.dens.findFirst({
      where: eq(dens.id, body.sourceId),
    });

    if (!den || !den.contractAddress) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Nest not found' },
      }, 404);
    }

    const deposits = await db.query.denDeposits.findMany({
      where: and(eq(denDeposits.denId, body.sourceId), eq(denDeposits.userId, userId)),
    });
    
    const totalBalance = deposits.reduce((sum, d) => sum + parseFloat(d.amountTon), 0);
    
    if (totalBalance < parseFloat(body.amountTon)) {
      return c.json({
        success: false,
        error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance in this den' },
      }, 400);
    }
    
    txMessages = [buildNestWithdrawMessage(den.contractAddress, body.amountTon)];
  } else if (body.type === 'goal') {
    const goal = await db.query.goals.findFirst({
      where: and(eq(goals.id, body.sourceId), eq(goals.userId, userId)),
    });

    if (!goal || !goal.contractAddress) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Goal not found' },
      }, 404);
    }

    txMessages = [buildGoalClaimMessage(goal.contractAddress)];
  } else {
    txMessages = [];
  }
  
  log.api('Withdraw initiated', { userId, type: body.type, amount: body.amountTon });
  
  return c.json({
    success: true,
    data: {
      transaction: {
        id: crypto.randomUUID(),
        type: 'withdraw',
        amount: body.amountTon,
        txParams: {
          messages: txMessages,
        },
        status: 'pending',
      },
    },
  });
});

// POST /transactions/stake - Stake via TONStakers
transactionRoutes.post('/stake', async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const tonstakersAddress = process.env.TONSTAKERS_ADDRESS || '';
  
  log.api('Stake initiated', { userId });
  
  return c.json({
    success: true,
    data: {
      transaction: {
        id: crypto.randomUUID(),
        type: 'stake',
        txParams: {
          to: tonstakersAddress,
          amount: '0',
          payload: 'stake',
        },
        status: 'pending',
      },
    },
  });
});

// POST /transactions/unstake - Unstake via TONStakers
transactionRoutes.post('/unstake', async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const tonstakersAddress = process.env.TONSTAKERS_ADDRESS || '';
  
  log.api('Unstake initiated', { userId });
  
  return c.json({
    success: true,
    data: {
      transaction: {
        id: crypto.randomUUID(),
        type: 'unstake',
        txParams: {
          to: tonstakersAddress,
          amount: '0',
          payload: 'unstake',
        },
        status: 'pending',
      },
    },
  });
});

// GET /transactions/history - User tx history
transactionRoutes.get('/history', async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const activities = await db.query.activityLog.findMany({
    where: eq(activityLog.userId, userId),
    orderBy: [desc(activityLog.createdAt)],
    limit: 50,
  });
  
  return c.json({
    success: true,
    data: {
      transactions: activities.map(a => ({
        id: a.id,
        type: a.type,
        amount: (a.data as any)?.amount || '0',
        status: 'completed',
        xpEarned: a.xpEarned,
        createdAt: a.createdAt,
      })),
    },
  });
});
