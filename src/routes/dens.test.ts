import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Hono } from 'hono';
import { denDeposits, dens, users } from '../db/schema';
import { errorHandler, notFoundHandler } from '../middleware/error';

type DenRecord = {
  id: string;
  ownerId: string;
  name: string;
  emoji: string | null;
  isPublic: boolean;
  strategy: 'steady' | 'adventurous';
  contractAddress: string | null;
  apr: string;
  totalDeposited: string;
  memberCount: number;
  createdAt: string;
};

type NestSnapshot = {
  totalPrincipalTon: string;
  vaultValueTon: string;
  totalYieldTon: string;
  currentTon: string;
  principalTon: string;
  sharesTon: string;
  yieldTon: string;
  canWithdraw: boolean;
  isActive: boolean;
  memberCount: number;
  lastStrategySyncTime: string;
};

const state = {
  densFindManyReturn: [] as DenRecord[],
  densFindFirstReturn: null as DenRecord | null,
  userReturn: null as { id: string; walletAddr: string } | null,
  jwtPayload: null as { userId: string; walletAddr: string } | null,
  snapshots: new Map<string, NestSnapshot | null>(),
  insertCalls: 0,
  lastInsertedValues: null as Record<string, unknown> | null,
  createdDenReturn: null as DenRecord | null,
  deploymentMessages: [
    { address: 'vault-1', amount: '100000000', stateInit: 'state-init' },
    { address: 'vault-1', amount: '50000000', payload: 'configure-payload' },
  ] as Array<{ address: string; amount: string; payload?: string; stateInit?: string }>,
};

mock.module('../db', () => ({
  db: {
    query: {
      dens: {
        findMany: async () => state.densFindManyReturn,
        findFirst: async () => state.densFindFirstReturn,
      },
      users: {
        findFirst: async () => state.userReturn,
      },
      denDeposits: {
        findMany: async () => [],
        findFirst: async () => null,
      },
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.insertCalls += 1;
        state.lastInsertedValues = values;
        return { returning: async () => state.createdDenReturn ? [state.createdDenReturn] : [] };
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => [],
      }),
    }),
  },
  users,
  dens,
  denDeposits,
}));

mock.module('../services/vaults', () => ({
  getNestOnchainSnapshotSafe: async (contractAddress: string, walletAddress?: string) => {
    const walletKey = walletAddress ? `${contractAddress}:${walletAddress}` : null;
    if (walletKey && state.snapshots.has(walletKey)) {
      return state.snapshots.get(walletKey) ?? null;
    }
    return state.snapshots.get(contractAddress) ?? null;
  },
}));

mock.module('../services/contracts', () => ({
  buildNestDeploymentMessages: async () => ({
    address: 'vault-1',
    strategyContract: 'pool-address',
    aprBps: 480n,
    messages: state.deploymentMessages,
  }),
  buildNestDepositMessage: (contractAddress: string, amountTon: string, strategy: string) => ({
    address: contractAddress,
    amount: `prepared-${amountTon}`,
    payload: `deposit-${strategy}`,
  }),
  buildNestWithdrawMessage: (contractAddress: string, sharesTon: string) => ({
    address: contractAddress,
    amount: '0.05',
    payload: `withdraw-${sharesTon}`,
  }),
  mapDenStrategy: (strategy: 'steady' | 'adventurous') => strategy === 'steady' ? 'tonstakers' : 'stonfi',
  strategyDefaults: () => ({
    strategyContract: { toString: () => 'pool-address' },
    aprBps: 480n,
  }),
}));

mock.module('../lib/jwt', () => ({
  jwtService: {
    verifyToken: async () => state.jwtPayload,
  },
}));

mock.module('../lib/logger', () => ({
  log: {
    api: () => {},
    warn: () => {},
  },
  logger: {
    request: () => {},
    warn: () => {},
  },
}));

const { denRoutes } = await import('./dens');

function createApp() {
  const app = new Hono();
  app.route('/dens', denRoutes);
  app.notFound(notFoundHandler);
  app.onError(errorHandler);
  return app;
}

