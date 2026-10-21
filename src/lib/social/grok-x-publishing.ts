import 'server-only';
import { createHash } from 'node:crypto';
import { TwitterApi } from 'twitter-api-v2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { loadPaidBriefingArchive, type PaidBriefingArchiveItem } from '@/lib/product/paid-briefing-data';
import { buildPublishedChart } from './chart-content';
import type { DistributionMarket } from './distribution-content';

export const GROK_X_END = '2026-10-27T00:00:00.000Z';
export const GROK_X_EVENT = 'grok_x_delivery';
type Admin = ReturnType<typeof createSupabaseAdminClient>;
export type GrokXDependencies = {
  admin: Admin;
  archive: (market: DistributionMarket) => Promise<{ items: PaidBriefingArchiveItem[]; loadError: string | null }>;
  publish: (text: string) => Promise<string>;
};
export class GrokXError extends Error {
  constructor(readonly reason: string, readonly status = 503) { super(reason); }
}
export function grokXWindowOpen(now: Date) {
  return now.toISOString() >= '2026-10-21T00:00:00.000Z' && now.toISOString() < GROK_X_END;
}
function londonDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function grokXSlot(market: DistributionMarket, now: Date) {
  const date = londonDate(now);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return grokXWindowOpen(now) && (market === 'stocks' ? weekday === 2 || date === '2026-10-21' : weekday === 5);
}
export function grokXClaimId(market: DistributionMarket, now: Date) {
  const monday = new Date(`${londonDate(now)}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const hash = createHash('sha256').update(`grok-x:${market}:${monday.toISOString().slice(0, 10)}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function dependencies(): GrokXDependencies {
  return {
    admin: createSupabaseAdminClient({ timeoutMs: 8_000 }),
    archive: loadPaidBriefingArchive,
    publish: async text => {
      const names = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'] as const;
      if (names.some(name => !process.env[name]?.trim())) throw new GrokXError('x_not_configured');
      const client = new TwitterApi({ appKey: process.env.X_API_KEY!, appSecret: process.env.X_API_SECRET!,
        accessToken: process.env.X_ACCESS_TOKEN!, accessSecret: process.env.X_ACCESS_SECRET! });
      // Existing credentials remain on the server. Never let a configuration
      // mistake publish to another connected account.
      const me = await client.v2.me();
      if (me.data.username.toLowerCase() !== 'macro_bias') throw new GrokXError('x_account_mismatch');
      const result = await client.v2.tweet(text);
      if (!/^\d+$/.test(result.data?.id ?? '')) throw new GrokXError('x_outcome_unconfirmed');
      return result.data.id;
    },
  };
}
/** Only public numeric metadata can become a post. No caller text, paid prose,
 * arbitrary destination, mentions, replies, private analytics or account actions. */
export function buildGrokXPost(market: DistributionMarket, items: PaidBriefingArchiveItem[], now: Date) {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const latest = [...items].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest || latest.date > today || latest.date < yesterday || !latest.publishedAt
    || Date.parse(latest.publishedAt) > now.getTime() || now.getTime() - Date.parse(latest.publishedAt) > 36 * 3_600_000
    || market === 'crypto' && latest.date !== yesterday) throw new GrokXError('fresh_publication_unavailable', 409);
  const chart = buildPublishedChart(market, latest.date, items, now.getTime());
  const previous = chart?.points.at(-2);
  if (!chart || !previous || Date.parse(`${chart.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`) > 7 * 86_400_000) {
    throw new GrokXError('verified_comparison_unavailable', 409);
  }
  const campaign = market === 'stocks' ? 'mb_growth_202610_stocks_backdrop' : 'mb_growth_202610_crypto_context';
  const contentId = `grok_${market}_${today.replace(/-/g, '')}`;
  const url = new URL(market === 'stocks' ? 'https://www.macro-bias.com/today' : 'https://www.macro-bias.com/crypto');
  url.search = new URLSearchParams({ utm_source: 'x', utm_medium: 'organic_social', utm_campaign: campaign, utm_content: contentId }).toString();
  const score = (value: number) => value > 0 ? `+${value}` : String(value);
  const text = `${market === 'stocks' ? 'Stocks' : 'Crypto composite'} model readings: ${score(previous.score)} (${previous.date}) to ${score(chart.score)} (${chart.date}), ${chart.label.replace(/_/g, ' ').toLowerCase()}.\n${chart.overrideActive ? 'News override active; these are base-model readings.' : market === 'crypto' ? 'Context across markets, not a BTC price target.' : 'A change in backdrop, not a buy or sell signal.'}\n${url}`;
  // The controlled copy is ASCII, so X's only length substitution is its 23-char
  // URL. No truncation can remove a date or the limitation.
  if (!/^[\x00-\x7f]*$/.test(text) || text.length - url.href.length + 23 > 280) throw new GrokXError('post_length_invalid', 409);
  return { market, sourceDate: chart.date, previousDate: previous.date, publishedAt: latest.publishedAt,
    text, trackedUrl: url.href, campaign, contentId, fingerprint: createHash('sha256').update(text).digest('hex') };
}
export async function previewGrokX(market: DistributionMarket, now = new Date(), deps?: GrokXDependencies) {
  if (!grokXWindowOpen(now)) throw new GrokXError('experiment_ended', 410);
  const d = deps ?? dependencies();
  const archive = await d.archive(market);
  if (archive.loadError) throw new GrokXError('publication_read_unavailable');
  return { ...buildGrokXPost(market, archive.items, now), slotOpen: grokXSlot(market, now), endsAt: GROK_X_END };
}
/** One atomic claim per market/week caps the entire publisher at two posts a
 * week, even across callers, concurrency, fresh source dates and retries. */
export async function publishGrokX(market: DistributionMarket, fingerprint: string, now = new Date(), deps?: GrokXDependencies) {
  if (!grokXWindowOpen(now)) throw new GrokXError('experiment_ended', 410);
  if (!grokXSlot(market, now)) throw new GrokXError('outside_market_slot', 409);
  const d = deps ?? dependencies();
  const id = grokXClaimId(market, now);
  const existing = await d.admin.from('marketing_event_log').select('metadata').eq('id', id).eq('event_name', GROK_X_EVENT).maybeSingle();
  if (existing.error) throw new GrokXError('delivery_read_unavailable');
  if (existing.data) {
    const meta = existing.data.metadata;
    if (meta?.status === 'published' && /^\d+$/.test(meta.remote_id ?? '')) {
      return { status: 'already_published', permalink: `https://x.com/macro_bias/status/${meta.remote_id}` };
    }
    throw new GrokXError('previous_outcome_needs_review', 409);
  }
  const preview = await previewGrokX(market, now, d);
  if (preview.fingerprint !== fingerprint) throw new GrokXError('preview_changed', 409);
  const { slotOpen: _slot, endsAt: _ends, ...post } = preview;
  const metadata = { ...post, traffic_type: 'internal', channel: 'x', status: 'claimed', claimed_at: now.toISOString() };
  const claim = await d.admin.from('marketing_event_log').insert({ id, event_name: GROK_X_EVENT,
    page_path: '/api/marketing/grok-x', utm_source: 'x', utm_medium: 'organic_social', utm_campaign: post.campaign, utm_content: post.contentId, metadata });
  if (claim.error) throw new GrokXError(claim.error.code === '23505' ? 'weekly_claim_exists' : 'claim_unavailable', 409);
  let remoteId: string | null = null;
  try { remoteId = await d.publish(post.text); } catch { /* Provider errors may contain secrets; never return them. */ }
  if (remoteId !== null && !/^\d+$/.test(remoteId)) remoteId = null;
  const finish = await d.admin.from('marketing_event_log').update({ metadata: { ...metadata,
    status: remoteId ? 'published' : 'needs_review', remote_id: remoteId, finished_at: new Date().toISOString() } }).eq('id', id).eq('event_name', GROK_X_EVENT);
  if (finish.error || !remoteId) throw new GrokXError('publication_outcome_needs_review', 409);
  return { status: 'published', permalink: `https://x.com/macro_bias/status/${remoteId}`, trackedUrl: post.trackedUrl, text: post.text };
}
