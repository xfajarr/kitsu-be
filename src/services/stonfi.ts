import { Address, Cell, beginCell, storeMessage } from '@ton/ton';
import { TonClient } from '@ton/ton';
import WebSocketNode from 'ws';
import { getNetworkEnv, getTonChainId, getTonNetwork, type TonNetwork } from '../lib/ton-network.js';
import { tonCenter } from './toncenter.js';

/** Browser and Node 22+ expose WebSocket; Vercel Node 20 does not — use `ws` package. */
function createOmnistonWebSocket(url: string) {
  if (typeof globalThis.WebSocket === 'function') {
    return new globalThis.WebSocket(url) as unknown as WebSocketNode;
  }
  return new WebSocketNode(url);
}

export type StonfiToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  kind: 'ton' | 'jetton';
  network: TonNetwork;
};

export type StonfiQuote = {
  quoteId: string;
  resolverId: string;
  resolverName: string;
  offerToken: StonfiToken;
  askToken: StonfiToken;
  offerUnits: string;
  askUnits: string;
  offerDisplay: string;
  askDisplay: string;
  protocolFeeUnits: string;
  referrerFeeUnits: string;
  rawQuote: unknown;
};

export type StonfiPool = {
  id: string;
  network: TonNetwork;
  token0: StonfiToken;
  token1: StonfiToken;
  label: string;
  kind: 'swap-pair';
};

export type StonfiWalletAsset = {
  token: StonfiToken;
  balanceUnits: string;
  balanceDisplay: string;
};

type StonfiDexAssetRow = {
  contract_address: string;
  symbol: string;
  display_name: string;
  decimals: number;
  kind: string;
};

const DEX_ASSETS_CACHE_MS = 60_000;
const dexAssetsCache: Partial<Record<TonNetwork, { at: number; tokens: StonfiToken[] }>> = {};

function getStonfiDexApiRoot(network: TonNetwork): string {
  const fromEnv = getNetworkEnv('STONFI_API_URL', network);
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  return 'https://api.ston.fi';
}

function mapDexRowToToken(row: StonfiDexAssetRow, network: TonNetwork): StonfiToken {
  const kind = row.kind?.toLowerCase() === 'ton' ? 'ton' : 'jetton';
  return {
    symbol: row.symbol,
    name: row.display_name,
    address: row.contract_address,
    decimals: row.decimals,
    kind,
    network,
  };
}

