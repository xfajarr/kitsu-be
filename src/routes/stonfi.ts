import { Hono } from 'hono';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { getTonNetwork } from '../lib/ton-network.js';
import { buildStonfiTransfer, getStonfiConfig, getStonfiPools, getStonfiTokens, getStonfiWalletAssets, requestStonfiQuote, trackStonfiTrade } from '../services/stonfi.js';

export const stonfiRoutes = new Hono();

const quoteSchema = z.object({
  offerToken: z.string().min(1),
  askToken: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,9})?$/),
});

const buildTransferSchema = z.object({
  offerToken: z.string().min(1),
  askToken: z.string().min(1),
  sourceAddress: z.string().min(1),
  destinationAddress: z.string().min(1).optional(),
  quote: z.unknown(),
});

const trackTradeSchema = z.object({
  quoteId: z.string().min(1),
  walletAddress: z.string().min(1),
  txBoc: z.string().min(1),
});

stonfiRoutes.get('/config', (c) => {
  return c.json({
    success: true,
    data: {
      config: getStonfiConfig(),
    },
  });
});

stonfiRoutes.get('/assets', (c) => {
  return c.json({
    success: true,
    data: {
      assets: getStonfiTokens(getTonNetwork()),
    },
  });
});

stonfiRoutes.get('/pools', (c) => {
  return c.json({
    success: true,
    data: {
      pools: getStonfiPools(getTonNetwork()),
    },
  });
});

stonfiRoutes.get('/wallet-assets/:address', async (c) => {
  const { address } = c.req.param();
  const assets = await getStonfiWalletAssets(address, getTonNetwork());

  return c.json({
    success: true,
    data: { assets },
  });
});

stonfiRoutes.post('/quote', validateBody(quoteSchema), async (c) => {
  const body = c.get('validatedBody') as z.infer<typeof quoteSchema>;
  const quote = await requestStonfiQuote({
    network: getTonNetwork(),
    offerToken: body.offerToken,
    askToken: body.askToken,
    amount: body.amount,
  });

  return c.json({
    success: true,
    data: { quote },
  });
});

stonfiRoutes.post('/build-transfer', validateBody(buildTransferSchema), async (c) => {
  const body = c.get('validatedBody') as z.infer<typeof buildTransferSchema>;
  const messages = await buildStonfiTransfer({
    network: getTonNetwork(),
    sourceAddress: body.sourceAddress,
    destinationAddress: body.destinationAddress || body.sourceAddress,
    quote: body.quote,
  });

  const rawQuote = body.quote as Record<string, unknown>;

  return c.json({
    success: true,
    data: {
      swap: {
        quoteId: String(rawQuote.quote_id || ''),
        txParams: { messages },
      },
    },
  });
});

stonfiRoutes.post('/track', validateBody(trackTradeSchema), async (c) => {
  const body = c.get('validatedBody') as z.infer<typeof trackTradeSchema>;
  const trade = await trackStonfiTrade({
    network: getTonNetwork(),
    quoteId: body.quoteId,
    walletAddress: body.walletAddress,
    txBoc: body.txBoc,
  });

  return c.json({
    success: true,
    data: { trade },
  });
});
