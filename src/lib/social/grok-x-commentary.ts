import type { DistributionMarket } from './distribution-content';

export type GrokXMarketFacts = {
  trade_date: string;
  ticker_changes: unknown;
  window?: unknown;
  technical_indicators?: unknown;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const pct = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const money = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Conservative freshness: never call an older available close the latest.
 * On US holidays an unavailable prior-weekday close means skip, not backfill. */
export function grokXCompletedSession(market: DistributionMarket, now: Date) {
  const date = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  if (market === 'stocks') while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Standalone value before a link: observed move, its meaning, and a specific
 * next-session question. Only structured quotes; no paid prose or invented news. */
export function buildGrokXCommentary(market: DistributionMarket, facts: GrokXMarketFacts, now: Date): { text: string; marketDataDate: string } | null {
  const marketDataDate = grokXCompletedSession(market, now);
  const changes = record(facts.ticker_changes);
  const quote = (ticker: string) => {
    const value = record(changes[ticker]);
    if (value.ticker !== ticker || value.tradeDate !== marketDataDate || !positive(value.close) || !positive(value.previousClose)
      || typeof value.percentChange !== 'number' || !Number.isFinite(value.percentChange)) return null;
    const percentChange = (value.close / value.previousClose - 1) * 100;
    if (Math.abs(percentChange - value.percentChange) > 0.03) return null;
    return { close: value.close, percentChange };
  };
  const date = new Date(`${marketDataDate}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (market === 'stocks') {
    if (record(facts.window).latestTradeDate !== marketDataDate) return null;
    const spy = quote('SPY'), qqq = quote('QQQ');
    if (!spy || !qqq) return null;
    const gap = qqq.percentChange - spy.percentChange;
    const bothUp = spy.percentChange > 0.005 && qqq.percentChange > 0.005;
    const bothDown = spy.percentChange < -0.005 && qqq.percentChange < -0.005;
    const hook = Math.abs(gap) < 0.1 ? (bothUp ? 'US stocks rose together.' : bothDown ? 'US stocks fell together.' : 'Little separation between the two big US stock ETFs.')
      : bothUp ? (gap > 0 ? 'Nasdaq-100 stocks led the gains.' : 'The S&P 500 outpaced the Nasdaq-100.')
      : bothDown ? (gap < 0 ? 'Nasdaq-100 stocks took the bigger hit.' : 'The S&P 500 fell harder than the Nasdaq-100.')
      : 'The S&P 500 and Nasdaq-100 told different stories.';
    const technical = record(record(facts.technical_indicators).SPY);
    let watch = bothUp ? 'Next session: can both keep rising, or does one lose ground?'
      : bothDown ? 'Next session: do both recover, or does selling continue?'
      : 'Next session: do they start moving together, or stay split?';
    if (technical.tradeDate === marketDataDate && positive(technical.sma20)) {
      watch = spy.close < technical.sma20
        ? `${bothUp ? 'But SPY' : 'SPY'} is below its 20-day average (${money(technical.sma20)}). Watch whether it can reclaim that line.`
        : spy.close > technical.sma20
          ? `SPY is above its 20-day average (${money(technical.sma20)}). Watch whether it holds that line.`
          : `SPY is at its 20-day average (${money(technical.sma20)}). Watch whether it moves above or below that line.`;
    }
    return { marketDataDate, text: `${hook}\nNasdaq ETF QQQ ${pct(qqq.percentChange)}; S&P 500 ETF SPY ${pct(spy.percentChange)} (${date} close).\n${watch}` };
  }
  if (facts.trade_date !== marketDataDate) return null;
  const btc = quote('BTC-USD'), eth = quote('ETH-USD');
  if (!btc || !eth) return null;
  const gap = eth.percentChange - btc.percentChange;
  const bothUp = btc.percentChange > 0.005 && eth.percentChange > 0.005;
  const bothDown = btc.percentChange < -0.005 && eth.percentChange < -0.005;
  const hook = Math.abs(gap) < 0.1 ? 'Bitcoin and Ethereum moved almost in step.'
    : bothUp ? gap > 0 ? 'Ethereum led the crypto gains.' : 'Bitcoin rose faster than Ethereum.'
    : bothDown ? gap < 0 ? 'Ethereum fell harder than Bitcoin.' : 'Bitcoin fell harder than Ethereum.'
    : 'Bitcoin and Ethereum are pulling in different directions.';
  const watch = bothUp ? 'Watch whether both keep rising next session; one coin rising alone is a different picture.'
    : bothDown ? 'Watch whether both recover next session, or one keeps falling.'
    : 'Watch whether they move the same way next session before calling it a shared trend.';
  return { marketDataDate, text: `${hook}\nBitcoin ${pct(btc.percentChange)}; Ethereum ${pct(eth.percentChange)} (${date} UTC close).\n${watch}` };
}