function createSnapshot(overrides: Partial<NestSnapshot> = {}): NestSnapshot {
  return {
    totalPrincipalTon: '10.00000000',
    vaultValueTon: '12.50000000',
    totalYieldTon: '2.50000000',
    currentTon: '4.50000000',
    principalTon: '4.00000000',
    sharesTon: '4.00000000',
    yieldTon: '0.50000000',
    canWithdraw: true,
    isActive: true,
    memberCount: 3,
    lastStrategySyncTime: '2026-04-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('dens routes', () => {
  beforeEach(() => {
    state.densFindManyReturn = [];
    state.densFindFirstReturn = null;
    state.userReturn = null;
    state.jwtPayload = null;
    state.snapshots = new Map();
    state.insertCalls = 0;
    state.lastInsertedValues = null;
    state.createdDenReturn = null;
    state.deploymentMessages = [
      { address: 'vault-1', amount: '100000000', stateInit: 'state-init' },
      { address: 'vault-1', amount: '50000000', payload: 'configure-payload' },
    ];
    process.env.KITSU_ADMIN_WALLET = 'EQB8itOBqz4oLF_rpJGMNeUXNdDtqfD-dgn0mWcra-pLY8GV';
  });

  it('returns deploy plus configure messages when admin creates a Nest', async () => {
    state.jwtPayload = { userId: 'admin-user', walletAddr: 'EQB8itOBqz4oLF_rpJGMNeUXNdDtqfD-dgn0mWcra-pLY8GV' };
    state.userReturn = { id: 'admin-user', walletAddr: 'EQB8itOBqz4oLF_rpJGMNeUXNdDtqfD-dgn0mWcra-pLY8GV' };
    state.createdDenReturn = {
      id: 'den-1',
      ownerId: 'admin-user',
      name: 'Kitsu Core Nest',
      emoji: '🏠',
      isPublic: true,
      strategy: 'steady',
      contractAddress: 'vault-1',
      apr: '4.80',
      totalDeposited: '0',
      memberCount: 0,
      createdAt: '2026-04-20T00:00:00.000Z',
    };

    const res = await createApp().request('/dens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
      },
      body: JSON.stringify({
        name: 'Kitsu Core Nest',
        emoji: '🏠',
        isPublic: true,
        strategy: 'steady',
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.txParams.messages).toHaveLength(2);
    expect(body.data.txParams.messages[0]).toMatchObject({ stateInit: 'state-init' });
    expect(body.data.txParams.messages[1]).toMatchObject({ payload: 'configure-payload' });
    expect(state.insertCalls).toBe(1);
    expect(state.lastInsertedValues).toMatchObject({
      ownerId: 'admin-user',
      name: 'Kitsu Core Nest',
      contractAddress: 'vault-1',
    });
  });

  it('serves public Nest list from on-chain snapshot values', async () => {
    state.densFindManyReturn = [
      {
        id: 'den-1',
        ownerId: 'owner-1',
        name: 'Alpha Nest',
        emoji: '🏠',
        isPublic: true,
        strategy: 'steady',
        contractAddress: 'contract-1',
        apr: '4.80',
        totalDeposited: '0',
        memberCount: 0,
        createdAt: '2026-04-20T00:00:00.000Z',
      },
    ];
    state.snapshots.set('contract-1', createSnapshot());

    const res = await createApp().request('/dens');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.dens[0]).toMatchObject({
      totalDeposited: '10.00000000',
      vaultValueTon: '12.50000000',
      totalYieldTon: '2.50000000',
      memberCount: 3,
      isOnchainSynced: true,
    });
  });

  it('serves my Nest list from on-chain shares and position only', async () => {
    state.jwtPayload = { userId: 'user-1', walletAddr: 'wallet-1' };
    state.userReturn = { id: 'user-1', walletAddr: 'wallet-1' };
    state.densFindManyReturn = [
      {
        id: 'den-1',
        ownerId: 'owner-1',
        name: 'Alpha Nest',
        emoji: '🏠',
        isPublic: true,
        strategy: 'steady',
        contractAddress: 'contract-1',
        apr: '4.80',
        totalDeposited: '0',
        memberCount: 0,
        createdAt: '2026-04-20T00:00:00.000Z',
      },
      {
        id: 'den-2',
        ownerId: 'owner-2',
        name: 'Beta Nest',
        emoji: '🦊',
        isPublic: false,
        strategy: 'steady',
        contractAddress: 'contract-2',
        apr: '4.80',
        totalDeposited: '0',
        memberCount: 0,
        createdAt: '2026-04-21T00:00:00.000Z',
      },
    ];
    state.snapshots.set('contract-1:wallet-1', createSnapshot({ sharesTon: '5.00000000', currentTon: '6.00000000', principalTon: '5.00000000', yieldTon: '1.00000000' }));
    state.snapshots.set('contract-2:wallet-1', createSnapshot({ sharesTon: '0.00000000', currentTon: '0.00000000', principalTon: '0.00000000', yieldTon: '0.00000000', canWithdraw: false }));

    const res = await createApp().request('/dens/mine', {
      headers: { Authorization: 'Bearer token' },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.dens).toHaveLength(1);
    expect(body.data.dens[0]).toMatchObject({
      id: 'den-1',
      myDepositTon: '5.00000000',
      myCurrentTon: '6.00000000',
      myYieldTon: '1.00000000',
      mySharesTon: '5.00000000',
      canWithdraw: true,
    });
  });

  it('prepares deposit transaction without persisting a deposit record', async () => {
    state.jwtPayload = { userId: 'user-1', walletAddr: 'wallet-1' };
    state.densFindFirstReturn = {
      id: 'den-1',
      ownerId: 'owner-1',
      name: 'Alpha Nest',
      emoji: '🏠',
      isPublic: true,
      strategy: 'steady',
      contractAddress: 'contract-1',
      apr: '4.80',
      totalDeposited: '0',
      memberCount: 0,
      createdAt: '2026-04-20T00:00:00.000Z',
    };

    const res = await createApp().request('/dens/den-1/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
      },
      body: JSON.stringify({ amountTon: '25.00000000' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.deposit.txParams.messages[0]).toMatchObject({
      address: 'contract-1',
      amount: 'prepared-25.00000000',
      payload: 'deposit-tonstakers',
    });
    expect(typeof body.data.deposit.confirmationToken).toBe('string');
    expect(state.insertCalls).toBe(0);
  });

  it('prepares withdraw transaction using live on-chain shares', async () => {
    state.jwtPayload = { userId: 'user-1', walletAddr: 'wallet-1' };
    state.userReturn = { id: 'user-1', walletAddr: 'wallet-1' };
    state.densFindFirstReturn = {
      id: 'den-1',
      ownerId: 'owner-1',
      name: 'Alpha Nest',
      emoji: '🏠',
      isPublic: true,
      strategy: 'steady',
      contractAddress: 'contract-1',
      apr: '4.80',
      totalDeposited: '0',
      memberCount: 0,
      createdAt: '2026-04-20T00:00:00.000Z',
    };
    state.snapshots.set('contract-1:wallet-1', createSnapshot({ sharesTon: '6.50000000', currentTon: '7.25000000' }));

    const res = await createApp().request('/dens/den-1/leave', {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.amount).toBe('7.25000000');
    expect(body.data.txParams.messages[0]).toMatchObject({
      address: 'contract-1',
      payload: 'withdraw-6.50000000',
    });
  });
});
