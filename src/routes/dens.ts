import { Hono } from 'hono';
import { db } from '../db';
import { users, dens, denDeposits, type Den } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { Address } from '@ton/core';
import { validateBody } from '../middleware/validate';
import { jwtService } from '../lib/jwt';
import { log } from '../lib/logger';
import { buildNestDeploymentMessages, buildNestDepositMessage, buildNestWithdrawMessage, mapDenStrategy, strategyDefaults } from '../services/contracts';

export const denRoutes = new Hono();

const createDenSchema = z.object({
  name: z.string().min(1).max(128),
  emoji: z.string().max(8).optional(),
  isPublic: z.boolean().default(true),
  strategy: z.enum(['steady', 'adventurous']),
  contractAddress: z.string().min(1).max(80).optional(),
});

const joinDenSchema = z.object({
  amountTon: z.string().regex(/^\d+(\.\d{1,8})?$/),
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

function isAdminWallet(walletAddr: string) {
  const adminWallet = process.env.KITSU_ADMIN_WALLET?.trim();
  if (!adminWallet) {
    return false;
  }

  try {
    return Address.parse(walletAddr).toRawString() === Address.parse(adminWallet).toRawString();
  } catch {
    return adminWallet === walletAddr;
  }
}

// GET /dens - List public dens
denRoutes.get('/', async (c) => {
  const publicDens = await db.query.dens.findMany({
    where: eq(dens.isPublic, true),
    orderBy: [desc(dens.memberCount)],
    limit: 50,
  });
  
  return c.json({
    success: true,
    data: {
      dens: publicDens.map(d => ({
        id: d.id,
        ownerId: d.ownerId,
        name: d.name,
        emoji: d.emoji,
        isPublic: d.isPublic,
        strategy: d.strategy,
        contractAddress: d.contractAddress,
        apr: d.apr,
        totalDeposited: d.totalDeposited,
        memberCount: d.memberCount,
        createdAt: d.createdAt,
      })),
    },
  });
});

// GET /dens/mine - List user's dens
denRoutes.get('/mine', async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const deposits = await db.query.denDeposits.findMany({
    where: eq(denDeposits.userId, userId),
    with: { den: true },
  });

  const totals = new Map<string, { den: Den; ton: number }>();
  for (const row of deposits) {
    if (!row.den) continue;
    const prev = totals.get(row.denId);
    const add = parseFloat(row.amountTon);
    if (!prev) {
      totals.set(row.denId, { den: row.den, ton: add });
    } else {
      prev.ton += add;
    }
  }

  return c.json({
    success: true,
    data: {
      dens: Array.from(totals.values()).map(({ den: d, ton }) => ({
        id: d.id,
        ownerId: d.ownerId,
        name: d.name,
        emoji: d.emoji,
        isPublic: d.isPublic,
        strategy: d.strategy,
        contractAddress: d.contractAddress,
        apr: d.apr,
        totalDeposited: d.totalDeposited,
        memberCount: d.memberCount,
        createdAt: d.createdAt,
        myDepositTon: ton.toFixed(8),
      })),
    },
  });
});

// POST /dens - Create den
denRoutes.post('/', validateBody(createDenSchema), async (c) => {
  const user = await getCurrentUser(c);
  
  if (!user) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }

  if (!isAdminWallet(user.walletAddr)) {
    return c.json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Only Kitsu admin can create NestVaults' },
    }, 403);
  }
  
  const body = c.get('validatedBody') as z.infer<typeof createDenSchema>;
  const strategy = mapDenStrategy(body.strategy);
  const defaults = strategyDefaults(strategy);
  const deployment = body.contractAddress
    ? {
        address: body.contractAddress,
        strategyContract: defaults.strategyContract.toString(),
        aprBps: defaults.aprBps,
        messages: [] as Array<{ address: string; amount: string; payload?: string; stateInit?: string }>,
      }
    : await buildNestDeploymentMessages({
        owner: user.walletAddr,
        name: body.name,
        isPublic: body.isPublic,
        strategy,
      });
  const apr = (Number(deployment.aprBps) / 100).toFixed(2);
  
  const [newDen] = await db.insert(dens).values({
    ownerId: user.id,
    name: body.name,
    emoji: body.emoji || null,
    isPublic: body.isPublic,
    strategy: body.strategy,
    contractAddress: deployment.address,
    apr,
    totalDeposited: '0',
    memberCount: 0,
  }).returning();
  
  log.api('Den created', { userId: user.id, denId: newDen.id, strategy: body.strategy });
  
  return c.json({
    success: true,
    data: {
      den: {
        id: newDen.id,
        ownerId: newDen.ownerId,
        name: newDen.name,
        emoji: newDen.emoji,
        isPublic: newDen.isPublic,
        strategy: newDen.strategy,
        contractAddress: newDen.contractAddress,
        apr: newDen.apr,
        totalDeposited: newDen.totalDeposited,
        memberCount: newDen.memberCount,
        createdAt: newDen.createdAt,
      },
      txParams: {
        messages: deployment.messages,
      },
    },
  }, 201);
});

