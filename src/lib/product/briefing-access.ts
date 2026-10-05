/** Seven calendar days are seven complete 24-hour days from first publication.
 * UTC instants avoid trading-session, weekend, timezone and DST ambiguity.
 * The exact boundary is inclusive. Unknown timestamps never release to Free.
 */
export const BRIEFING_RELEASE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
export type BriefingViewer = { signedIn: boolean; isPro: boolean };
export type BriefingAccess = { kind: 'pro' | 'free' | 'sign-in' | 'pro-required'; freeAvailableAt: string | null };
export function briefingReleaseAt(publishedAt: string | null): string | null {
  if (!publishedAt) return null;
  const timestamp = Date.parse(publishedAt);
  if (!Number.isFinite(timestamp)) return null;
  const release = timestamp + BRIEFING_RELEASE_DELAY_MS;
  return Number.isFinite(release) && release <= 8640000000000000 ? new Date(release).toISOString() : null;
}
export function briefingAccess(viewer: BriefingViewer, publishedAt: string | null, now = Date.now()): BriefingAccess {
  const freeAvailableAt = briefingReleaseAt(publishedAt);
  if (viewer.signedIn && viewer.isPro) return { kind: 'pro', freeAvailableAt };
  const released = freeAvailableAt !== null && Number.isFinite(now) && now >= Date.parse(freeAvailableAt);
  return { kind: released ? viewer.signedIn ? 'free' : 'sign-in' : 'pro-required', freeAvailableAt };
}
export function canReadBriefing(access: BriefingAccess) { return access.kind === 'pro' || access.kind === 'free'; }
