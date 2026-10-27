import type { ProductAsset } from './score-access';

export type PublicMarketQuote = { ticker: string; name: string; close: number; change: number };
export type PublicBriefingSummary = {
  headline: string; observation: string; context: string; watch: string;
  marketDataDate: string; quotes: PublicMarketQuote[];
};
export type PublicBriefingFacts = { trade_date: string; ticker_changes: unknown; window?: unknown };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
export const publicPercent = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
export const publicMoney = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Price-only public prose. Never reads paid copy, news, analogs or model diagnostics. */
export function buildPublicBriefingSummary(asset: ProductAsset, date: string, facts: PublicBriefingFacts | null): PublicBriefingSummary | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !facts || facts.trade_date !== date) return null;
  const cutoff = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(cutoff.getTime()) || cutoff.toISOString().slice(0, 10) !== date) return null;
  if (asset === 'stocks') {
    cutoff.setUTCDate(cutoff.getUTCDate() - 1);
    while ([0, 6].includes(cutoff.getUTCDay())) cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  }
  const marketDataDate = cutoff.toISOString().slice(0, 10);
  if (asset === 'stocks' && record(facts.window).latestTradeDate !== marketDataDate) return null;
  const tickers = asset === 'stocks' ? [['SPY', 'S&P 500 ETF'], ['QQQ', 'Nasdaq-100 ETF']] : [['BTC-USD', 'Bitcoin'], ['ETH-USD', 'Ethereum']];
  const changes = record(facts.ticker_changes);
  const quotes: PublicMarketQuote[] = [];
  for (const [ticker, name] of tickers) {
    const q = record(changes[ticker]);
    if (q.ticker !== ticker || q.tradeDate !== marketDataDate || !positive(q.close) || !positive(q.previousClose)
      || typeof q.percentChange !== 'number' || !Number.isFinite(q.percentChange)) return null;
    const change = (q.close / q.previousClose - 1) * 100;
    if (Math.abs(change - q.percentChange) > 0.03) return null;
    quotes.push({ ticker, name, close: q.close, change });
  }
  const [a, b] = quotes;
  const gap = b.change - a.change;
  const up = a.change >= 0.005 && b.change >= 0.005;
  const down = a.change <= -0.005 && b.change <= -0.005;
  const first = asset === 'stocks' ? 'the S&P 500' : 'Bitcoin';
  const second = asset === 'stocks' ? 'the Nasdaq-100' : 'Ethereum';
  const headline = Math.abs(gap) < 0.1 ? `${asset === 'stocks' ? 'US stock benchmarks' : 'Bitcoin and Ethereum'} moved almost in step`
    : up ? `${gap > 0 ? second : first} led the gains`
    : down ? `${gap < 0 ? second : first} took the bigger fall`
    : `${asset === 'stocks' ? 'US stock benchmarks' : 'Bitcoin and Ethereum'} diverged`;
  const move = (q: PublicMarketQuote) => `${q.name} ${Math.abs(q.change) < 0.005 ? 'was little changed' : `${q.change > 0 ? 'rose' : 'fell'} ${Math.abs(q.change).toFixed(2)}%`}, closing at ${publicMoney(q.close)}`;
  const context = Math.abs(gap) < 0.005
    ? `The two returns were within 0.01 percentage points. Neither clearly led this session.`
    : `${gap > 0 ? second : first} outperformed ${gap > 0 ? first : second} by ${Math.abs(gap).toFixed(2)} percentage points. ${asset === 'stocks' ? 'This compares two different stock baskets; it is not a count of how many individual stocks rose.' : 'This comparison covers two coins, not the whole crypto market.'}`;
  const watch = `For the session after ${marketDataDate}, compare ${a.name} with its ${publicMoney(a.close)} close and ${b.name} with ${publicMoney(b.close)}. ${up ? 'Both holding above those references would show follow-through to this rise.' : down ? 'Both recovering those references would show a shared rebound.' : 'Check whether the next closes move together or keep diverging.'} These are comparison points, not trade instructions.`;
  return { headline: headline.charAt(0).toUpperCase() + headline.slice(1), observation: `${move(a)}; ${move(b)}.`, context: context.charAt(0).toUpperCase() + context.slice(1), watch, marketDataDate, quotes };
}
