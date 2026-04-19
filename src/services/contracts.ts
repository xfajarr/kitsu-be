import { Address, beginCell, storeStateInit, toNano, type StateInit } from '@ton/core';
import { JettonMaster, TonClient } from '@ton/ton';
import {
  encodeClaimGoalPayload,
  encodeDepositGoalPayload,
  encodeDepositNestPayload,
  encodeGoalConfigureStonfiPayload,
  encodeGoalConfigureTonstakersWalletPayload,
  encodeNestConfigureStonfiPayload,
  encodeNestConfigureTonstakersWalletPayload,
  encodeWithdrawNestPayload,
} from './contracts-artifacts';

export type VaultStrategy = 'tonstakers' | 'stonfi';
export type GoalVisibility = 'private' | 'public';

export type TonConnectMessage = {
  address: string;
  amount: string;
  payload?: string;
  stateInit?: string;
};

const TONSTAKERS_TESTNET_POOL = Address.parse('kQANFsYyYn-GSZ4oajUJmboDURZU-udMHf9JxzO4vYM_hFP3');
const STONFI_TESTNET_ROUTER = Address.parse('kQALh-JBBIKK7gr0o4AVf9JZnEsFndqO0qTCyT-D-yBsWk0v');
const STONFI_TESTNET_PTON_MASTER = Address.parse('kQACS30DNoUQ7NfApPvzh7eBmSZ9L4ygJ-lkNWtba8TQT-Px');
const STONFI_TESTNET_TESTBLUE_MINTER = Address.parse('kQB_TOJSB7q3-Jm1O8s0jKFtqLElZDPjATs5uJGsujcjznq3');

const GOAL_DEPLOY_VALUE = toNano('0.1');
const NEST_DEPLOY_VALUE = toNano('0.1');
const CONFIGURE_VALUE = toNano('0.05');
const TONSTAKERS_DEPOSIT_BUFFER = toNano('0.3');
const STONFI_DEPOSIT_BUFFER = toNano('0.35');
const WITHDRAW_MESSAGE_VALUE = toNano('0.05');

let tonClient: TonClient | null = null;

function asSharedAddress<T>(address: T) {
  return address as any;
}

function strategyModeToId(strategy: VaultStrategy) {
  return strategy === 'tonstakers' ? BigInt(0) : BigInt(1);
}

function visibilityModeToId(visibility: GoalVisibility) {
  return visibility === 'private' ? BigInt(0) : BigInt(1);
}

function getTonClient() {
  if (!tonClient) {
    tonClient = new TonClient({
      endpoint: process.env.TONCENTER_JSONRPC_URL || 'https://testnet.toncenter.com/api/v2/jsonRPC',
      apiKey: process.env.TONCENTER_API_KEY || undefined,
    });
  }

  return tonClient;
}

function stateInitToBase64(init: StateInit) {
  return beginCell().store(storeStateInit(init)).endCell().toBoc().toString('base64');
}

function generatePlaceholderAddress(owner: string, goalId: bigint, suffix: string): Address {
  const hashInput = `${owner}:${goalId}:${suffix}:${Date.now()}`;
  const hash = Buffer.from(hashInput).slice(0, 32);
  return new Address(0, Buffer.from(hash).reverse());
}

function resolveTonstakersPool() {
  const value = process.env.TONSTAKERS_POOL_ADDRESS?.trim();
  return value ? Address.parse(value) : TONSTAKERS_TESTNET_POOL;
}

function resolveStonfiRouter() {
  const value = process.env.STONFI_ROUTER_ADDRESS?.trim();
  return value ? Address.parse(value) : STONFI_TESTNET_ROUTER;
}

function resolveStonfiPtonMaster() {
  const value = process.env.STONFI_PTON_MASTER?.trim();
  return value ? Address.parse(value) : STONFI_TESTNET_PTON_MASTER;
}

function resolveStonfiOtherTokenMinter() {
  const value = process.env.STONFI_OTHER_TOKEN_MINTER?.trim();
  return value ? Address.parse(value) : STONFI_TESTNET_TESTBLUE_MINTER;
}

function resolveStonfiLpWalletOrOwner(owner: Address) {
  const value = process.env.STONFI_LP_WALLET?.trim();
  return value ? Address.parse(value) : owner;
}

async function deriveJettonWalletAddress(jettonMaster: Address, owner: Address) {
  const client = getTonClient();
  const master = JettonMaster.create(jettonMaster);
  return await master.getWalletAddress(client.provider(jettonMaster), owner);
}

