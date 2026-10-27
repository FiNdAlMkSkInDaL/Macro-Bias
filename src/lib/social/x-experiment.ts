import 'server-only';
import { createHash } from 'node:crypto';
import { TwitterApi } from 'twitter-api-v2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getAcquisitionReport } from '@/lib/analytics/acquisition-data';
import { loadPaidBriefingArchive, type PaidBriefingArchiveItem } from '@/lib/product/paid-briefing-data';
import { buildGrokXCommentary, type GrokXMarketFacts } from './grok-x-commentary';
import type { DistributionMarket } from './distribution-content';

export const X_TEST = {
  id: 'mb_x_commentary_20261028', start: '2026-10-28T00:00:00.000Z', end: '2026-11-11T00:00:00.000Z',
  finalCheckpointEnd: '2026-11-12T00:00:00.000Z',
  deliveryEvent: 'x_commentary_delivery', runEvent: 'x_commentary_run', growthEvent: 'x_commentary_growth',
} as const;
type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Engagement = { id: string; impressions: number | null; likes: number | null; replies: number | null; reposts: number | null };
export type XTestDependencies = {
  admin: Admin;
  archive: typeof loadPaidBriefingArchive;
  facts: (market: DistributionMarket, date: string) => Promise<GrokXMarketFacts | null>;
  verifyAccount: () => Promise<void>;
  publish: (text: string) => Promise<string>;
  engagement: (ids: string[]) => Promise<Engagement[]>;
};
export class XTestError extends Error { constructor(readonly code: string) { super(code); } }
export function xTestId(key: string) {
  const hash = createHash('sha256').update(`${X_TEST.id}:${key}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function xTestOpen(now: Date) { return now.toISOString() >= X_TEST.start && now.toISOString() < X_TEST.end; }
export function xTestMarket(now: Date): DistributionMarket | null {
  if (!xTestOpen(now) || now.getUTCHours() !== 15) return null;
  return [2, 4].includes(now.getUTCDay()) ? 'stocks' : [3, 5].includes(now.getUTCDay()) ? 'crypto' : null;
}
export function xTestPlan() {
  const dates: { date: string; market: DistributionMarket; time: string }[] = [];
  for (let at = Date.parse(X_TEST.start); at < Date.parse(X_TEST.end); at += 86_400_000) {
    const now = new Date(at + 15 * 3_600_000), market = xTestMarket(now);
    if (market) dates.push({ date: now.toISOString().slice(0, 10), market, time: '15:00 UTC (15:30 recovery)' });
  }
  return dates;
}
function client() {
  const values = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'].map(name => process.env[name]?.trim());
  if (values.some(value => !value)) throw new XTestError('x_credentials_missing');
  return new TwitterApi({ appKey: values[0]!, appSecret: values[1]!, accessToken: values[2]!, accessSecret: values[3]! });
}
function dependencies(): XTestDependencies {
  return {
    admin: createSupabaseAdminClient({ timeoutMs: 8000 }), archive: loadPaidBriefingArchive,
    facts: async (market, date) => {
      const { data, error } = await createSupabaseAdminClient({ timeoutMs: 8000 })
        .from(market === 'stocks' ? 'macro_bias_scores' : 'crypto_bias_scores')
        .select(market === 'stocks' ? 'trade_date,ticker_changes,window:engine_inputs->tradeWindow,technical_indicators' : 'trade_date,ticker_changes')
        .eq('trade_date', date).maybeSingle();
      if (error) throw new XTestError('market_data_unavailable');
      return data as unknown as GrokXMarketFacts | null;
    },
    verifyAccount: async () => {
      const me = await client().v2.get<{ data: { username: string } }>('users/me', {}, { timeout: 10000 });
      if (me.data.username.toLowerCase() !== 'macro_bias') throw new XTestError('x_account_mismatch');
    },
    publish: async text => {
      const result = await client().v2.post<{ data: { id: string } }>('tweets', { text }, { timeout: 15000 });
      if (!/^\d+$/.test(result.data?.id ?? '')) throw new XTestError('remote_receipt_missing');
      return result.data.id;
    },
    engagement: async ids => {
      if (!ids.length) return [];
      const result = await client().v2.get<{ data?: { id: string; public_metrics?: Record<string, number> }[] }>('tweets', { ids: ids.join(','), 'tweet.fields': 'public_metrics' }, { timeout: 10000 });
      const count = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
      return (result.data ?? []).map(row => ({ id: row.id, impressions: count(row.public_metrics?.impression_count),
        likes: count(row.public_metrics?.like_count), replies: count(row.public_metrics?.reply_count), reposts: count(row.public_metrics?.retweet_count) }));
    },
  };
}
export function buildXTestPost(market: DistributionMarket, items: PaidBriefingArchiveItem[], facts: GrokXMarketFacts | null, now: Date) {
  const today = now.toISOString().slice(0, 10);
  const sourceDate = market === 'stocks' ? today : new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const item = items.find(row => row.date === sourceDate);
  if (!item?.publishedAt || !Number.isFinite(Date.parse(item.publishedAt)) || item.publishedAt.slice(0, 10) !== today
    || Date.parse(item.publishedAt) > now.getTime()) throw new XTestError('fresh_publication_unavailable');
  const commentary = facts?.trade_date === sourceDate ? buildGrokXCommentary(market, facts, now) : null;
  if (!commentary) throw new XTestError('verified_market_commentary_unavailable');
  const contentId = `${market}_${today.replaceAll('-', '')}`;
  const url = new URL(`https://www.macro-bias.com/${market === 'stocks' ? 'briefings' : 'crypto/briefings'}/${sourceDate}`);
  url.search = new URLSearchParams({ utm_source: 'x', utm_medium: 'organic_social', utm_campaign: X_TEST.id, utm_content: contentId }).toString();
  const text = `${commentary.text}\n${url.href}`;
  if (!/^[\x00-\x7f]*$/.test(text) || text.length - url.href.length + 23 > 280) throw new XTestError('post_length_invalid');
  return { market, date: today, sourceDate, marketDataDate: commentary.marketDataDate, contentId, text, trackedUrl: url.href };
}
async function prepare(market: DistributionMarket, now: Date, d: XTestDependencies) {
  const archive = await d.archive(market);
  if (archive.loadError) throw new XTestError('publication_read_unavailable');
  const date = market === 'stocks' ? now.toISOString().slice(0, 10) : new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  return buildXTestPost(market, archive.items, await d.facts(market, date), now);
}
/** Claim before the API call. Unknown outcomes are never automatically retried. */
export async function publishXTest(market: DistributionMarket, now: Date, d: XTestDependencies) {
  if (xTestMarket(now) !== market) throw new XTestError('outside_scheduled_slot');
  const date = now.toISOString().slice(0, 10), id = xTestId(`delivery:${market}:${date}`);
  const existing = await d.admin.from('marketing_event_log').select('metadata').eq('id', id).eq('event_name', X_TEST.deliveryEvent).maybeSingle();
  if (existing.error) throw new XTestError('delivery_read_unavailable');
  if (existing.data) {
    const m = existing.data.metadata;
    if (m?.status === 'published' && /^\d+$/.test(m.remote_id ?? '')) return { status: 'already_published', remoteId: m.remote_id as string };
    throw new XTestError('previous_outcome_needs_review');
  }
  const post = await prepare(market, now, d);
  // Read-only identity failure is safe to recover at 15:30: no send/claim yet.
  await d.verifyAccount();
  const metadata = { ...post, campaign: X_TEST.id, traffic_type: 'internal', status: 'claimed', claimed_at: now.toISOString() };
  const claim = await d.admin.from('marketing_event_log').insert({ id, event_name: X_TEST.deliveryEvent,
    page_path: '/api/cron/x-test', utm_source: 'x', utm_medium: 'organic_social', utm_campaign: X_TEST.id, metadata });
  if (claim.error) throw new XTestError(claim.error.code === '23505' ? 'slot_already_claimed' : 'claim_unavailable');
  let remoteId: string | null = null;
  try { const value = await d.publish(post.text); if (/^\d+$/.test(value)) remoteId = value; } catch { /* Never serialize provider errors or credentials. */ }
  const finished = await d.admin.from('marketing_event_log').update({ metadata: { ...metadata,
    status: remoteId ? 'published' : 'needs_review', remote_id: remoteId, finished_at: new Date().toISOString() } }).eq('id', id).eq('event_name', X_TEST.deliveryEvent);
  if (finished.error || !remoteId) throw new XTestError('publication_outcome_needs_review');
  return { status: 'published', remoteId };
}
async function readEvents(admin: Admin, event: string) {
  const { data, error } = await admin.from('marketing_event_log').select('created_at,metadata')
    .eq('event_name', event).order('created_at', { ascending: false }).limit(100);
  if (error) throw new XTestError('experiment_history_unavailable');
  return data ?? [];
}
export async function xTestReport(now = new Date(), admin = createSupabaseAdminClient({ timeoutMs: 8000 })) {
  const start = now.toISOString().slice(0, 10) < X_TEST.start.slice(0, 10) ? now.toISOString().slice(0, 10) : X_TEST.start.slice(0, 10);
  const filters = { preset: 'custom' as const, start, end: now.toISOString().slice(0, 10), campaign: X_TEST.id, source: 'x' };
  const [first, latest, deliveries, runs, checkpoints] = await Promise.all([
    getAcquisitionReport({ ...filters, touch: 'first' }, admin, now), getAcquisitionReport({ ...filters, touch: 'latest' }, admin, now),
    readEvents(admin, X_TEST.deliveryEvent), readEvents(admin, X_TEST.runEvent), readEvents(admin, X_TEST.growthEvent),
  ]);
  const clean = (report: typeof first) => ({ complete: report.coverage.complete, range: report.range,
    metrics: report.coverage.complete ? report.overview : null, newsletters: report.coverage.complete ? report.newsletterSignups : null,
    posts: report.coverage.complete ? report.attributionContentRows : null, coverage: report.coverage });
  return { capturedAt: now.toISOString(), experiment: X_TEST, phase: now.toISOString() < X_TEST.start ? 'before_start' : xTestOpen(now) ? 'running' : 'ended',
    plan: xTestPlan(), first: clean(first), latestAssist: clean(latest),
    deliveries: deliveries.map(row => row.metadata), runs: runs.map(row => row.metadata), latestCheckpoint: checkpoints[0]?.metadata ?? null };
}
async function checkpoint(now: Date, d: XTestDependencies) {
  const date = now.toISOString().slice(0, 10), id = xTestId(`growth:${date}`);
  const prior = await d.admin.from('marketing_event_log').select('metadata').eq('id', id).eq('event_name', X_TEST.growthEvent).maybeSingle();
  if (prior.error) throw new XTestError('growth_read_unavailable');
  if (prior.data?.metadata?.complete) return prior.data.metadata;
  const report = await xTestReport(now, d.admin);
  const ids = report.deliveries.filter(m => m.status === 'published' && /^\d+$/.test(m.remote_id ?? '')).map(m => m.remote_id as string);
  let engagement: { available: boolean; posts: Engagement[] | null };
  try { const posts = await d.engagement(ids); engagement = { available: posts.length === ids.length, posts }; }
  catch { engagement = { available: false, posts: null }; }
  const metadata = { traffic_type: 'internal', campaign: X_TEST.id, captured_at: now.toISOString(), phase: report.phase,
    complete: report.first.complete && report.latestAssist.complete, first: report.first, latestAssist: report.latestAssist, engagement };
  const { error } = await d.admin.from('marketing_event_log').upsert({ id, event_name: X_TEST.growthEvent,
    page_path: '/api/cron/x-test', metadata }, { onConflict: 'id' });
  if (error) throw new XTestError('growth_checkpoint_unavailable');
  return metadata;
}
export async function runXTest({ live = false, preview = false, now = new Date(), deps }: { live?: boolean; preview?: boolean; now?: Date; deps?: XTestDependencies } = {}) {
  const d = deps ?? dependencies();
  if (!live || preview) {
    let account: { status: string; username?: string; reason?: string };
    try { await d.verifyAccount(); account = { status: 'ready', username: 'macro_bias' }; }
    catch (e) { account = { status: 'unavailable', reason: e instanceof XTestError ? e.code : 'x_account_verification_unavailable' }; }
    const posts = await Promise.all((['stocks', 'crypto'] as const).map(async market => {
      try { return { market, status: 'ready', post: await prepare(market, now, d) }; }
      catch (e) { return { market, status: 'unavailable', reason: e instanceof XTestError ? e.code : 'preview_unavailable' }; }
    }));
    return { mode: 'preview', ok: account.status === 'ready' && posts.every(p => p.status === 'ready'), experiment: X_TEST, plan: xTestPlan(), account, posts };
  }
  if (now.toISOString() < X_TEST.start || now.toISOString() >= X_TEST.finalCheckpointEnd) return { mode: 'inactive', ok: true, experiment: X_TEST };
  const market = xTestMarket(now);
  let result: { market: DistributionMarket; status: string; reason?: string; remoteId?: string } | null = null;
  if (market) {
    try { result = { market, ...await publishXTest(market, now, d) }; }
    catch (e) { result = { market, status: 'blocked', reason: e instanceof XTestError ? e.code : 'publisher_unavailable' }; }
    const { error } = await d.admin.from('marketing_event_log').upsert({ id: xTestId(`run:${market}:${now.toISOString().slice(0, 10)}`),
      event_name: X_TEST.runEvent, page_path: '/api/cron/x-test', metadata: { ...result, date: now.toISOString().slice(0, 10),
        checked_at: now.toISOString(), traffic_type: 'internal', campaign: X_TEST.id } }, { onConflict: 'id' });
    if (error) throw new XTestError('run_log_unavailable');
  }
  const growth = await checkpoint(now, d);
  return { mode: 'live', ok: result?.status !== 'blocked' && growth.complete, experiment: X_TEST, result, growth };
}
