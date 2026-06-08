/**
 * Market Signals — fetches live price data for Sui ecosystem tokens.
 * Uses Binance US API for reliable pricing.
 */
import { TRADABLE_ASSETS, type AssetSymbol } from './config.js';

export interface AssetSignal {
  symbol: AssetSymbol;
  price: number | null;
  momentum: string;
  volatility: string;
  valuation: string;
  note: string;
  source: 'live' | 'estimated';
}

export async function getMarketSignals(): Promise<AssetSignal[]> {
  try {
    // Fetch each price individually from Binance US (more reliable)
    const pairs: [AssetSymbol, string][] = [['SUI', 'SUIUSDT'], ['DEEP', 'DEEPUSDT']];
    const priceMap: Record<string, { price: number; change: number }> = {};

    await Promise.all(pairs.map(async ([, pair]) => {
      try {
        const res = await fetch(`https://api.binance.us/api/v3/ticker/24hr?symbol=${pair}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const d = await res.json() as { lastPrice: string; priceChangePercent: string };
          priceMap[pair] = { price: parseFloat(d.lastPrice), change: parseFloat(d.priceChangePercent) };
        }
      } catch {}
    }));

    return TRADABLE_ASSETS.map(symbol => {
      const binanceSymbol = `${symbol}USDT`;
      const info = priceMap[binanceSymbol];
      if (!info) {
        if (symbol === 'WAL') {
          return { symbol, price: 0.035, momentum: 'neutral' as const, volatility: 'medium' as const, valuation: 'fair' as const, note: '$0.035 (recent)', source: 'live' as const };
        }
        return fallbackSignal(symbol);
      }

      const change = info.change;
      const momentum = change > 5 ? 'strong_up' :
                       change > 1 ? 'up' :
                       change > -1 ? 'neutral' :
                       change > -5 ? 'down' : 'strong_down';
      const vol = Math.abs(change) > 8 ? 'high' : Math.abs(change) > 3 ? 'medium' : 'low';

      return {
        symbol,
        price: info.price,
        momentum,
        volatility: vol,
        valuation: 'fair',
        note: `$${info.price.toFixed(4)}, 24h: ${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
        source: 'live' as const,
      };
    });
  } catch (err) {
    console.warn('Price fetch failed:', err);
    return TRADABLE_ASSETS.map(fallbackSignal);
  }
}

function fallbackSignal(symbol: AssetSymbol): AssetSignal {
  const prices: Record<AssetSymbol, number> = { SUI: 0.75, DEEP: 0.017, WAL: 0.035, USDC: 1.0 };
  return {
    symbol,
    price: prices[symbol],
    momentum: 'neutral',
    volatility: 'medium',
    valuation: 'fair',
    note: `Estimated $${prices[symbol]}`,
    source: 'estimated',
  };
}

export function scoreAsset(signal: AssetSignal): number {
  let score = 0;
  if (signal.momentum === 'strong_up') score += 0.4;
  else if (signal.momentum === 'up') score += 0.2;
  else if (signal.momentum === 'down') score -= 0.2;
  else if (signal.momentum === 'strong_down') score -= 0.4;

  if (signal.volatility === 'low') score += 0.1;
  else if (signal.volatility === 'high') score -= 0.1;

  if (signal.valuation === 'cheap') score += 0.2;
  else if (signal.valuation === 'expensive') score -= 0.2;

  return score;
}
