import { Address } from '@ton/core';
import { JettonMaster, TonClient } from '@ton/ton';

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
      endpoint: process.env.TONCENTER_JSONRPC_URL || 'https://testnet.toncenter.com/api/v2/jsonRPC',
      apiKey: process.env.TONCENTER_API_KEY || undefined,
    });
  }

  return tonClient;
}

function getTonApiBaseUrl() {
  return process.env.TONAPI_BASE_URL || 'https://testnet.tonapi.io/v2';
}

async function tonApiFetch<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (process.env.TONAPI_API_KEY) {
    headers.Authorization = `Bearer ${process.env.TONAPI_API_KEY}`;
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