/** Full token catalog from STON.fi DEX HTTP API (`GET /v1/assets`). Cached ~60s. */
export async function fetchStonfiDexAssets(network = getTonNetwork()): Promise<StonfiToken[]> {
  const cached = dexAssetsCache[network];
  if (cached && Date.now() - cached.at < DEX_ASSETS_CACHE_MS) {
    return cached.tokens;
  }

  const root = getStonfiDexApiRoot(network);
  const res = await fetch(`${root}/v1/assets`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`STON.fi DEX assets request failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { asset_list?: StonfiDexAssetRow[] };
  const rows = Array.isArray(body.asset_list) ? body.asset_list : [];
  const tokens = rows.map((row) => mapDexRowToToken(row, network));
  dexAssetsCache[network] = { at: Date.now(), tokens };
  return tokens;
}

const OMNISTON_CONFIG = {
  mainnet: {
    apiUrl: 'wss://omni-ws.ston.fi',
    rpcUrl: 'https://toncenter.com/api/v2/jsonRPC',
  },
  testnet: {
    apiUrl: 'wss://omni-ws-sandbox.ston.fi',
    rpcUrl: 'https://testnet.toncenter.com/api/v2/jsonRPC',
  },
} as const;

function getRpcUrl(network = getTonNetwork()) {
  return OMNISTON_CONFIG[network].rpcUrl;
}

export async function getStonfiConfig(network = getTonNetwork()) {
  const tokens = await fetchStonfiDexAssets(network);
  return {
    network,
    chainId: getTonChainId(network) as '-3' | '-239',
    tokens,
    omnistonApiUrl: OMNISTON_CONFIG[network].apiUrl,
    supported: {
      quote: true,
      buildTransfer: true,
      trackTrade: true,
      widget: true,
    },
  };
}

export async function getStonfiPools(network = getTonNetwork()) {
  const root = getStonfiDexApiRoot(network);
  const res = await fetch(`${root}/v1/markets`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`STON.fi DEX markets request failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { pairs?: [string, string][] };
  const pairs = Array.isArray(body.pairs) ? body.pairs : [];
  const assets = await fetchStonfiDexAssets(network);
  const byAddress = new Map(assets.map((t) => [t.address, t]));

  const pools: StonfiPool[] = [];
  for (let i = 0; i < pairs.length; i += 1) {
    const [a, b] = pairs[i]!;
    const token0 = byAddress.get(a);
    const token1 = byAddress.get(b);
    if (!token0 || !token1) {
      continue;
    }
    pools.push({
      id: `${network}:${a}:${b}`,
      network,
      token0,
      token1,
      label: `${token0.symbol} / ${token1.symbol}`,
      kind: 'swap-pair',
    });
  }

  return pools;
}

export async function resolveStonfiToken(input: string, network = getTonNetwork()) {
  const trimmed = input.trim();
  const normalized = trimmed.toUpperCase();
  const list = await fetchStonfiDexAssets(network);
  const fromList = list.find((item) => item.symbol.toUpperCase() === normalized || item.address === trimmed);
  if (fromList) {
    return fromList;
  }

  const root = getStonfiDexApiRoot(network);
  const one = await fetch(`${root}/v1/assets/${encodeURIComponent(trimmed)}`, {
    headers: { accept: 'application/json' },
  });
  if (one.ok) {
    const row = (await one.json()) as { asset?: StonfiDexAssetRow };
    if (row.asset) {
      return mapDexRowToToken(row.asset, network);
    }
  }

  throw new Error(`Unknown STON.fi asset for ${network}: ${input}`);
}

export function toBaseUnits(amount: string, decimals: number) {
  const [wholePart, fractionPart = ''] = amount.trim().split('.');
  const safeWhole = wholePart === '' ? '0' : wholePart;
  const paddedFraction = `${fractionPart}${'0'.repeat(decimals)}`.slice(0, decimals);
  const normalized = `${safeWhole}${paddedFraction}`.replace(/^0+(?=\d)/, '');
  return normalized === '' ? '0' : normalized;
}

export function fromBaseUnits(units: string, decimals: number) {
  const value = units.replace(/^0+(?=\d)/, '') || '0';
  const padded = value.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export async function requestStonfiQuote(params: {
  network?: TonNetwork;
  offerToken: string;
  askToken: string;
  amount: string;
}) {
  const network = params.network ?? getTonNetwork();
  const offerToken = await resolveStonfiToken(params.offerToken, network);
  const askToken = await resolveStonfiToken(params.askToken, network);
  const amountUnits = toBaseUnits(params.amount, offerToken.decimals);
  const ws = createOmnistonWebSocket(OMNISTON_CONFIG[network].apiUrl);

  const rawQuote = await new Promise<any>((resolve, reject) => {
    let bestQuote: any = null;
    let settled = false;

    const finish = (value: any) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore close race
      }
      resolve(value);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore close race
      }
      reject(error);
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'v1beta7.quote',
        params: {
          bid_asset_address: { blockchain: 607, address: offerToken.address },
          ask_asset_address: { blockchain: 607, address: askToken.address },
          amount: { bid_units: amountUnits },
        },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        const candidate = data?.params?.result?.quote_updated?.quote
          || data?.result?.quote_updated?.quote
          || data?.quote_updated?.quote;

        if (candidate) {
          bestQuote = candidate;
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Failed to parse quote response'));
      }
    };

    ws.onerror = () => {
      fail(new Error('Failed to request quote from Omniston'));
    };

    setTimeout(() => finish(bestQuote), 3500);
  });

  if (!rawQuote) {
    throw new Error('No STON.fi quote received');
  }

  return {
    quoteId: rawQuote.quote_id,
    resolverId: rawQuote.resolver_id,
    resolverName: rawQuote.resolver_name,
    offerToken,
    askToken,
    offerUnits: rawQuote.bid_units,
    askUnits: rawQuote.ask_units,
    offerDisplay: fromBaseUnits(rawQuote.bid_units, offerToken.decimals),
    askDisplay: fromBaseUnits(rawQuote.ask_units, askToken.decimals),
    protocolFeeUnits: rawQuote.protocol_fee_units || '0',
    referrerFeeUnits: rawQuote.referrer_fee_units || '0',
    rawQuote,
  } satisfies StonfiQuote;
}

