import { Address } from '@ton/core';
import { JettonMaster, TonClient } from '@ton/ton';
import { getNetworkEnv, getTonNetwork } from '../lib/ton-network.js';

type TonstakersPoolDecoded = {
  total_balance: number;
  projected_balance: number;
  supply: number;
  projected_supply: number;
  jetton_minter: string;
  current_nominators: number;
  interest_rate: number;
};

type TonstakersWalletDecoded = {
  balance: string;
};

let tonClient: TonClient | null = null;

function getTonClient() {
  if (!tonClient) {
    tonClient = new TonClient({
      endpoint: getNetworkEnv('TONCENTER_JSONRPC_URL') || (getTonNetwork() === 'mainnet' ? 'https://toncenter.com/api/v2/jsonRPC' : 'https://testnet.toncenter.com/api/v2/jsonRPC'),
      apiKey: getNetworkEnv('TONCENTER_API_KEY') || undefined,
    });
  }

  return tonClient;
}

function getTonApiBaseUrl() {
  return getNetworkEnv('TONAPI_BASE_URL') || (getTonNetwork() === 'mainnet' ? 'https://tonapi.io/v2' : 'https://testnet.tonapi.io/v2');
}

async function tonApiFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const apiKey = getNetworkEnv('TONAPI_API_KEY');
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${getTonApiBaseUrl()}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`TonAPI error ${response.status} for ${path}`);
  }

  return response.json() as Promise<T>;
}

export async function deriveTonstakersVaultJettonWallet(poolAddress: Address, vaultAddress: Address) {
  const client = getTonClient();
  const result = await tonApiFetch<{ decoded: TonstakersPoolDecoded }>(
    `/blockchain/accounts/${encodeURIComponent(poolAddress.toString())}/methods/get_pool_full_data`,
  );
  const jettonMaster = Address.parse(result.decoded.jetton_minter);
  const master = JettonMaster.create(jettonMaster);
  return await master.getWalletAddress(client.provider(jettonMaster), vaultAddress);
}

export async function getTonstakersPoolDecoded(poolAddress: Address) {
  const result = await tonApiFetch<{ decoded: TonstakersPoolDecoded }>(
    `/blockchain/accounts/${encodeURIComponent(poolAddress.toString())}/methods/get_pool_full_data`,
  );
  return result.decoded;
}

export async function getTonstakersJettonWalletBalance(walletAddress: Address) {
  const result = await tonApiFetch<{ decoded: TonstakersWalletDecoded }>(
    `/blockchain/accounts/${encodeURIComponent(walletAddress.toString())}/methods/get_wallet_data`,
  );
  return BigInt(result.decoded.balance || '0');
}

export function scaleTsTonToTon(tsTonBalance: bigint, poolBalance: bigint, supply: bigint) {
  if (tsTonBalance <= 0n || poolBalance <= 0n || supply <= 0n) {
    return 0n;
  }

  return (tsTonBalance * poolBalance) / supply;
}
