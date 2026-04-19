import { Address, TupleBuilder, fromNano } from '@ton/core';
import { TonClient } from '@ton/ton';
import { log } from '../lib/logger';
import { tonCenter } from './toncenter';
import { deriveTonstakersVaultJettonWallet, getTonstakersJettonWalletBalance, getTonstakersPoolDecoded, scaleTsTonToTon } from './tonstakers';

export type GoalOnchainSnapshot = {
  targetTon: string;
  strategy: 'tonstakers' | 'stonfi';
  strategyContract: string;
  totalPrincipalTon: string;
  vaultValueTon: string;
  totalYieldTon: string;
  currentTon: string;
  principalTon: string;
  sharesTon: string;
  yieldTon: string;
  canClaim: boolean;
  canUnwind: boolean;
  isActive: boolean;
  memberCount: number;
  lastStrategySyncTime: string;
  liquidTonBalance: string;
  tsTonBalance?: string;
  projectedVaultValueTon?: string;
  syncYieldTon?: string;
  isLiveValue: boolean;
};

export type NestOnchainSnapshot = {
  strategy: 'tonstakers' | 'stonfi';
  strategyContract: string;
  totalPrincipalTon: string;
  vaultValueTon: string;
  totalYieldTon: string;
  currentTon: string;
  principalTon: string;
  sharesTon: string;
  yieldTon: string;
  canWithdraw: boolean;
  canUnwind: boolean;
  isActive: boolean;
  memberCount: number;
  lastStrategySyncTime: string;
  liquidTonBalance: string;
  tsTonBalance?: string;
  projectedVaultValueTon?: string;
  syncYieldTon?: string;
  isLiveValue: boolean;
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

async function getLiquidTonBalance(contractAddress: string) {
  const result = await tonCenter.v2.getAddressBalance(contractAddress);
  return BigInt(result.result || '0');
}

async function getTonstakersLiveValue(params: {
  contractAddress: string;
  strategyContract: Address;
}) {
  const contractAddress = Address.parse(params.contractAddress);
  const liquidBalance = await getLiquidTonBalance(params.contractAddress);
  const poolData = await getTonstakersPoolDecoded(params.strategyContract);
  const jettonWallet = await deriveTonstakersVaultJettonWallet(params.strategyContract, contractAddress);
  const tsTonBalance = await getTonstakersJettonWalletBalance(jettonWallet);
  const currentVaultValue = liquidBalance + scaleTsTonToTon(tsTonBalance, BigInt(poolData.total_balance), BigInt(poolData.supply));
  const projectedVaultValue = liquidBalance + scaleTsTonToTon(tsTonBalance, BigInt(poolData.projected_balance), BigInt(poolData.projected_supply));

  return {
    liquidBalance,
    tsTonBalance,
    currentVaultValue,
    projectedVaultValue,
  };
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
  const strategyMode = goalInfoStack.readBigNumber();
  const strategyContract = goalInfoStack.readAddress();
  const targetAmount = goalInfoStack.readBigNumber();
  const deadline = goalInfoStack.readBigNumber();
  const isActive = goalInfoStack.readBoolean();
  const totalShares = goalInfoStack.readBigNumber();
  const totalPrincipal = goalInfoStack.readBigNumber();
  const memberCount = goalInfoStack.readBigNumber();
  const contractVaultValue = goalInfoStack.readBigNumber();
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

  const liquidBalance = await getLiquidTonBalance(contractAddress);
  let vaultValue = contractVaultValue;
  let currentValueForUser = currentValue;
  let canClaimNow = canClaim;
  let tsTonBalance: bigint | null = null;
  let projectedVaultValue: bigint | null = null;
  let isLiveValue = false;

  if (strategyMode === 0n) {
    const live = await getTonstakersLiveValue({
      contractAddress,
      strategyContract,
    });
    tsTonBalance = live.tsTonBalance;
    projectedVaultValue = live.projectedVaultValue;
    vaultValue = live.currentVaultValue;
    if (shares > 0n && totalShares > 0n) {
      currentValueForUser = (vaultValue * shares) / totalShares;
    } else {
      currentValueForUser = 0n;
    }
    const canSettleLive = !isActive || (deadline > 0n && deadline < BigInt(Math.floor(Date.now() / 1000))) || vaultValue >= targetAmount;
    canClaimNow = shares > 0n && canSettleLive && liquidBalance >= currentValueForUser;
    isLiveValue = true;
  }

  return {
    targetTon: toTonString(targetAmount),
    strategy: strategyMode === 0n ? 'tonstakers' : 'stonfi',
    strategyContract: strategyContract.toString(),
    totalPrincipalTon: toTonString(totalPrincipal),
    vaultValueTon: toTonString(vaultValue),
    totalYieldTon: toTonDeltaString(vaultValue - totalPrincipal),
    currentTon: toTonString(currentValueForUser),
    principalTon: toTonString(principal),
    sharesTon: toTonString(shares),
    yieldTon: toTonDeltaString(currentValueForUser - principal),
    canClaim: canClaimNow,
    canUnwind: strategyMode === 0n && (tsTonBalance ?? 0n) > 0n,
    isActive,
    memberCount: Number(memberCount),
    lastStrategySyncTime: toIsoTimestamp(lastStrategySyncTime) || '',
    liquidTonBalance: toTonString(liquidBalance),
    ...(tsTonBalance !== null ? { tsTonBalance: toTonString(tsTonBalance) } : {}),
    ...(projectedVaultValue !== null ? { projectedVaultValueTon: toTonString(projectedVaultValue) } : {}),
    ...(vaultValue > contractVaultValue ? { syncYieldTon: toTonDeltaString(vaultValue - contractVaultValue) } : {}),
    isLiveValue,
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
  const strategyMode = nestInfoStack.readBigNumber();
  const strategyContract = nestInfoStack.readAddress();
  nestInfoStack.readBigNumber();
  const totalShares = nestInfoStack.readBigNumber();
  const totalPrincipal = nestInfoStack.readBigNumber();
  const memberCount = nestInfoStack.readBigNumber();
  const isActive = nestInfoStack.readBoolean();
  const contractVaultValue = nestInfoStack.readBigNumber();
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

  const liquidBalance = await getLiquidTonBalance(contractAddress);
  let vaultValue = contractVaultValue;
  let currentValueForUser = currentValue;
  let tsTonBalance: bigint | null = null;
  let projectedVaultValue: bigint | null = null;
  let isLiveValue = false;

  if (strategyMode === 0n) {
    const live = await getTonstakersLiveValue({
      contractAddress,
      strategyContract,
    });
    tsTonBalance = live.tsTonBalance;
    projectedVaultValue = live.projectedVaultValue;
    vaultValue = live.currentVaultValue;
    if (shares > 0n && totalShares > 0n) {
      currentValueForUser = (vaultValue * shares) / totalShares;
    } else {
      currentValueForUser = 0n;
    }
    isLiveValue = true;
  }

  return {
    strategy: strategyMode === 0n ? 'tonstakers' : 'stonfi',
    strategyContract: strategyContract.toString(),
    totalPrincipalTon: toTonString(totalPrincipal),
    vaultValueTon: toTonString(vaultValue),
    totalYieldTon: toTonDeltaString(vaultValue - totalPrincipal),
    currentTon: toTonString(currentValueForUser),
    principalTon: toTonString(principal),
    sharesTon: toTonString(shares),
    yieldTon: toTonDeltaString(currentValueForUser - principal),
    canWithdraw: shares > 0n && liquidBalance >= currentValueForUser,
    canUnwind: strategyMode === 0n && (tsTonBalance ?? 0n) > 0n,
    isActive,
    memberCount: Number(memberCount),
    lastStrategySyncTime: toIsoTimestamp(lastStrategySyncTime) || '',
    liquidTonBalance: toTonString(liquidBalance),
    ...(tsTonBalance !== null ? { tsTonBalance: toTonString(tsTonBalance) } : {}),
    ...(projectedVaultValue !== null ? { projectedVaultValueTon: toTonString(projectedVaultValue) } : {}),
    ...(vaultValue > contractVaultValue ? { syncYieldTon: toTonDeltaString(vaultValue - contractVaultValue) } : {}),
    isLiveValue,
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
