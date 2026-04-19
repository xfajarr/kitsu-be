import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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
import { getNestOnchainSnapshotSafe } from '../services/vaults';

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

const confirmJoinDenSchema = z.object({
  confirmationToken: z.string().min(1),
  txBoc: z.string().min(1),
});

const JOIN_CONFIRM_TTL_SECONDS = 15 * 60;
const DEN_JOIN_CONFIRM_SECRET = process.env.DEN_JOIN_CONFIRM_SECRET || process.env.JWT_SECRET || 'default-secret-change-in-production';

type JoinConfirmationPayload = {
  userId: string;
  denId: string;
  amountTon: string;
  exp: number;
  nonce: string;
};

function toBase64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64');
}

function signJoinConfirmationToken(payload: Omit<JoinConfirmationPayload, 'exp' | 'nonce'>) {
  const body: JoinConfirmationPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + JOIN_CONFIRM_TTL_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const encodedPayload = toBase64Url(JSON.stringify(body));
  const signature = toBase64Url(createHmac('sha256', DEN_JOIN_CONFIRM_SECRET).update(encodedPayload).digest());
  return `${encodedPayload}.${signature}`;
}

function verifyJoinConfirmationToken(token: string): JoinConfirmationPayload | null {
  try {
    const [encodedPayload, encodedSignature] = token.split('.');
    if (!encodedPayload || !encodedSignature) {
      return null;
    }

    const expectedSignature = createHmac('sha256', DEN_JOIN_CONFIRM_SECRET).update(encodedPayload).digest();
    const receivedSignature = fromBase64Url(encodedSignature);
    if (
      expectedSignature.length !== receivedSignature.length ||
      !timingSafeEqual(expectedSignature, receivedSignature)
    ) {
      return null;
    }

    const payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf8')) as JoinConfirmationPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return null;
    }

    if (!payload.userId || !payload.denId || !payload.amountTon || !payload.nonce) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

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
  const onchainEntries = await Promise.all(
    publicDens.map(async (den) => [den.id, den.contractAddress ? await getNestOnchainSnapshotSafe(den.contractAddress) : null] as const),
  );
  const onchainByDenId = new Map(onchainEntries);
  
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
        totalDeposited: onchainByDenId.get(d.id)?.totalPrincipalTon || d.totalDeposited,
        memberCount: onchainByDenId.get(d.id)?.memberCount ?? d.memberCount,
        vaultValueTon: onchainByDenId.get(d.id)?.vaultValueTon || d.totalDeposited,
        totalYieldTon: onchainByDenId.get(d.id)?.totalYieldTon || '0',
        isOnchainSynced: !!onchainByDenId.get(d.id),
        lastStrategySyncTime: onchainByDenId.get(d.id)?.lastStrategySyncTime || null,
        createdAt: d.createdAt,
      })),
    },
  });
});

