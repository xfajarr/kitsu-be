import { Address, beginCell, storeStateInit, toNano, type StateInit } from '@ton/core';
import { JettonMaster, TonClient } from '@ton/ton';
import {
  encodeDepositGoalPayload,
  encodeDepositNestPayload,
  encodeGoalConfigureStonfiPayload,
  encodeGoalConfigureTonstakersWalletPayload,
  encodeNestConfigureStonfiPayload,
  encodeNestConfigureTonstakersWalletPayload,
  getGoalVaultDeployment,
  getNestVaultDeployment,
} from '../../../kitsu-contracts/scripts/integrationPayloads';

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
const TONSTAKERS_DEPOSIT_BUFFER = toNano('1.05');
const STONFI_DEPOSIT_BUFFER = toNano('0.9');

let tonClient: TonClient | null = null;

function asSharedAddress<T>(address: T) {
  return address as any;
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

async function buildGoalConfigMessage(strategy: VaultStrategy, vaultAddress: Address): Promise<TonConnectMessage> {
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
  const ptonRouterWallet = await deriveJettonWalletAddress(ptonMaster, routerAddress);
  const otherTokenRouterWallet = await deriveJettonWalletAddress(otherTokenMinter, routerAddress);
  const poolAddress = await deriveStonfiPoolAddress(routerAddress, ptonRouterWallet, otherTokenRouterWallet);
  const lpWallet = await deriveJettonWalletAddress(poolAddress, vaultAddress);

  return {
    address: vaultAddress.toString(),
    amount: CONFIGURE_VALUE.toString(),
    payload: encodeGoalConfigureStonfiPayload({
      routerAddress: asSharedAddress(routerAddress),
      ptonRouterWallet: asSharedAddress(ptonRouterWallet),
      otherTokenRouterWallet: asSharedAddress(otherTokenRouterWallet),
      lpWallet: asSharedAddress(lpWallet),
      minLpOut: 1n,
    }),
  };
}

async function buildNestConfigMessage(strategy: VaultStrategy, vaultAddress: Address): Promise<TonConnectMessage> {
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
  const ptonRouterWallet = await deriveJettonWalletAddress(ptonMaster, routerAddress);
  const otherTokenRouterWallet = await deriveJettonWalletAddress(otherTokenMinter, routerAddress);
  const poolAddress = await deriveStonfiPoolAddress(routerAddress, ptonRouterWallet, otherTokenRouterWallet);
  const lpWallet = await deriveJettonWalletAddress(poolAddress, vaultAddress);

  return {
    address: vaultAddress.toString(),
    amount: CONFIGURE_VALUE.toString(),
    payload: encodeNestConfigureStonfiPayload({
      routerAddress: asSharedAddress(routerAddress),
      ptonRouterWallet: asSharedAddress(ptonRouterWallet),
      otherTokenRouterWallet: asSharedAddress(otherTokenRouterWallet),
      lpWallet: asSharedAddress(lpWallet),
      minLpOut: 1n,
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
      aprBps: 480n,
    };
  }

  return {
    strategyContract: resolveStonfiRouter(),
    aprBps: 850n,
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
  const deployment = await getGoalVaultDeployment({
    goalId: params.goalId,
    owner: asSharedAddress(owner),
    goalMode: 'personal',
    visibilityMode: params.visibility,
    strategyMode: params.strategy,
    strategyContract: asSharedAddress(defaults.strategyContract),
    targetAmount: toNano(params.targetTon),
    deadline: params.deadline,
  });

  const messages: TonConnectMessage[] = [
    {
      address: deployment.address.toString(),
      amount: GOAL_DEPLOY_VALUE.toString(),
      stateInit: stateInitToBase64(deployment.init as any),
    },
    await buildGoalConfigMessage(params.strategy, Address.parse(deployment.address.toString())),
  ];

  return {
    address: deployment.address.toString(),
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
  const deployment = await getNestVaultDeployment({
    owner: asSharedAddress(owner),
    name: params.name,
    emoji: 1n,
    isPublic: params.isPublic,
    strategyMode: params.strategy,
    strategyContract: asSharedAddress(defaults.strategyContract),
    apr: defaults.aprBps,
  });

  const messages: TonConnectMessage[] = [
    {
      address: deployment.address.toString(),
      amount: NEST_DEPLOY_VALUE.toString(),
      stateInit: stateInitToBase64(deployment.init as any),
    },
    await buildNestConfigMessage(params.strategy, Address.parse(deployment.address.toString())),
  ];

  return {
    address: deployment.address.toString(),
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
