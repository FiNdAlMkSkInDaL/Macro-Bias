import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAcquisitionReport, type AcquisitionReport } from './acquisition-data';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const LISTING_MONITOR_END = '2026-10-16T00:00:00.000Z';
export const LISTING_MONITOR_EVENT = 'listing_monitor_snapshot';
const START = '2026-10-12';
const CAMPAIGN = 'mb_free_listings';
const LIMIT = 900_000;
export const LISTING_TARGETS = [
  { source: 'letterlist', url: 'https://letterlist.com/' },
  { source: 'fintechnewsletters', url: 'https://www.fintechnewsletters.com/' },
  { source: 'epirus', url: 'https://www.epirus.vc/newsletter-directory' },
  { source: 'inboxreads', url: 'https://inboxreads.co/new' },
  { source: 'goletter', url: 'https://directory.goletter.co/' },
] as const;
type Target = (typeof LISTING_TARGETS)[number];
type Publication = {
  source: string; checkedUrl: string; status: 'published' | 'not_observed' | 'check_failed';
  listingUrl?: string; destination?: string; trackingIntact?: boolean; firstObservedLiveAt?: string;
  note: string;
};
function decode(value: string) {
  return value.replace(/&amp;|&#0*38;|&#x0*26;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0*39;/g, "'");
}
export function listingLinks(html: string, base: string) {
  const visible = html.replace(/<!--[^]*?-->|<(script|style|template)\b[^>]*>[^]*?<\/\1\s*>/gi, '');
  return [...visible.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([^]*?)<\/a\s*>/gi)].flatMap(match => {
    try {
      const url = new URL(decode(match[2]), base);
      if (url.protocol !== 'https:' || url.username || url.password) return [];
      return [{ url, brand: /macro[\s-]*bias/i.test(match[3].replace(/<[^>]*>/g, ' ')) }];
    } catch { return []; }
  });
}
function destination(html: string, base: string, source: string) {
  const match = listingLinks(html, base).find(link => ['macro-bias.com', 'www.macro-bias.com'].includes(link.url.hostname));
  if (!match) return null;
  // Inspect the link only. Never fetch our own destination and pollute acquisition.
  return {
    destination: match.url.href,
    trackingIntact: match.url.searchParams.get('utm_source') === source &&
      match.url.searchParams.get('utm_medium') === 'directory' && match.url.searchParams.get('utm_campaign') === CAMPAIGN,
  };
}
async function readPage(url: string, origin: string, fetchPage: typeof fetch): Promise<string> {
  // Redirects may only stay on the fixed directory origin, including discovered profiles.
  let current = new URL(url);
  const signal = AbortSignal.timeout(7_000);
  for (let hops = 0; hops < 3; hops++) {
    if (current.origin !== origin) throw new Error('Unexpected redirect');
    const response = await fetchPage(current, { redirect: 'manual', cache: 'no-store', signal,
      headers: { 'User-Agent': 'MacroBiasListingMonitor/1.0 (+https://www.macro-bias.com)', Accept: 'text/html' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Missing redirect');
      current = new URL(location, current); continue;
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || !response.body) {
      await response.body?.cancel(); throw new Error('Page unavailable');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > LIMIT) throw new Error('Page too large');
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Too many redirects');
}
export async function checkListing(target: Target, fetchPage: typeof fetch = fetch): Promise<Publication> {
  const base = { source: target.source, checkedUrl: target.url };
  try {
    const origin = new URL(target.url).origin;
    const html = await readPage(target.url, origin, fetchPage);
    const direct = destination(html, target.url, target.source);
    if (direct) return { ...base, status: 'published', listingUrl: target.url, ...direct, note: 'Public directory contains a link to Macro Bias.' };
    const profiles = listingLinks(html, target.url).filter(link => link.brand && link.url.origin === origin).slice(0, 2);
    for (const profile of profiles) {
      const details = await readPage(profile.url.href, origin, fetchPage);
      const found = destination(details, profile.url.href, target.source);
      if (found) return { ...base, status: 'published', listingUrl: profile.url.href, ...found, note: 'Public Macro Bias profile links to the website.' };
    }
    return { ...base, status: 'not_observed', note: 'Not found on the checked public page. This is not proof of rejection or absence from the entire directory; dynamic pages and pagination can hide listings.' };
  } catch {
    return { ...base, status: 'check_failed', note: 'Public page could not be checked. Approval remains unknown.' };
  }
}
function summary(report: AcquisitionReport) {
  // A failed/partial read must never become a zero in stored results.
  return { range: report.range, complete: report.coverage.complete,
    overview: report.coverage.complete ? report.overview : null,
    sourceRows: report.coverage.complete ? report.sourceRows : null,
    coverage: report.coverage, freshness: report.freshness };
}
export async function listingMonitorHistory(admin = createSupabaseAdminClient({ timeoutMs: 8_000 })) {
  const result = await admin.from('marketing_event_log').select('created_at,metadata')
    .eq('event_name', LISTING_MONITOR_EVENT).order('created_at', { ascending: false }).limit(20);
  if (result.error) throw new Error('Listing monitoring history unavailable');
  return result.data ?? [];
}
export async function runListingMonitor(now = new Date(), dependencies: {
  admin?: SupabaseClient; report?: typeof getAcquisitionReport; fetchPage?: typeof fetch;
} = {}) {
  if (now.toISOString() < `${START}T00:00:00.000Z` || now.toISOString() >= LISTING_MONITOR_END) {
    return { status: 'inactive', endsAt: LISTING_MONITOR_END };
  }
  const admin = dependencies.admin ?? createSupabaseAdminClient({ timeoutMs: 8_000 });
  const report = dependencies.report ?? getAcquisitionReport;
  const end = now.toISOString().slice(0, 10);
  const sevenStart = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const rollingStart = sevenStart < START ? START : sevenStart;
  const filters = { preset: 'custom' as const, start: START, end, campaign: CAMPAIGN, touch: 'first' as const };
  const [cumulative, rolling, publications, history] = await Promise.all([
    report(filters, admin, now),
    rollingStart === START ? Promise.resolve(null) : report({ ...filters, start: rollingStart }, admin, now),
    Promise.all(LISTING_TARGETS.map(target => checkListing(target, dependencies.fetchPage))),
    listingMonitorHistory(admin),
  ]);
  for (const publication of publications) {
    const prior = history.flatMap(row => Array.isArray(row.metadata?.publications) ? row.metadata.publications : [])
      .find(item => item.source === publication.source && typeof item.firstObservedLiveAt === 'string');
    if (prior) publication.firstObservedLiveAt = prior.firstObservedLiveAt;
    else if (publication.status === 'published') publication.firstObservedLiveAt = now.toISOString();
  }
  const snapshot = {
    traffic_type: 'internal', checkedAt: now.toISOString(), endsAt: LISTING_MONITOR_END, campaign: CAMPAIGN,
    attribution: 'first', cumulative: summary(cumulative), rollingSevenDays: summary(rolling ?? cumulative), publications,
    mailbox: { status: 'not_connected', note: 'Inbox-only approvals and rejections require separate cloud mailbox access. Public publication checks do not read Outlook.' },
  };
  const hex = createHash('sha256').update(`${LISTING_MONITOR_EVENT}:${end}`).digest('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const result = await admin.from('marketing_event_log').upsert({ id, event_name: LISTING_MONITOR_EVENT,
    page_path: '/api/cron/listings', created_at: now.toISOString(), metadata: snapshot }, { onConflict: 'id' });
  if (result.error) throw new Error('Listing snapshot could not be saved');
  return { status: 'recorded', ...snapshot };
}