// GET /dens/mine - List user's dens
denRoutes.get('/mine', async (c) => {
  const user = await getCurrentUser(c);
  
  if (!user) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const deposits = await db.query.denDeposits.findMany({
    where: eq(denDeposits.userId, user.id),
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

  const denEntries = Array.from(totals.entries());
  const onchainEntries = await Promise.all(
    denEntries.map(async ([denId, entry]) => [
      denId,
      entry.den.contractAddress ? await getNestOnchainSnapshotSafe(entry.den.contractAddress, user.walletAddr) : null,
    ] as const),
  );
  const onchainByDenId = new Map(onchainEntries);

  return c.json({
    success: true,
    data: {
      dens: denEntries.map(([denId, { den: d, ton }]) => ({
        id: d.id,
        ownerId: d.ownerId,
        name: d.name,
        emoji: d.emoji,
        isPublic: d.isPublic,
        strategy: d.strategy,
        contractAddress: d.contractAddress,
        apr: d.apr,
        totalDeposited: onchainByDenId.get(denId)?.totalPrincipalTon || d.totalDeposited,
        memberCount: onchainByDenId.get(denId)?.memberCount ?? d.memberCount,
        vaultValueTon: onchainByDenId.get(denId)?.vaultValueTon || d.totalDeposited,
        totalYieldTon: onchainByDenId.get(denId)?.totalYieldTon || '0',
        myDepositTon: onchainByDenId.get(denId)?.principalTon || ton.toFixed(8),
        myCurrentTon: onchainByDenId.get(denId)?.currentTon || ton.toFixed(8),
        myYieldTon: onchainByDenId.get(denId)?.yieldTon || '0',
        mySharesTon: onchainByDenId.get(denId)?.sharesTon || ton.toFixed(8),
        canWithdraw: onchainByDenId.get(denId)?.canWithdraw ?? ton > 0,
        isOnchainSynced: !!onchainByDenId.get(denId),
        lastStrategySyncTime: onchainByDenId.get(denId)?.lastStrategySyncTime || null,
        createdAt: d.createdAt,
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
  const confirmationToken = signJoinConfirmationToken({
    userId,
    denId: id,
    amountTon: body.amountTon,
  });

  log.api('Den join prepared', { userId, denId: id, amount: body.amountTon });

  return c.json({
    success: true,
    data: {
      deposit: {
        denId: id,
        amount: body.amountTon,
        confirmationToken,
        txParams: {
          messages: [txMessage],
        },
      },
    },
  });
});

// POST /dens/:id/join/confirm - Persist a successful den deposit
denRoutes.post('/:id/join/confirm', validateBody(confirmJoinDenSchema), async (c) => {
  const userId = await getCurrentUserId(c);

  if (!userId) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }

  const { id } = c.req.param();
  const body = c.get('validatedBody') as z.infer<typeof confirmJoinDenSchema>;
  const confirmation = verifyJoinConfirmationToken(body.confirmationToken);

  if (!confirmation || confirmation.userId !== userId || confirmation.denId !== id) {
    return c.json({
      success: false,
      error: { code: 'INVALID_CONFIRMATION', message: 'Deposit confirmation is invalid or expired' },
    }, 400);
  }

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

  const txHash = createHash('sha256').update(body.txBoc).digest('hex');
  const existingByTxHash = await db.query.denDeposits.findFirst({
    where: eq(denDeposits.txHash, txHash),
  });

  if (existingByTxHash) {
    if (existingByTxHash.denId !== id || existingByTxHash.userId !== userId) {
      return c.json({
        success: false,
        error: { code: 'TX_HASH_CONFLICT', message: 'This wallet transaction was already linked to another deposit' },
      }, 409);
    }

    return c.json({
      success: true,
      data: {
        deposit: {
          denId: id,
          amount: existingByTxHash.amountTon,
          confirmed: true,
          txHash,
        },
      },
    });
  }

  const existingMemberDeposit = await db.query.denDeposits.findFirst({
    where: and(eq(denDeposits.denId, id), eq(denDeposits.userId, userId)),
  });

  await db.insert(denDeposits).values({
    denId: id,
    userId,
    amountTon: confirmation.amountTon,
    txHash,
  });

  const newTotal = (parseFloat(den.totalDeposited) + parseFloat(confirmation.amountTon)).toFixed(8);
  const newMemberCount = existingMemberDeposit ? den.memberCount : den.memberCount + 1;

  await db.update(dens)
    .set({ totalDeposited: newTotal, memberCount: newMemberCount })
    .where(eq(dens.id, id));

  log.api('Den join confirmed', { userId, denId: id, amount: confirmation.amountTon, txHash });

  return c.json({
    success: true,
    data: {
      deposit: {
        denId: id,
        amount: confirmation.amountTon,
        confirmed: true,
        txHash,
      },
    },
  });
});

// POST /dens/:id/leave - Leave den
denRoutes.post('/:id/leave', async (c) => {
  const user = await getCurrentUser(c);
  
  if (!user) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const { id } = c.req.param();
  
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

  const snapshot = await getNestOnchainSnapshotSafe(den.contractAddress, user.walletAddr);
  if (!snapshot || !snapshot.canWithdraw || parseFloat(snapshot.sharesTon) <= 0) {
    return c.json({
      success: false,
      error: { code: 'NOT_MEMBER', message: 'You do not have withdrawable shares in this den yet' },
    }, 400);
  }

  log.api('Den leave initiated', { userId: user.id, denId: id, amount: snapshot.currentTon, shares: snapshot.sharesTon });
  
  return c.json({
    success: true,
    data: {
      left: true,
      amount: snapshot.currentTon,
      txParams: {
        messages: [buildNestWithdrawMessage(den.contractAddress, snapshot.sharesTon)],
      },
    },
  });
});