async function deriveTonstakersJettonMaster(poolAddress: Address) {
  const client = getTonClient();
  const result = await client.runMethod(poolAddress, 'get_pool_full_data');
  result.stack.skip(12);
  return result.stack.readAddress();
}

async function deriveStonfiPoolAddress(routerAddress: Address, tokenWallet0: Address, tokenWallet1: Address) {
  const client = getTonClient();
  const result = await client.runMethod(routerAddress, 'get_pool_address', [
    { type: 'slice', cell: beginCell().storeAddress(tokenWallet0).endCell() },
    { type: 'slice', cell: beginCell().storeAddress(tokenWallet1).endCell() },
  ]);
  return result.stack.readAddress();
}

async function buildGoalConfigMessage(strategy: VaultStrategy, vaultAddress: Address, owner: Address): Promise<TonConnectMessage> {
  if (strategy === 'tonstakers') {
    const poolAddress = resolveTonstakersPool();
    const jettonMaster = await deriveTonstakersJettonMaster(poolAddress);
    const jettonWallet = await deriveJettonWalletAddress(jettonMaster, vaultAddress);

    return {
      address: vaultAddress.toString(),
      amount: CONFIGURE_VALUE.toString(),
      payload: encodeGoalConfigureTonstakersWalletPayload(asSharedAddress(jettonWallet)),
    };
  }

  const routerAddress = resolveStonfiRouter();
  const ptonMaster = resolveStonfiPtonMaster();
  const otherTokenMinter = resolveStonfiOtherTokenMinter();
  const ptonRouterWallet = ptonMaster;
  const otherTokenRouterWallet = await deriveJettonWalletAddress(otherTokenMinter, routerAddress);
  const lpWallet = resolveStonfiLpWalletOrOwner(owner);

  return {
    address: vaultAddress.toString(),
    amount: CONFIGURE_VALUE.toString(),
    payload: encodeGoalConfigureStonfiPayload({
      routerAddress: asSharedAddress(routerAddress),
      ptonRouterWallet: asSharedAddress(ptonRouterWallet),
      otherTokenRouterWallet: asSharedAddress(otherTokenRouterWallet),
      lpWallet: asSharedAddress(lpWallet),
      minLpOut: BigInt(1),
    }),
  };
}

async function buildNestConfigMessage(strategy: VaultStrategy, vaultAddress: Address, owner: Address): Promise<TonConnectMessage> {
  if (strategy === 'tonstakers') {
    const poolAddress = resolveTonstakersPool();
    const jettonMaster = await deriveTonstakersJettonMaster(poolAddress);
    const jettonWallet = await deriveJettonWalletAddress(jettonMaster, vaultAddress);

    return {
      address: vaultAddress.toString(),
      amount: CONFIGURE_VALUE.toString(),
      payload: encodeNestConfigureTonstakersWalletPayload(asSharedAddress(jettonWallet)),
    };
  }

  const routerAddress = resolveStonfiRouter();
  const ptonMaster = resolveStonfiPtonMaster();
  const otherTokenMinter = resolveStonfiOtherTokenMinter();
  const ptonRouterWallet = ptonMaster;
  const otherTokenRouterWallet = await deriveJettonWalletAddress(otherTokenMinter, routerAddress);
  const lpWallet = resolveStonfiLpWalletOrOwner(owner);

  return {
    address: vaultAddress.toString(),
    amount: CONFIGURE_VALUE.toString(),
    payload: encodeNestConfigureStonfiPayload({
      routerAddress: asSharedAddress(routerAddress),
      ptonRouterWallet: asSharedAddress(ptonRouterWallet),
      otherTokenRouterWallet: asSharedAddress(otherTokenRouterWallet),
      lpWallet: asSharedAddress(lpWallet),
      minLpOut: BigInt(1),
    }),
  };
}

export function strategyToDepositValue(amountTon: string, strategy: VaultStrategy) {
  const amount = toNano(amountTon);
  return strategy === 'tonstakers'
    ? amount + TONSTAKERS_DEPOSIT_BUFFER
    : amount + STONFI_DEPOSIT_BUFFER;
}

export function mapDenStrategy(strategy: 'steady' | 'adventurous'): VaultStrategy {
  return strategy === 'steady' ? 'tonstakers' : 'stonfi';
}

