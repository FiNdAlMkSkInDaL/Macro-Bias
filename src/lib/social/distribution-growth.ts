import 'server-only';
import { createHash } from 'node:crypto';
import { getAcquisitionReport } from '@/lib/analytics/acquisition-data';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { CHART_DISTRIBUTION_CAMPAIGN } from './distribution-content';

/** Private aggregate checkpoint, outside the public acquisition event allowlist. */
export async function recordDistributionGrowth(now = new Date(), admin = createSupabaseAdminClient({ timeoutMs: 5_000 })) {
  const report = await getAcquisitionReport({ preset: '30d', campaign: CHART_DISTRIBUTION_CAMPAIGN, touch: 'first' }, admin, now);
  const hash = createHash('sha256').update(`chart-growth:${now.toISOString().slice(0, 10)}`).digest('hex');
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const snapshot = { traffic_type: 'internal', campaign: CHART_DISTRIBUTION_CAMPAIGN, captured_at: now.toISOString(),
    range: report.range, touch: 'first', complete: report.coverage.complete,
    // Missing/partial data must never be recorded as a definitive zero.
    metrics: report.coverage.complete ? report.overview : null,
    newsletters: report.coverage.complete ? report.newsletterSignups : null,
    sources: report.coverage.complete ? report.sourceRows : null,
    warnings: report.coverage.warnings,
  };
  const { error } = await admin.from('marketing_event_log').upsert({ id, event_name: 'distribution_growth_snapshot',
    page_path: '/api/cron/distribution', metadata: snapshot }, { onConflict: 'id' });
  if (error) throw new Error('growth_snapshot_unavailable');
  return snapshot;
}
