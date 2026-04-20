import { AsyncLocalStorage } from 'node:async_hooks';

export type TonNetwork = 'testnet' | 'mainnet';

const tonNetworkStorage = new AsyncLocalStorage<TonNetwork>();

export function normalizeTonNetwork(value?: string | null): TonNetwork {
  return value?.toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
}

export function getTonNetwork(): TonNetwork {
  return tonNetworkStorage.getStore() ?? normalizeTonNetwork(process.env.DEFAULT_TON_NETWORK);
}

export async function runWithTonNetwork<T>(network: TonNetwork, fn: () => Promise<T>): Promise<T> {
  return await tonNetworkStorage.run(network, fn);
}

export function getTonNetworkFromRequest(input?: string | null): TonNetwork {
  return normalizeTonNetwork(input);
}

export function getNetworkEnv(name: string, network = getTonNetwork()): string | undefined {
  const suffix = network === 'mainnet' ? 'MAINNET' : 'TESTNET';
  return process.env[`${name}_${suffix}`] ?? process.env[name];
}

export function getTonChainId(network = getTonNetwork()) {
  return network === 'mainnet' ? '-239' : '-3';
}