export async function buildStonfiTransfer(params: {
  network?: TonNetwork;
  sourceAddress: string;
  destinationAddress: string;
  quote: any;
}) {
  const network = params.network ?? getTonNetwork();
  const ws = createOmnistonWebSocket(OMNISTON_CONFIG[network].apiUrl);

  const result = await new Promise<any>((resolve, reject) => {
    let transfer: any = null;
    let settled = false;

    const finish = (value: any) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore close race
      }
      resolve(value);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore close race
      }
      reject(error);
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: '2',
        method: 'v1beta7.transaction.build_transfer',
        params: {
          source_address: { blockchain: 607, address: params.sourceAddress },
          destination_address: { blockchain: 607, address: params.destinationAddress },
          gas_excess_address: { blockchain: 607, address: params.sourceAddress },
          quote: params.quote,
          use_recommended_slippage: true,
        },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        const messages = data?.result?.ton?.messages || data?.params?.result?.ton?.messages;
        if (Array.isArray(messages) && messages.length > 0) {
          transfer = messages;
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Failed to parse transfer response'));
      }
    };

    ws.onerror = () => {
      fail(new Error('Failed to build STON.fi transfer')); 
    };

    setTimeout(() => finish(transfer), 3500);
  });

  if (!Array.isArray(result) || result.length === 0) {
    throw new Error('No STON.fi transfer messages were returned');
  }

  return result.map((message: any) => ({
    address: message.target_address,
    amount: message.send_amount,
    payload: message.payload,
  }));
}

async function resolveTxHashByBoc(params: {
  network?: TonNetwork;
  walletAddress: string;
  txBoc: string;
}) {
  const network = params.network ?? getTonNetwork();
  const client = new TonClient({ endpoint: getRpcUrl(network) });
  const walletAddress = Address.parse(params.walletAddress);
  const extHash = Cell.fromBase64(params.txBoc).hash().toString('hex');

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const transactions = await client.getTransactions(walletAddress, { limit: 5 });

    for (const tx of transactions) {
      const inMessage = tx.inMessage;
      if (!inMessage || inMessage.info.type !== 'external-in') {
        continue;
      }

      const inHash = beginCell().store(storeMessage(inMessage)).endCell().hash().toString('hex');
      if (inHash === extHash) {
        return tx.hash().toString('hex');
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Could not resolve outgoing transaction hash from wallet BOC');
}

export async function trackStonfiTrade(params: {
  network?: TonNetwork;
  quoteId: string;
  walletAddress: string;
  txBoc: string;
}) {
  const network = params.network ?? getTonNetwork();
  const ws = createOmnistonWebSocket(OMNISTON_CONFIG[network].apiUrl);
  const txHash = await resolveTxHashByBoc({ network, walletAddress: params.walletAddress, txBoc: params.txBoc });

  const status = await new Promise<string>((resolve, reject) => {
    let finalStatus = 'pending';
    let settled = false;

    const finish = (value: string) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore close race
      }
      resolve(value);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore close race
      }
      reject(error);
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: '3',
        method: 'v1beta7.trade.track',
        params: {
          quote_id: params.quoteId,
          trader_wallet_address: { blockchain: 607, address: params.walletAddress },
          outgoing_tx_hash: txHash,
        },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        const result = data?.params?.result;
        if (!result?.status) {
          return;
        }

        if (result.status.trade_settled) {
          const settledResult = result.status.trade_settled.result;
          finalStatus = settledResult === 1 || settledResult === 'TRADE_RESULT_FULLY_FILLED' ? 'completed' : 'partial';
        } else {
          finalStatus = Object.keys(result.status)[0] || 'pending';
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Failed to parse trade status'));
      }
    };

    ws.onerror = () => {
      fail(new Error('Failed to track STON.fi trade'));
    };

    setTimeout(() => finish(finalStatus), 10000);
  });

  return { txHash, status };
}

export async function getStonfiWalletAssets(address: string, network = getTonNetwork()) {
  const tokens = await fetchStonfiDexAssets(network);
  const [tonBalanceResponse, jettonsResponse] = await Promise.all([
    tonCenter.v2.getAddressBalance(address),
    tonCenter.v3.getJettonWallets(address),
  ]);

  const walletAssets: StonfiWalletAsset[] = [];
  const tonToken = tokens.find((token) => token.kind === 'ton');

  if (tonToken) {
    const balanceUnits = String(tonBalanceResponse.result || '0');
    walletAssets.push({
      token: tonToken,
      balanceUnits,
      balanceDisplay: fromBaseUnits(balanceUnits, tonToken.decimals),
    });
  }

  const jettons = Array.isArray(jettonsResponse.jetton_wallets) ? jettonsResponse.jetton_wallets : [];
  const tokenByAddress = new Map(tokens.filter((token) => token.kind === 'jetton').map((token) => [token.address, token]));

  for (const jetton of jettons) {
    const token = tokenByAddress.get(jetton.jetton?.address || '');
    if (!token) {
      continue;
    }

    const balanceUnits = String(jetton.balance || '0');
    walletAssets.push({
      token,
      balanceUnits,
      balanceDisplay: fromBaseUnits(balanceUnits, token.decimals),
    });
  }

  return walletAssets;
}
