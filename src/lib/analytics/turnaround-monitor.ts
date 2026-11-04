import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getTurnaroundReport, TURNAROUND } from './turnaround-report';

const MAX_DELIVERIES = 100;
const DELIVERY_EVENT = 'acquisition_turnaround_delivery';
const STATUS = new Set(['claimed', 'published', 'failed', 'uncertain', 'blocked', 'skipped']);
const CHANNEL = new Set(['bluesky', 'x']);
const ACCOUNT = new Set(['macrobias.bsky.social', 'macro_bias']);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function choice(value: unknown, allowed: Set<string>) {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}
function timestamp(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
function publicPermalink(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (url.hostname === 'bsky.app' && /^\/profile\/(?:macrobias\.bsky\.social|did:plc:[a-z0-9]+)\/post\/[a-z0-9]+$/.test(url.pathname)) return url.href;
    if (url.hostname === 'x.com' && /^\/macro_bias\/status\/\d+$/.test(url.pathname)) return url.href;
  } catch { /* Unknown is deliberately not coerced into a verified URL. */ }
  return null;
}

/** Read-only projection. Never return the raw receipt metadata or post text. */
export async function readTurnaroundDeliveries(admin = createSupabaseAdminClient({ timeoutMs: 8_000 })) {
  try {
    const result = await admin.from('marketing_event_log')
      .select('metadata', { count: 'exact' })
      .eq('event_name', DELIVERY_EVENT).eq('utm_campaign', TURNAROUND.campaign)
      .order('created_at', { ascending: true }).limit(MAX_DELIVERIES + 1);
    if (result.error || !Array.isArray(result.data)) return { complete: false as const, rows: null, error: 'delivery_read_unavailable' as const };
    if (result.data.length > MAX_DELIVERIES || !Number.isInteger(result.count) || result.count !== result.data.length)
      return { complete: false as const, rows: null, error: 'delivery_read_truncated' as const };
    const rows = result.data.map(row => {
      const metadata = record(row.metadata);
      return {
        channel: choice(metadata.channel, CHANNEL),
        contentId: choice(metadata.content_id, new Set(['learn_intro'])),
        market: choice(metadata.market, new Set(['stocks', 'crypto', 'both'])),
        status: choice(metadata.status, STATUS),
        account: choice(metadata.account, ACCOUNT),
        permalink: publicPermalink(metadata.permalink),
        remoteUri: typeof metadata.remote_uri === 'string' && /^at:\/\/did:plc:[a-z0-9]+\/app\.bsky\.feed\.post\/[a-z0-9]+$/.test(metadata.remote_uri) ? metadata.remote_uri : null,
        remoteCid: typeof metadata.remote_cid === 'string' && /^b[a-z2-7]{20,100}$/.test(metadata.remote_cid) ? metadata.remote_cid : null,
        claimedAt: timestamp(metadata.claimed_at), finishedAt: timestamp(metadata.finished_at),
        repositoryVerified: typeof metadata.repository_verified === 'boolean' ? metadata.repository_verified : null,
        publicPostVerified: typeof metadata.public_post_verified === 'boolean' ? metadata.public_post_verified : null,
      };
    });
    return { complete: true as const, rows };
  } catch {
    return { complete: false as const, rows: null, error: 'delivery_read_unavailable' as const };
  }
}

/** Only aggregate campaign reporting and explicit public delivery evidence. No writes. */
export async function readTurnaroundMonitorReport(now = new Date()) {
  const [acquisition, deliveries] = await Promise.all([getTurnaroundReport(now), readTurnaroundDeliveries()]);
  const sourceRevision = process.env.VERCEL_GIT_COMMIT_SHA;
  return { schemaVersion: 'turnaround-monitor-v1' as const, capturedAt: now.toISOString(), campaign: TURNAROUND.campaign,
    ...(sourceRevision && /^[a-f0-9]{40}$/.test(sourceRevision) ? { sourceRevision } : {}), acquisition, deliveries };
}
