import type { StoredBiasSnapshot } from './types';

type Quote = { close: number; previousClose: number; percentChange: number };
export type StockMarketSnapshot = {
  marketDataDate: string | null;
  quotes: Partial<Record<'SPY' | 'QQQ' | 'TLT' | 'HYG' | 'GLD' | 'USO' | 'VIX', Quote>>;
  spySma20: number | null;
  marketRows: string[];
  evidence: string[];
  watchPoints: string[];
  coverageNote: string | null;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const money = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const change = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const magnitude = (value: number) => Math.abs(value).toFixed(2);

/** Only the publisher's dated, completed-session inputs. No fetches or inferred live prices. */
export function buildStockMarketSnapshot(snapshot: StoredBiasSnapshot): StockMarketSnapshot {
  const engine = record(snapshot.engine_inputs);
  const window = record(engine.tradeWindow);
  const marketDataDate = date(window.latestTradeDate) && date(snapshot.trade_date) && window.latestTradeDate <= snapshot.trade_date
    ? window.latestTradeDate : null;
  const core = record(engine.coreTickerChanges);
  const supplemental = record(engine.supplementalTickerChanges);
  const quotes: StockMarketSnapshot['quotes'] = {};
  for (const ticker of ['SPY', 'QQQ', 'TLT', 'HYG', 'GLD', 'USO', 'VIX'] as const) {
    const input = record(core[ticker] ?? supplemental[ticker]);
    if (!marketDataDate || input.tradeDate !== marketDataDate || input.ticker !== ticker
      || !positive(input.close) || !positive(input.previousClose) || !finite(input.percentChange)) continue;
    if (window.previousTradeDate != null && (!date(window.previousTradeDate) || window.previousTradeDate >= marketDataDate)) continue;
    const percentChange = (input.close / input.previousClose - 1) * 100;
    // Reject mismatched price/return records rather than publish contradictory facts.
    if (Math.abs(percentChange - input.percentChange) > 0.03) continue;
    quotes[ticker] = { close: input.close, previousClose: input.previousClose, percentChange };
  }
  const technical = record(record(snapshot.technical_indicators).SPY);
  const technicalCurrent = marketDataDate !== null && technical.tradeDate === marketDataDate;
  const spySma20 = technicalCurrent && positive(technical.sma20) ? technical.sma20 : null;
  const evidence: string[] = [];
  if (technicalCurrent && finite(technical.rsi14) && technical.rsi14 >= 0 && technical.rsi14 <= 100) {
    evidence.push(`**SPY** RSI is ${technical.rsi14.toFixed(1)} on its 0–100 scale, where 50 is the midpoint.`);
  }
  const { SPY: spy, QQQ: qqq, TLT: tlt, HYG: hyg, GLD: gld, USO: uso, VIX: vix } = quotes;
  const marketRows: string[] = [];
  if (spy) marketRows.push(`**SPY:** ${money(spy.close)}, ${change(spy.percentChange)} from the prior close.`);
  if (qqq) marketRows.push(`**QQQ:** ${money(qqq.close)}, ${change(qqq.percentChange)} from the prior close.`);
  const bonds = [tlt ? `**TLT** ${money(tlt.close)} (${change(tlt.percentChange)})` : '', hyg ? `**HYG** ${money(hyg.close)} (${change(hyg.percentChange)})` : ''].filter(Boolean);
  if (bonds.length) marketRows.push(`**Bonds:** ${bonds.join(', ')}. **TLT** tracks long US Treasuries, **HYG** high-yield corporate bonds.`);
  const commodities = [gld ? `**GLD** ${money(gld.close)} (${change(gld.percentChange)})` : '', uso ? `**USO** ${money(uso.close)} (${change(uso.percentChange)})` : ''].filter(Boolean);
  if (commodities.length) marketRows.push(`**Gold and oil ETFs:** ${commodities.join(', ')}. These are ETF closes, not spot commodity prices.`);
  if (vix) marketRows.push(`**VIX:** ${vix.close.toFixed(2)}, ${change(vix.percentChange)} from the prior close. This measures implied volatility, not market direction.`);
  const watchPoints: string[] = [];
  if (spy && spySma20) {
    const distance = (spy.close / spySma20 - 1) * 100;
    const position = distance >= 0 ? 'above' : 'below';
    watchPoints.push(`**SPY trend:** The close is ${magnitude(distance)}% ${position} its 20-session average of ${money(spySma20)}. Check whether the next completed close stays ${position} that reference.`);
  } else if (spy) {
    watchPoints.push(`**SPY follow-through:** Compare the next completed close with ${money(spy.close)}. The latest session ${spy.percentChange > 0 ? 'gained' : spy.percentChange < 0 ? 'lost' : 'changed'} ${magnitude(spy.percentChange)}%.`);
  }
  if (spy && qqq) {
    const gap = qqq.percentChange - spy.percentChange;
    watchPoints.push(`**Nasdaq participation:** **QQQ** ${Math.abs(gap) < 0.005 ? 'matched' : gap > 0 ? 'outperformed' : 'lagged'} **SPY**${Math.abs(gap) < 0.005 ? '' : ` by ${magnitude(gap)} percentage points`}. Watch whether the Nasdaq-100 ${Math.abs(gap) < 0.005 ? 'moves ahead of or falls behind the S&P 500' : gap > 0 ? 'keeps outperforming the S&P 500' : 'closes that performance gap'} in the next completed session.`);
  }
  if (vix && watchPoints.length < 2) watchPoints.push(`**Volatility:** Compare the next **VIX** close with ${vix.close.toFixed(2)}. A higher close means higher expected volatility, not necessarily falling stocks.`);
  const missing = (['SPY', 'QQQ', 'TLT', 'HYG', 'GLD', 'USO', 'VIX'] as const).filter(ticker => !quotes[ticker]);
  return { marketDataDate, quotes, spySma20, marketRows, evidence, watchPoints,
    coverageNote: missing.length ? `Completed-session quotes are unavailable or inconsistent for ${missing.join(', ')} and are omitted. No live or intraday prices are included.` : null };
}
