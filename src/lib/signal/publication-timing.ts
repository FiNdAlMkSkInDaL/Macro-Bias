/** Eligible full sessions for live evaluation, not retrospective source-date returns. */
const DAY = 86_400_000;
function day(value: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}
export function stockSessionOpen(date: string) {
  const start = day(date); if (start === null) return null;
  const weekday = new Date(start).getUTCDay(); if (weekday === 0 || weekday === 6) return null;
  const noonUtc = new Date(start + 17 * 3_600_000);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(noonUtc));
  return start + (9.5 + 17 - hour) * 3_600_000;
}
export function stockLiveSession(date: string, sourceDate: string | null, publishedAt: string) {
  const open = stockSessionOpen(date), published = Date.parse(publishedAt);
  if (open === null || !sourceDate || day(sourceDate) === null || sourceDate >= date || !Number.isFinite(published) || published >= open) return null;
  // Require publication on the target calendar day; reject old/backfilled rows.
  return publishedAt.slice(0, 10) === date ? date : null;
}
export function cryptoLiveSession(sourceDate: string, publishedAt: string) {
  const source = day(sourceDate), published = Date.parse(publishedAt);
  if (source === null || !Number.isFinite(published) || published < source + DAY || published >= source + 2 * DAY) return null;
  const midnight = Math.floor(published / DAY) * DAY;
  return new Date(published === midnight ? midnight : midnight + DAY).toISOString().slice(0, 10);
}
export function latestPublicationTime(createdAt: string, updatedAt?: string | null) {
  const created = Date.parse(createdAt), updated = updatedAt ? Date.parse(updatedAt) : created;
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return '';
  return new Date(Math.max(created, updated)).toISOString();
}
