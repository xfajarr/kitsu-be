import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Hono } from 'hono';
import { goals, users } from '../db/schema';
import { errorHandler, notFoundHandler } from '../middleware/error';

type GoalRecord = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  emoji: string | null;
  visibility: 'private' | 'public';
  strategy: 'tonstakers' | 'stonfi';
  contractAddress: string | null;
  targetTon: string;
  currentTon: string;
  targetUsd: string;
  currentUsd: string;
  dueDate: string | null;
  isArchived: boolean;
  createdAt: string;
};

const state = {
  jwtPayload: null as { userId: string; walletAddr: string } | null,
  userReturn: null as { id: string; walletAddr: string } | null,
  goalFindFirstReturn: null as GoalRecord | null,
  goalFindManyReturn: [] as GoalRecord[],
  insertedGoal: null as GoalRecord | null,
  lastInsertedValues: null as Record<string, unknown> | null,
  deploymentMessages: [{ address: 'factory-1', amount: '100000000', payload: 'deploy-goal' }],
  configureMessages: [{ address: 'goal-vault-1', amount: '50000000', payload: 'configure-goal' }],
  goalSnapshot: null as any,
  addressInformationState: 'active',
};

mock.module('../db', () => ({
  db: {
    query: {
      users: {
        findFirst: async () => state.userReturn,
      },
      goals: {
        findFirst: async () => state.goalFindFirstReturn,
        findMany: async () => state.goalFindManyReturn,
      },
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.lastInsertedValues = values;
        return { returning: async () => state.insertedGoal ? [state.insertedGoal] : [] };
      },
    }),
    update: () => ({
      set: () => ({ where: async () => [], returning: async () => [] }),
    }),
  },
  users,
  goals,
}));

mock.module('../lib/jwt', () => ({
  jwtService: {
    verifyToken: async () => state.jwtPayload,
  },
}));

mock.module('../services/prices', () => ({
  priceService: {
    tonToUsd: async () => 5,
  },
}));

mock.module('../services/contracts', () => ({
  buildGoalDeploymentMessages: async () => ({
    address: 'goal-vault-1',
    goalId: 1n,
    factoryAddress: 'factory-1',
    strategyContract: 'pool-1',
    messages: state.deploymentMessages,
  }),
  buildGoalConfigureMessage: async () => ({
    goalAddress: 'goal-vault-1',
    txParams: { messages: state.configureMessages },
  }),
  buildGoalDepositMessage: (contractAddress: string, amountTon: string) => ({
    address: contractAddress,
    amount: amountTon,
    payload: 'deposit-goal',
  }),
  buildGoalClaimMessage: (contractAddress: string) => ({
    address: contractAddress,
    amount: '0.05',
    payload: 'claim-goal',
  }),
  buildGoalSyncYieldMessage: (contractAddress: string, amount: string) => ({
    address: contractAddress,
    amount: '0.05',
    payload: `sync-${amount}`,
  }),
  buildGoalTonstakersUnstakeMessage: (contractAddress: string, amount: string, mode: string) => ({
    address: contractAddress,
    amount: '0.05',
    payload: `unwind-${amount}-${mode}`,
  }),
  buildNestDeploymentMessages: async () => ({ address: 'nest-1', strategyContract: 'pool-1', aprBps: 480n, messages: [] }),
  buildNestDepositMessage: (contractAddress: string, amountTon: string) => ({ address: contractAddress, amount: amountTon, payload: 'deposit-nest' }),
  buildNestWithdrawMessage: (contractAddress: string, amount: string) => ({ address: contractAddress, amount: '0.05', payload: `withdraw-${amount}` }),
  buildNestSyncYieldMessage: (contractAddress: string, amount: string) => ({ address: contractAddress, amount: '0.05', payload: `sync-nest-${amount}` }),
  buildNestTonstakersUnstakeMessage: (contractAddress: string, amount: string, mode: string) => ({ address: contractAddress, amount: '0.05', payload: `unwind-nest-${amount}-${mode}` }),
  mapDenStrategy: () => 'tonstakers',
  strategyDefaults: () => ({ strategyContract: { toString: () => 'pool-1' }, aprBps: 480n }),
}));

mock.module('../services/vaults', () => ({
  getNestOnchainSnapshotSafe: async () => null,
  getGoalOnchainSnapshotSafe: async () => state.goalSnapshot,
}));

mock.module('../services/toncenter', () => ({
  tonCenter: {
    v2: {
      getAddressInformation: async () => ({ result: { state: state.addressInformationState } }),
    },
  },
}));

mock.module('../lib/logger', () => ({
  log: { api: () => {}, warn: () => {}, error: () => {} },
}));

