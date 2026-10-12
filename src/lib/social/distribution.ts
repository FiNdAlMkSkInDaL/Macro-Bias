import 'server-only';

import { createHash } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { latestCompletedCryptoTradeDate } from '@/lib/crypto-market-data/crypto-session';
import { isBlueskyConfigured, publishToBluesky } from './bluesky';
import { isThreadsConfigured, publishToThreads } from './threads';
import { buildDistributionPost, scheduledDistributionMarket, type DistributionChannel, type DistributionMarket } from './distribution-content';

const EVENT = 'distribution_delivery';
type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Preview = { market: DistributionMarket; channel: DistributionChannel; date: string; text: string | null; reason: string | null };
export type DistributionDependencies = {
  admin: Admin;
  configured: (channel: DistributionChannel) => boolean;
  publish: (channel: DistributionChannel, text: string) => Promise<string | null>;
};

function defaultDependencies(): DistributionDependencies {
  return {
    admin: createSupabaseAdminClient({ timeoutMs: 8_000 }),
    configured: channel => channel === 'bluesky' ? isBlueskyConfigured() : isThreadsConfigured(),
    publish: (channel, text) => channel === 'bluesky' ? publishToBluesky(text) : publishToThreads(text),
  };
}

/** A deterministic UUID makes the existing event-log PK an atomic, cross-worker claim. */
export function distributionDeliveryId(channel: DistributionChannel, market: DistributionMarket, date: string): string {
  const hash = createHash('sha256').update(`mb_distribution_v1:${channel}:${market}:${date}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function preview(admin: Admin, market: DistributionMarket, channel: DistributionChannel, now: Date): Promise<Preview> {
  const today = now.toISOString().slice(0, 10);
  const date = market === 'crypto' ? latestCompletedCryptoTradeDate(now) : today;
  const table = market === 'crypto' ? 'crypto_daily_briefings' : 'daily_market_briefings';
  const columns = market === 'crypto' ? 'trade_date,score,bias_label,brief_content,created_at' : 'briefing_date,trade_date,quant_score,bias_label,brief_content,generated_at';
  const { data: row, error } = await admin.from(table).select(columns)
    .eq(market === 'crypto' ? 'trade_date' : 'briefing_date', date)
    .order(market === 'crypto' ? 'created_at' : 'generated_at', { ascending: false }).limit(1).maybeSingle();
  const result = { market, channel, date, text: null, reason: null } as Preview;
  if (error) throw new Error('distribution_source_unavailable');
  if (!row) return { ...result, reason: 'fresh_briefing_missing' };
  const source = row as unknown as Record<string, unknown>;
  const created = source[market === 'crypto' ? 'created_at' : 'generated_at'];
  const timestamp = typeof created === 'string' ? Date.parse(created) : NaN;
  // No backfill and no future/previous-day publications. Crypto must use yesterday's completed UTC session.
  if (!Number.isFinite(timestamp) || timestamp > now.getTime() || new Date(timestamp).toISOString().slice(0, 10) !== today) {
    return { ...result, reason: 'briefing_not_published_today' };
  }
  if (source.trade_date !== date) return { ...result, reason: 'source_session_mismatch' };
  const { data: stored, error: scoreError } = await admin.from(market === 'crypto' ? 'crypto_bias_scores' : 'macro_bias_scores')
    .select('score,bias_label').eq('trade_date', date).maybeSingle();
  if (scoreError) throw new Error('distribution_score_unavailable');
  const score = source[market === 'crypto' ? 'score' : 'quant_score'];
  if (!stored || typeof score !== 'number' || !Number.isFinite(score) || score < -100 || score > 100 || stored.score !== score || stored.bias_label !== source.bias_label) {
    return { ...result, reason: 'stored_score_mismatch' };
  }
  const text = typeof source.brief_content === 'string' && typeof source.bias_label === 'string' ? buildDistributionPost({
    market, channel, date, score, label: source.bias_label, content: source.brief_content,
  }) : null;
  return { ...result, text, reason: text ? null : 'no_complete_excerpt_within_limit' };
}

/** Claims are never automatically reclaimed: an ambiguous remote outcome must not cause a duplicate. */
export async function runDistribution(options: {
  now?: Date; live?: boolean; previewBoth?: boolean; channels?: DistributionChannel[];
} = {}, dependencies?: DistributionDependencies) {
  const deps = dependencies ?? defaultDependencies();
  const now = options.now ?? new Date();
  const scheduled = scheduledDistributionMarket(now);
  const live = options.live === true && !options.previewBoth;
  const markets: DistributionMarket[] = options.previewBoth ? ['stocks', 'crypto'] : scheduled ? [scheduled] : [];
  const channels = [...new Set<DistributionChannel>(options.channels ?? ['bluesky'])];
  const results: Array<Preview & { status: string; remoteId?: string }> = [];
  for (const market of markets) {
    for (const channel of channels) {
      let item: Preview;
      try { item = await preview(deps.admin, market, channel, now); }
      catch { results.push({ market, channel, date: now.toISOString().slice(0, 10), text: null, reason: 'source_read_failed', status: 'error' }); continue; }
      if (!item.text) { results.push({ ...item, status: 'skipped' }); continue; }
      if (!live) { results.push({ ...item, status: 'preview' }); continue; }
      if (!deps.configured(channel)) { results.push({ ...item, reason: 'channel_not_configured', status: 'error' }); continue; }
      const fingerprint = createHash('sha256').update(item.text.split('\n\n')[0]).digest('hex');
      const { data: repeats, error: repeatError } = await deps.admin.from('marketing_event_log')
        .select('id').eq('event_name', EVENT).eq('metadata->>channel', channel)
        .eq('metadata->>market', market).eq('metadata->>fingerprint', fingerprint)
        .gte('created_at', new Date(now.getTime() - 14 * 86_400_000).toISOString()).limit(1);
      if (repeatError) { results.push({ ...item, status: 'error', reason: 'repeat_check_failed' }); continue; }
      if (repeats?.length && repeats[0].id !== distributionDeliveryId(channel, market, item.date)) {
        results.push({ ...item, status: 'skipped', reason: 'same_excerpt_used_recently' }); continue;
      }
      const id = distributionDeliveryId(channel, market, item.date);
      const metadata = { pipeline: 'mb_distribution_v1', traffic_type: 'internal', market, channel, source_date: item.date, text: item.text, fingerprint, status: 'claimed', claimed_at: now.toISOString() };
      // No subscriber, visitor or session IDs. Client analytics accepts only its own event allowlist.
      const { error: claimError } = await deps.admin.from('marketing_event_log').insert({
        id, event_name: EVENT, page_path: '/api/cron/distribution', utm_source: channel,
        utm_medium: 'social', utm_campaign: 'mb_distribution_v1', metadata,
      });
      if (claimError) {
        if (claimError.code !== '23505') { results.push({ ...item, status: 'error', reason: 'claim_failed' }); continue; }
        const { data: existing, error: existingError } = await deps.admin.from('marketing_event_log')
          .select('metadata').eq('id', id).eq('event_name', EVENT).maybeSingle();
        const status = existing?.metadata?.status;
        const started = Date.parse(existing?.metadata?.claimed_at ?? '');
        const inProgress = status === 'claimed' && Number.isFinite(started) && now.getTime() - started < 5 * 60_000;
        results.push({ ...item, status: existingError ? 'error' : status === 'published' ? 'already_published' : inProgress ? 'in_progress' : 'needs_review', reason: existingError ? 'delivery_read_failed' : status === 'published' || inProgress ? null : 'previous_outcome_unconfirmed' });
        continue;
      }
      let remoteId: string | null = null;
      try { remoteId = await deps.publish(channel, item.text); } catch { /* Never expose provider messages/tokens. */ }
      const status = remoteId ? 'published' : 'needs_review';
      const { error: finishError } = await deps.admin.from('marketing_event_log')
        .update({ metadata: { ...metadata, status, remote_id: remoteId, finished_at: new Date().toISOString() } })
        .eq('id', id).eq('event_name', EVENT);
      results.push({ ...item, status: finishError ? 'needs_review' : status, reason: finishError ? 'delivery_log_update_failed' : remoteId ? null : 'remote_outcome_unconfirmed', ...(remoteId ? { remoteId } : {}) });
    }
  }
  return { mode: live ? 'live' : 'preview', scheduledMarket: scheduled, results,
    ok: results.every(item => !['error', 'needs_review'].includes(item.status)) };
}

export async function distributionDeliveryHealth(now = new Date(), admin = createSupabaseAdminClient({ timeoutMs: 8_000 })) {
  const { data, error } = await admin.from('marketing_event_log').select('id,metadata,created_at')
    .eq('event_name', EVENT).gte('created_at', new Date(now.getTime() - 14 * 86_400_000).toISOString())
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error('distribution_health_unavailable');
  return (data ?? []).map(row => ({ id: row.id, channel: row.metadata?.channel, market: row.metadata?.market,
    date: row.metadata?.source_date, status: row.metadata?.status === 'claimed' && now.getTime() - Date.parse(row.metadata?.claimed_at ?? '') >= 5 * 60_000 ? 'needs_review' : row.metadata?.status,
    remoteId: row.metadata?.remote_id ?? null }));
}
