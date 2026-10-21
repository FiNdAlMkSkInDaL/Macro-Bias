/** Authorized owner reporting only. Prints aggregate metrics, never identities. */
require('@next/env').loadEnvConfig(process.cwd());
const load = require('./distribution-loader.cjs')();
const admin = load('src/lib/supabase/admin').createSupabaseAdminClient({ timeoutMs: 15000 });
const get = load('src/lib/analytics/acquisition-data').getAcquisitionReport;
(async () => {
  const now = new Date(), end = now.toISOString().slice(0, 10);
  const rows = await Promise.all(['x', 'reddit'].flatMap(source => ['stocks', 'crypto'].map(async market => {
    const campaign = market === 'stocks' ? 'mb_growth_202610_stocks_backdrop' : 'mb_growth_202610_crypto_context';
    const report = await get({ preset: 'custom', start: '2026-10-21', end, source, campaign, touch: 'first' }, admin, now);
    return { source, market, campaign, range: report.range, complete: report.coverage.complete,
      metrics: report.coverage.complete ? report.overview : null,
      originalNewsletterChoices: report.coverage.complete ? report.newsletterSignups : null,
      content: report.coverage.complete ? report.contentRows : null, coverage: report.coverage, freshness: report.freshness };
  })));
  console.log(JSON.stringify({ capturedAt: now.toISOString(), touch: 'first', rows,
    note: 'Original opt-ins only. Both counts once overall. Filter per-post content IDs to distinguish the new release from earlier links. Do not add unique visitors across rows or latest-touch assists. No attribution is not proof of no real traffic; consent gaps remain unknown. Newsletter records do not prove verification, readership or ROI.' }, null, 2));
})().catch(() => { console.error('Aggregate acquisition report unavailable; do not substitute zero.'); process.exitCode = 1; });