const { goalRoutes } = await import('./goals');

function createApp() {
  const app = new Hono();
  app.route('/goals', goalRoutes);
  app.notFound(notFoundHandler);
  app.onError(errorHandler);
  return app;
}

describe('goal routes', () => {
  beforeEach(() => {
    state.jwtPayload = null;
    state.userReturn = null;
    state.goalFindFirstReturn = null;
    state.goalFindManyReturn = [];
    state.insertedGoal = null;
    state.lastInsertedValues = null;
    state.goalSnapshot = null;
    state.addressInformationState = 'active';
  });

  it('creates goals via factory deployment flow and marks post-deploy config required', async () => {
    state.jwtPayload = { userId: 'user-1', walletAddr: 'wallet-1' };
    state.userReturn = { id: 'user-1', walletAddr: 'wallet-1' };
    state.insertedGoal = {
      id: 'goal-1',
      userId: 'user-1',
      title: 'New Laptop',
      description: null,
      emoji: '🎯',
      visibility: 'public',
      strategy: 'tonstakers',
      contractAddress: 'goal-vault-1',
      targetTon: '10.00000000',
      currentTon: '0',
      targetUsd: '50.00',
      currentUsd: '0',
      dueDate: null,
      isArchived: false,
      createdAt: '2026-04-20T00:00:00.000Z',
    };

    const res = await createApp().request('/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ title: 'New Laptop', targetTon: '10.00000000', visibility: 'public', strategy: 'tonstakers' }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.txParams.messages).toEqual(state.deploymentMessages);
    expect(body.data.configureAfterDeploy).toBe(true);
    expect(state.lastInsertedValues).toMatchObject({ contractAddress: 'goal-vault-1', strategy: 'tonstakers' });
  });

  it('returns follow-up configuration tx after the factory deployment is active', async () => {
    state.jwtPayload = { userId: 'user-1', walletAddr: 'wallet-1' };
    state.userReturn = { id: 'user-1', walletAddr: 'wallet-1' };
    state.goalFindFirstReturn = {
      id: 'goal-1',
      userId: 'user-1',
      title: 'Goal',
      description: null,
      emoji: null,
      visibility: 'public',
      strategy: 'tonstakers',
      contractAddress: 'goal-vault-1',
      targetTon: '10.00000000',
      currentTon: '0',
      targetUsd: '50.00',
      currentUsd: '0',
      dueDate: null,
      isArchived: false,
      createdAt: '2026-04-20T00:00:00.000Z',
    };

    const res = await createApp().request('/goals/goal-1/configure', {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.configure.txParams.messages).toEqual(state.configureMessages);
  });

  it('allows deposits into public goals even when requester is not the owner', async () => {
    state.jwtPayload = { userId: 'user-2', walletAddr: 'wallet-2' };
    state.goalFindFirstReturn = {
      id: 'goal-1',
      userId: 'user-1',
      title: 'Goal',
      description: null,
      emoji: null,
      visibility: 'public',
      strategy: 'tonstakers',
      contractAddress: 'goal-vault-1',
      targetTon: '10.00000000',
      currentTon: '0',
      targetUsd: '50.00',
      currentUsd: '0',
      dueDate: null,
      isArchived: false,
      createdAt: '2026-04-20T00:00:00.000Z',
    };

    const res = await createApp().request('/goals/goal-1/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ amountTon: '2.00000000' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.deposit.txParams.messages[0]).toMatchObject({ address: 'goal-vault-1', payload: 'deposit-goal' });
  });

  it('builds TonStakers unwind tx for goal owners when tsTON exists', async () => {
    state.jwtPayload = { userId: 'user-1', walletAddr: 'wallet-1' };
    state.userReturn = { id: 'user-1', walletAddr: 'wallet-1' };
    state.goalFindFirstReturn = {
      id: 'goal-1',
      userId: 'user-1',
      title: 'Goal',
      description: null,
      emoji: null,
      visibility: 'public',
      strategy: 'tonstakers',
      contractAddress: 'goal-vault-1',
      targetTon: '10.00000000',
      currentTon: '0',
      targetUsd: '50.00',
      currentUsd: '0',
      dueDate: null,
      isArchived: false,
      createdAt: '2026-04-20T00:00:00.000Z',
    };
    state.goalSnapshot = {
      strategy: 'tonstakers',
      tsTonBalance: '5.00000000',
    };

    const res = await createApp().request('/goals/goal-1/unwind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ mode: 'best-rate' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.unwind.txParams.messages[0]).toMatchObject({ payload: 'unwind-5.00000000-best-rate' });
  });
});
