import { Address, Cell, beginCell, storeMessage } from '@ton/ton';
import { TonClient } from '@ton/ton';
import { getTonChainId, getTonNetwork, type TonNetwork } from '../lib/ton-network.js';
import { tonCenter } from './toncenter.js';

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

const TOKENS: Record<TonNetwork, StonfiToken[]> = {
  mainnet: [
    { symbol: 'TON', name: 'Toncoin', address: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c', decimals: 9, kind: 'ton', network: 'mainnet' },
    { symbol: 'STON', name: 'STON', address: 'EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmwG9T6bO', decimals: 9, kind: 'jetton', network: 'mainnet' },
    { symbol: 'USDT', name: 'Tether USD', address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', decimals: 6, kind: 'jetton', network: 'mainnet' },
  ],
  testnet: [
    { symbol: 'TON', name: 'Toncoin', address: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c', decimals: 9, kind: 'ton', network: 'testnet' },
    { symbol: 'STON', name: 'STON', address: 'EQDLvsZol3juZyOAVG8tWsJntOxeEZWEaWCbbSjYakQpBh4v', decimals: 9, kind: 'jetton', network: 'testnet' },
    { symbol: 'TestBLUE', name: 'TestBLUE', address: 'EQBw6tuHsnMXTz92pz820zdTZmRYUN-grIrGLWVMadGes4-9', decimals: 9, kind: 'jetton', network: 'testnet' },
  ],
};

function getWebSocketCtor() {
  if (typeof WebSocket !== 'undefined') {
    return WebSocket;
  }
  throw new Error('WebSocket is not available in this runtime');
}

function getRpcUrl(network = getTonNetwork()) {
  return OMNISTON_CONFIG[network].rpcUrl;
}

export function getStonfiConfig(network = getTonNetwork()) {
  return {
    network,
    chainId: getTonChainId(network) as '-3' | '-239',
    tokens: TOKENS[network],
    omnistonApiUrl: OMNISTON_CONFIG[network].apiUrl,
    supported: {
      quote: true,
      buildTransfer: true,
      trackTrade: true,
      widget: true,
    },
  };
}

export function getStonfiTokens(network = getTonNetwork()) {
  return TOKENS[network];
}

export function getStonfiPools(network = getTonNetwork()) {
  const tokens = TOKENS[network];
  const pools: StonfiPool[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    for (let j = i + 1; j < tokens.length; j += 1) {
      const token0 = tokens[i]!;
      const token1 = tokens[j]!;
      pools.push({
        id: `${network}:${token0.symbol}-${token1.symbol}`,
        network,
        token0,
        token1,
        label: `${token0.symbol} / ${token1.symbol}`,
        kind: 'swap-pair',
      });
    }
  }

  return pools;
}

export function resolveStonfiToken(input: string, network = getTonNetwork()) {
  const normalized = input.trim().toUpperCase();
  const token = TOKENS[network].find((item) => item.symbol.toUpperCase() === normalized || item.address === input.trim());
  if (!token) {
    throw new Error(`Unsupported STON.fi token for ${network}: ${input}`);
  }
  return token;
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
  const offerToken = resolveStonfiToken(params.offerToken, network);
  const askToken = resolveStonfiToken(params.askToken, network);
  const amountUnits = toBaseUnits(params.amount, offerToken.decimals);
  const WebSocketCtor = getWebSocketCtor();
  const ws = new WebSocketCtor(OMNISTON_CONFIG[network].apiUrl);

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

    ws.onmessage = (event: MessageEvent) => {
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
  const WebSocketCtor = getWebSocketCtor();
  const ws = new WebSocketCtor(OMNISTON_CONFIG[network].apiUrl);

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

    ws.onmessage = (event: MessageEvent) => {
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
  const WebSocketCtor = getWebSocketCtor();
  const ws = new WebSocketCtor(OMNISTON_CONFIG[network].apiUrl);
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

    ws.onmessage = (event: MessageEvent) => {
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
  const tokens = TOKENS[network];
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
