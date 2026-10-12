/** Read-only: node --env-file=.env.production.local scripts/preview-distribution.cjs */
const load = require('./distribution-loader.cjs')();
const { runDistribution, distributionDeliveryHealth } = load('src/lib/social/distribution.ts');
(async () => {
  const preview = await runDistribution({ live: false, previewBoth: true, channels: ['bluesky', 'threads'] });
  const deliveries = await distributionDeliveryHealth();
  console.log(JSON.stringify({ ...preview, deliveries }, null, 2));
})().catch(() => { console.error('Distribution preview unavailable. Check the server environment and database access.'); process.exitCode = 1; });