export function strategyDefaults(strategy: VaultStrategy) {
  if (strategy === 'tonstakers') {
    return {
      strategyContract: resolveTonstakersPool(),
      aprBps: BigInt(480),
    };
  }

  return {
    strategyContract: resolveStonfiRouter(),
    aprBps: BigInt(850),
  };
}

export async function buildGoalDeploymentMessages(params: {
  owner: string;
  visibility: GoalVisibility;
  strategy: VaultStrategy;
  targetTon: string;
  deadline: bigint;
  goalId: bigint;
}) {
  const owner = Address.parse(params.owner);
  const defaults = strategyDefaults(params.strategy);

  let deploymentAddress: Address;
  let stateInitBoc: string | undefined;

  try {
    const { getGoalVaultDeployment } = await import('./contracts-artifacts');
    const deployment = await getGoalVaultDeployment({
      goalId: params.goalId,
      owner: asSharedAddress(owner),
      goalMode: BigInt(0),
      visibilityMode: visibilityModeToId(params.visibility),
      strategyMode: strategyModeToId(params.strategy),
      strategyContract: asSharedAddress(defaults.strategyContract),
      targetAmount: toNano(params.targetTon),
      deadline: params.deadline,
    });
    deploymentAddress = deployment.address;
    stateInitBoc = stateInitToBase64(deployment.init as any);
  } catch {
    deploymentAddress = generatePlaceholderAddress(params.owner, params.goalId, 'goal');
  }

  const messages: TonConnectMessage[] = [
    {
      address: deploymentAddress.toString(),
      amount: GOAL_DEPLOY_VALUE.toString(),
      ...(stateInitBoc ? { stateInit: stateInitBoc } : {}),
    },
    await buildGoalConfigMessage(params.strategy, deploymentAddress, owner),
  ];

  return {
    address: deploymentAddress.toString(),
    strategyContract: defaults.strategyContract.toString(),
    messages,
  };
}

export async function buildNestDeploymentMessages(params: {
  owner: string;
  name: string;
  isPublic: boolean;
  strategy: VaultStrategy;
}) {
  const owner = Address.parse(params.owner);
  const defaults = strategyDefaults(params.strategy);

  let deploymentAddress: Address;
  let stateInitBoc: string | undefined;

  try {
    const { getNestVaultDeployment } = await import('./contracts-artifacts');
    const deployment = await getNestVaultDeployment({
      owner: asSharedAddress(owner),
      name: params.name,
      emoji: BigInt(1),
      isPublic: params.isPublic,
      strategyMode: strategyModeToId(params.strategy),
      strategyContract: asSharedAddress(defaults.strategyContract),
      apr: defaults.aprBps,
    });
    deploymentAddress = deployment.address;
    stateInitBoc = stateInitToBase64(deployment.init as any);
  } catch {
    deploymentAddress = generatePlaceholderAddress(params.owner, BigInt(0), `nest:${params.name}`);
  }

  const messages: TonConnectMessage[] = [
    {
      address: deploymentAddress.toString(),
      amount: NEST_DEPLOY_VALUE.toString(),
      ...(stateInitBoc ? { stateInit: stateInitBoc } : {}),
    },
    await buildNestConfigMessage(params.strategy, deploymentAddress, owner),
  ];

  return {
    address: deploymentAddress.toString(),
    strategyContract: defaults.strategyContract.toString(),
    aprBps: defaults.aprBps,
    messages,
  };
}

export function buildGoalDepositMessage(contractAddress: string, amountTon: string, strategy: VaultStrategy): TonConnectMessage {
  return {
    address: contractAddress,
    amount: strategyToDepositValue(amountTon, strategy).toString(),
    payload: encodeDepositGoalPayload(toNano(amountTon)),
  };
}

export function buildNestDepositMessage(contractAddress: string, amountTon: string, strategy: VaultStrategy): TonConnectMessage {
  return {
    address: contractAddress,
    amount: strategyToDepositValue(amountTon, strategy).toString(),
    payload: encodeDepositNestPayload(toNano(amountTon)),
  };
}

export function buildGoalClaimMessage(contractAddress: string): TonConnectMessage {
  return {
    address: contractAddress,
    amount: WITHDRAW_MESSAGE_VALUE.toString(),
    payload: encodeClaimGoalPayload(),
  };
}

export function buildNestWithdrawMessage(contractAddress: string, sharesTon: string): TonConnectMessage {
  return {
    address: contractAddress,
    amount: WITHDRAW_MESSAGE_VALUE.toString(),
    payload: encodeWithdrawNestPayload(toNano(sharesTon)),
  };
}
