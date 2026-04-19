import { Address, TupleBuilder, fromNano } from '@ton/core';
import { TonClient } from '@ton/ton';
import { log } from '../lib/logger';

export type GoalOnchainSnapshot = {
  targetTon: string;
  totalPrincipalTon: string;
  vaultValueTon: string;
  totalYieldTon: string;
  currentTon: string;
  principalTon: string;
  sharesTon: string;
  yieldTon: string;
  canClaim: boolean;
  isActive: boolean;
  memberCount: number;
  lastStrategySyncTime: string;
};

export type NestOnchainSnapshot = {
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

let tonClient: TonClient | null = null;

function getTonClient() {
  if (!tonClient) {
    tonClient = new TonClient({
      endpoint: process.env.TONCENTER_JSONRPC_URL || 'https://testnet.toncenter.com/api/v2/jsonRPC',
      apiKey: process.env.TONCENTER_API_KEY || undefined,
    });
  }

  return tonClient;
}

function toTonString(value: bigint) {
  return fromNano(value);
}

function toTonDeltaString(value: bigint) {
  if (value < 0n) {
    return `-${fromNano(-value)}`;
  }
  return fromNano(value);
}

function toIsoTimestamp(value: bigint) {
  if (value <= 0n) {
    return null;
  }

  return new Date(Number(value) * 1000).toISOString();
}

export async function getGoalOnchainSnapshot(contractAddress: string, walletAddress?: string): Promise<GoalOnchainSnapshot> {
  const client = getTonClient();
  const contract = Address.parse(contractAddress);
  const provider = client.provider(contract);

  const goalInfoStack = (await provider.get('getGoalInfo', new TupleBuilder().build())).stack;
  goalInfoStack.readBigNumber();
  goalInfoStack.readAddress();
  goalInfoStack.readBigNumber();
  goalInfoStack.readBigNumber();
  goalInfoStack.readBigNumber();
  goalInfoStack.readAddress();
  const targetAmount = goalInfoStack.readBigNumber();
  goalInfoStack.readBigNumber();
  const isActive = goalInfoStack.readBoolean();
  goalInfoStack.readBigNumber();
  const totalPrincipal = goalInfoStack.readBigNumber();
  const memberCount = goalInfoStack.readBigNumber();
  const vaultValue = goalInfoStack.readBigNumber();
  const lastStrategySyncTime = goalInfoStack.readBigNumber();

  let shares = 0n;
  let principal = 0n;
  let currentValue = 0n;
  let canClaim = false;

  if (walletAddress) {
    const memberArgs = new TupleBuilder();
    memberArgs.writeAddress(Address.parse(walletAddress));
    const positionStack = (await provider.get('getMemberPosition', memberArgs.build())).stack;
    shares = positionStack.readBigNumber();
    principal = positionStack.readBigNumber();
    currentValue = positionStack.readBigNumber();
    canClaim = positionStack.readBoolean();
  }

  return {
    targetTon: toTonString(targetAmount),
    totalPrincipalTon: toTonString(totalPrincipal),
    vaultValueTon: toTonString(vaultValue),
    totalYieldTon: toTonDeltaString(vaultValue - totalPrincipal),
    currentTon: toTonString(currentValue),
    principalTon: toTonString(principal),
    sharesTon: toTonString(shares),
    yieldTon: toTonDeltaString(currentValue - principal),
    canClaim,
    isActive,
    memberCount: Number(memberCount),
    lastStrategySyncTime: toIsoTimestamp(lastStrategySyncTime) || '',
  };
}

export async function getNestOnchainSnapshot(contractAddress: string, walletAddress?: string): Promise<NestOnchainSnapshot> {
  const client = getTonClient();
  const contract = Address.parse(contractAddress);
  const provider = client.provider(contract);

  const nestInfoStack = (await provider.get('getNestInfo', new TupleBuilder().build())).stack;
  nestInfoStack.readAddress();
  nestInfoStack.readCell();
  nestInfoStack.readBigNumber();
  nestInfoStack.readBoolean();
  nestInfoStack.readBigNumber();
  nestInfoStack.readAddress();
  nestInfoStack.readBigNumber();
  nestInfoStack.readBigNumber();
  const totalPrincipal = nestInfoStack.readBigNumber();
  const memberCount = nestInfoStack.readBigNumber();
  const isActive = nestInfoStack.readBoolean();
  const vaultValue = nestInfoStack.readBigNumber();
  const lastStrategySyncTime = nestInfoStack.readBigNumber();

  let shares = 0n;
  let principal = 0n;
  let currentValue = 0n;

  if (walletAddress) {
    const memberArgs = new TupleBuilder();
    memberArgs.writeAddress(Address.parse(walletAddress));
    const positionStack = (await provider.get('getMemberPosition', memberArgs.build())).stack;
    shares = positionStack.readBigNumber();
    principal = positionStack.readBigNumber();
    currentValue = positionStack.readBigNumber();
  }

  return {
    totalPrincipalTon: toTonString(totalPrincipal),
    vaultValueTon: toTonString(vaultValue),
    totalYieldTon: toTonDeltaString(vaultValue - totalPrincipal),
    currentTon: toTonString(currentValue),
    principalTon: toTonString(principal),
    sharesTon: toTonString(shares),
    yieldTon: toTonDeltaString(currentValue - principal),
    canWithdraw: shares > 0n,
    isActive,
    memberCount: Number(memberCount),
    lastStrategySyncTime: toIsoTimestamp(lastStrategySyncTime) || '',
  };
}

export async function getGoalOnchainSnapshotSafe(contractAddress: string, walletAddress?: string) {
  try {
    return await getGoalOnchainSnapshot(contractAddress, walletAddress);
  } catch (error) {
    log.warn('VAULTS', 'Failed to fetch goal snapshot', { contractAddress, walletAddress, error: error instanceof Error ? error.message : error });
    return null;
  }
}

export async function getNestOnchainSnapshotSafe(contractAddress: string, walletAddress?: string) {
  try {
    return await getNestOnchainSnapshot(contractAddress, walletAddress);
  } catch (error) {
    log.warn('VAULTS', 'Failed to fetch nest snapshot', { contractAddress, walletAddress, error: error instanceof Error ? error.message : error });
    return null;
  }
}
