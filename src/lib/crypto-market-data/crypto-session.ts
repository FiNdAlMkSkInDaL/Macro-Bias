/** Crypto daily candles end at midnight UTC on every calendar day. */
export function cryptoUtcDayStart(now = new Date()): Date {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid crypto session time.");
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function latestCompletedCryptoTradeDate(now = new Date()): string {
  return new Date(cryptoUtcDayStart(now).getTime() - 86_400_000).toISOString().slice(0, 10);
}

export function isCompletedCryptoTradeDate(tradeDate: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return false;
  const date = new Date(`${tradeDate}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === tradeDate &&
    tradeDate <= latestCompletedCryptoTradeDate(now);
}
