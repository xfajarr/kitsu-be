// Price Service — live quotes (CoinGecko public API by default)
import { log } from '../lib/logger';

let priceCache: {
  prices: Record<string, { usd: number; change24h: number }>;
  timestamp: number;
} | null = null;

const CACHE_DURATION = 60 * 1000;

const DEFAULT_CG_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,tether&vs_currencies=usd&include_24hr_change=true';

function mapCoinGecko(data: Record<string, { usd?: number; usd_24h_change?: number }>) {
  const ton = data['the-open-network'];
  const usdt = data.tether;
  const out: Record<string, { usd: number; change24h: number }> = {};
  if (ton?.usd != null) {
    out.TON = { usd: ton.usd, change24h: ton.usd_24h_change ?? 0 };
  }
  if (usdt?.usd != null) {
    out.USDT = { usd: usdt.usd, change24h: usdt.usd_24h_change ?? 0 };
  }
  return out;
}

export async function getTokenPrices(): Promise<Record<string, { usd: number; change24h: number }>> {
  if (priceCache && Date.now() - priceCache.timestamp < CACHE_DURATION) {
    return priceCache.prices;
  }

  const url = process.env.COINGECKO_SIMPLE_PRICE_URL || DEFAULT_CG_URL;

  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`CoinGecko HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
    const prices = mapCoinGecko(raw);

    if (Object.keys(prices).length === 0) {
      throw new Error('CoinGecko returned no usable prices');
    }

    priceCache = { prices, timestamp: Date.now() };
    log.debug('PRICE', 'Prices fetched', prices);
    return prices;
  } catch (error) {
    log.error('PRICE', 'Failed to fetch prices', error);
    if (priceCache) {
      return priceCache.prices;
    }
    throw error;
  }
}

export async function getTokenPrice(symbol: string): Promise<{ usd: number; change24h: number } | null> {
  const prices = await getTokenPrices();
  return prices[symbol] ?? null;
}

export async function tonToUsd(tonAmount: number): Promise<number> {
  const price = await getTokenPrice('TON');
  if (!price) {
    throw new Error('TON price unavailable');
  }
  return tonAmount * price.usd;
}

export async function usdToTon(usdAmount: number): Promise<number> {
  const price = await getTokenPrice('TON');
  if (!price?.usd) {
    throw new Error('TON price unavailable');
  }
  return usdAmount / price.usd;
}

export const priceService = {
  getPrices: getTokenPrices,
  getPrice: getTokenPrice,
  tonToUsd,
  usdToTon,
};
