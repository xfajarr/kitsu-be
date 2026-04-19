import { Hono } from 'hono';
import { db } from '../db';
import { denDeposits, dens } from '../db/schema';
import { eq } from 'drizzle-orm';
import { jwtService } from '../lib/jwt';
import { tonCenter } from '../services/toncenter';
import { priceService } from '../services/prices';
import { log } from '../lib/logger';

export const portfolioRoutes = new Hono();

// GET /portfolio - User's full portfolio
portfolioRoutes.get('/', async (c) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    }, 401);
  }
  
  const token = authHeader.slice(7);
  const payload = await jwtService.verifyToken(token);
  
  if (!payload) {
    return c.json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    }, 401);
  }
  
  const walletAddr = payload.walletAddr;
  
  try {
    // Fetch wallet balance from TonCenter
    const balanceResponse = await tonCenter.v2.getAddressBalance(walletAddr);
    const tonBalance = parseInt(balanceResponse.result || '0') / 1e9;
    
    // Fetch jetton wallets
    const jettonsResponse = await tonCenter.v3.getJettonWallets(walletAddr);
    const jettons = jettonsResponse.jetton_wallets || [];
    
    // Get current prices
    const prices = await priceService.getPrices();
    const tonPrice = prices.TON?.usd ?? 0;
    
    // Build assets list - wallet only
    const walletAssets = [
      {
        symbol: 'TON',
        balance: tonBalance,
        priceUsd: tonPrice,
        change24h: prices.TON?.change24h || 0,
        valueUsd: tonBalance * tonPrice,
      },
    ];
    
    // Add jettons
    for (const jetton of jettons.slice(0, 10)) {
      const symbol = jetton.jetton?.symbol || 'UNKNOWN';
      const decimals = jetton.jetton?.decimals || 9;
      const balance = parseInt(jetton.balance) / Math.pow(10, decimals);
      const price = prices[symbol]?.usd || 0;
      
      walletAssets.push({
        symbol,
        balance,
        priceUsd: price,
        change24h: prices[symbol]?.change24h || 0,
        valueUsd: balance * price,
      });
    }
    
    // Fetch Nest vault deposits from DB - user's own dens
    const userDens = await db.query.dens.findMany({
      where: eq(dens.ownerId, payload.userId),
    });
    
    let denDepositTotal = 0;
    const userDenIds = userDens.map(d => d.id);
    
    for (const denId of userDenIds) {
      const deposits = await db.query.denDeposits.findMany({
        where: eq(denDeposits.denId, denId),
      });
      for (const dep of deposits) {
        denDepositTotal += parseFloat(dep.amountTon);
      }
    }
    
    // Note: Goals don't have deposit tracking yet - placeholder
    const goalDepositTotal = 0;
    
    // Total from Nest vaults + Goals
    const nestValue = denDepositTotal * tonPrice;
    const goalValue = goalDepositTotal * tonPrice;
    
    // Combine all: wallet + Nest vaults + Goals
    const allAssets = [
      ...walletAssets.filter(a => a.valueUsd > 0 || a.symbol === 'TON'),
    ];
    
    // Add Nest/Goal as separate entries
    if (denDepositTotal > 0) {
      allAssets.push({
        symbol: 'NEST',
        balance: denDepositTotal,
        priceUsd: tonPrice,
        change24h: 0,
        valueUsd: nestValue,
      });
    }
    
    if (goalDepositTotal > 0) {
      allAssets.push({
        symbol: 'GOAL',
        balance: goalDepositTotal,
        priceUsd: tonPrice,
        change24h: 0,
        valueUsd: goalValue,
      });
    }
    
    const walletTotal = walletAssets.reduce((sum, a) => sum + a.valueUsd, 0);
    const totalUsd = walletTotal + nestValue + goalValue;
    
    return c.json({
      success: true,
      data: {
        portfolio: {
          totalUsd,
          dayChangePct: prices.TON?.change24h || 0,
          assets: allAssets,
          nestTotal: nestValue,
          goalTotal: goalValue,
        },
      },
    });
  } catch (error) {
    log.error('PORTFOLIO', 'Failed to fetch portfolio', error);
    
    return c.json({
      success: true,
      data: {
        portfolio: {
          totalUsd: 0,
          dayChangePct: 0,
          assets: [],
        },
      },
    });
  }
});

// GET /portfolio/prices - Live token prices
portfolioRoutes.get('/prices', async (c) => {
  try {
    const prices = await priceService.getPrices();
    return c.json({
      success: true,
      data: { prices },
    });
  } catch (error) {
    log.error('PORTFOLIO', 'Price fetch failed', error);
    return c.json(
      {
        success: false,
        error: { code: 'PRICE_UNAVAILABLE', message: 'Could not load market prices' },
      },
      503,
    );
  }
});