// GET /dens/:id - Get den details
denRoutes.get('/:id', async (c) => {
  const { id } = c.req.param();
  
  const den = await db.query.dens.findFirst({
    where: eq(dens.id, id),
  });
  
  if (!den) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Den not found' },
    }, 404);
  }
  
  // Get members with their deposits
  const deposits = await db.query.denDeposits.findMany({
    where: eq(denDeposits.denId, id),
    with: { user: true },
  });
  
  // Aggregate member balances
  const memberBalances = new Map<string, { userId: string; username: string; amount: string }>();
  
  for (const deposit of deposits) {
    const existing = memberBalances.get(deposit.userId);
    const currentAmount = parseFloat(existing?.amount || '0');
    const depositAmount = parseFloat(deposit.amountTon);
    
    memberBalances.set(deposit.userId, {
      userId: deposit.userId,
      username: deposit.user?.username || `User_${deposit.userId.slice(0, 8)}`,
      amount: (currentAmount + depositAmount).toFixed(8),
    });
  }
  
  return c.json({
    success: true,
    data: {
      den: {
        id: den.id,
        ownerId: den.ownerId,
        name: den.name,
        emoji: den.emoji,
        isPublic: den.isPublic,
        strategy: den.strategy,
        contractAddress: den.contractAddress,
        apr: den.apr,
        totalDeposited: den.totalDeposited,
        memberCount: den.memberCount,
        members: Array.from(memberBalances.values()),
        createdAt: den.createdAt,
      },
    },
  });
});

// POST /dens/:id/join - Join den
denRoutes.post('/:id/join', validateBody(joinDenSchema), async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const { id } = c.req.param();
  const body = c.get('validatedBody') as z.infer<typeof joinDenSchema>;
  
  const den = await db.query.dens.findFirst({
    where: eq(dens.id, id),
  });
  
  if (!den) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Den not found' },
    }, 404);
  }
  
  if (!den.isPublic && den.ownerId !== userId) {
    return c.json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'This den is private' },
    }, 403);
  }
  
  // Create deposit record
  const [deposit] = await db.insert(denDeposits).values({
    denId: id,
    userId,
    amountTon: body.amountTon,
  }).returning();
  
  // Update den totals
  const newTotal = (parseFloat(den.totalDeposited) + parseFloat(body.amountTon)).toFixed(8);
  
  // Check if user is new member
  const existingDeposits = await db.query.denDeposits.findMany({
    where: and(eq(denDeposits.denId, id), eq(denDeposits.userId, userId)),
  });
  
  const isNewMember = existingDeposits.length === 1;
  const newMemberCount = isNewMember ? den.memberCount + 1 : den.memberCount;
  
  await db.update(dens)
    .set({ totalDeposited: newTotal, memberCount: newMemberCount })
    .where(eq(dens.id, id));
  
  log.api('Den joined', { userId, denId: id, amount: body.amountTon });

  if (!den.contractAddress) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CONFIG_ERROR',
          message: 'This NestVault has not been deployed yet',
        },
      },
      503,
    );
  }

  const txMessage = buildNestDepositMessage(den.contractAddress, body.amountTon, mapDenStrategy(den.strategy as 'steady' | 'adventurous'));

  return c.json({
    success: true,
    data: {
      deposit: {
        denId: id,
        amount: body.amountTon,
        txParams: {
          messages: [txMessage],
        },
      },
    },
  });
});

// POST /dens/:id/leave - Leave den
denRoutes.post('/:id/leave', async (c) => {
  const userId = await getCurrentUserId(c);
  
  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const { id } = c.req.param();
  
  // Get user's total deposit in this den
  const deposits = await db.query.denDeposits.findMany({
    where: and(eq(denDeposits.denId, id), eq(denDeposits.userId, userId)),
  });
  
  if (deposits.length === 0) {
    return c.json({
      success: false,
      error: { code: 'NOT_MEMBER', message: 'You are not a member of this den' },
    }, 400);
  }
  
  const totalAmount = deposits.reduce((sum, d) => sum + parseFloat(d.amountTon), 0);
  
  // Get den for contract address
  const den = await db.query.dens.findFirst({
    where: eq(dens.id, id),
  });
  
  if (!den) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Den not found' },
    }, 404);
  }
  
  if (!den.contractAddress) {
    return c.json(
      {
        success: false,
        error: {
          code: 'CONFIG_ERROR',
          message: 'This NestVault has not been deployed yet',
        },
      },
      503,
    );
  }

  log.api('Den leave initiated', { userId, denId: id, amount: totalAmount });
  
  return c.json({
    success: true,
    data: {
      left: true,
      amount: totalAmount.toFixed(8),
      txParams: {
        messages: [buildNestWithdrawMessage(den.contractAddress, totalAmount.toFixed(8))],
      },
    },
  });
});
