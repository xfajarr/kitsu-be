// TonCenter API Service
// API V3: https://testnet.toncenter.com/api/v3/index.html
// API V2: https://testnet.toncenter.com/api/v2/

import { log } from '../lib/logger';

const TONCENTER_V2_URL = process.env.TONCENTER_V2_URL || 'https://testnet.toncenter.com/api/v2';
const TONCENTER_V3_URL = process.env.TONCENTER_V3_URL || 'https://testnet.toncenter.com/api/v3';
const API_KEY = process.env.TONCENTER_API_KEY || '';

interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
}

async function tonCenterFetch(endpoint: string, options: FetchOptions = {}) {
  const isV2 = endpoint.includes('/v2/') || endpoint.startsWith('/get') || endpoint.startsWith('/run');
  const baseUrl = isV2 ? TONCENTER_V2_URL : TONCENTER_V3_URL;
  const url = `${baseUrl}${endpoint}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }
  
  log.debug('TONCENTER', `Fetching ${url}`);
  
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  
  if (!response.ok) {
    log.error('TONCENTER', `API error: ${response.status}`, { endpoint, status: response.status });
    throw new Error(`TonCenter API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  log.debug('TONCENTER', 'Request successful', { endpoint });
  
  return data;
}

// V3 API - Better for indexed data, jettons, NFTs
export const TonCenterV3 = {
  async getAccountStates(addresses: string[]) {
    const addressList = addresses.join(',');
    return tonCenterFetch(`/accounts?addresses=${encodeURIComponent(addressList)}`);
  },
  
  async getJettonWallets(ownerAddress: string, limit = 100) {
    return tonCenterFetch(`/jetton/wallets?owner_address=${encodeURIComponent(ownerAddress)}&limit=${limit}`);
  },
  
  async getTransactions(params: {
    destination?: string;
    source?: string;
    limit?: number;
    offset?: number;
  }) {
    const queryParams = new URLSearchParams();
    if (params.destination) queryParams.set('destination', params.destination);
    if (params.source) queryParams.set('source', params.source);
    if (params.limit) queryParams.set('limit', params.limit.toString());
    if (params.offset) queryParams.set('offset', params.offset.toString());
    
    return tonCenterFetch(`/transactions?${queryParams.toString()}`);
  },
  
  async getJettonMasters(limit = 100) {
    return tonCenterFetch(`/jetton/masters?limit=${limit}`);
  },
  
  async getNftItems(ownerAddress: string, limit = 100) {
    return tonCenterFetch(`/nft/items?owner_address=${encodeURIComponent(ownerAddress)}&limit=${limit}`);
  },
  
  async getTrace(traceId: string) {
    return tonCenterFetch(`/traces?trace_id=${traceId}`);
  },
};

// V2 API - Better for real-time operations
export const TonCenterV2 = {
  async getAddressBalance(address: string) {
    return tonCenterFetch(`/getAddressBalance?address=${encodeURIComponent(address)}`);
  },
  
  async getAddressInformation(address: string) {
    return tonCenterFetch(`/getAddressInformation?address=${encodeURIComponent(address)}`);
  },
  
  async getWalletInformation(address: string) {
    return tonCenterFetch(`/getWalletInformation?address=${encodeURIComponent(address)}`);
  },
  
  async runGetMethod(address: string, method: string, stack: unknown[] = []) {
    return tonCenterFetch('/runGetMethod', {
      method: 'POST',
      body: { address, method, stack },
    });
  },
  
  async sendMessage(boc: string) {
    log.blockchain('Sending message', { bocLength: boc.length });
    return tonCenterFetch('/sendBoc', {
      method: 'POST',
      body: { boc },
    });
  },
  
  async estimateFee(address: string, body: Record<string, unknown>) {
    return tonCenterFetch('/estimateFee', {
      method: 'POST',
      body: { address, body, ignore_chksig: true },
    });
  },
  
  async detectAddress(address: string) {
    return tonCenterFetch(`/detectAddress?address=${encodeURIComponent(address)}`);
  },
  
  async getTransactions(address: string, limit = 20, lt?: string, hash?: string) {
    let endpoint = `/getTransactions?address=${encodeURIComponent(address)}&limit=${limit}`;
    if (lt && hash) {
      endpoint += `&lt=${lt}&hash=${hash}`;
    }
    return tonCenterFetch(endpoint);
  },
};

export class TonCenterService {
  v3 = TonCenterV3;
  v2 = TonCenterV2;
  
  // Combined helpers
  async getFullAccountInfo(address: string) {
    log.blockchain('Fetching full account info', { address });
    
    const [balanceResult, walletResult, jettonsResult] = await Promise.allSettled([
      this.v2.getAddressBalance(address),
      this.v2.getWalletInformation(address),
      this.v3.getJettonWallets(address),
    ]);
    
    const balance = balanceResult.status === 'fulfilled' ? balanceResult.value.result : '0';
    const wallet = walletResult.status === 'fulfilled' ? walletResult.value.result : null;
    const jettons = jettonsResult.status === 'fulfilled' ? jettonsResult.value.jetton_wallets : [];
    
    return {
      balance,
      wallet,
      jettons,
    };
  }
  
  async getTokenBalances(address: string) {
    const jettonsResult = await this.v3.getJettonWallets(address);
    return jettonsResult.jetton_wallets || [];
  }
  
  async getTransactionHistory(address: string, limit = 50) {
    const result = await this.v2.getTransactions(address, limit);
    return result.result || [];
  }
}

export const tonCenter = new TonCenterService();
