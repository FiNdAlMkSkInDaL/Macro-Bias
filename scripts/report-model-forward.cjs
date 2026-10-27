/** Authorized aggregate read only. Does not capture predictions or settle outcomes. */
require('@next/env').loadEnvConfig(process.cwd());
const overrides = {};
const load = require('./distribution-loader.cjs')(overrides);
overrides['../signal'] = load('src/lib/signal/strategy');
const { readModelEvents, summarizeForward } = load('src/lib/model-forward/service');
const admin = load('src/lib/supabase/admin').createSupabaseAdminClient({ timeoutMs: 15000 });
readModelEvents(admin).then(events => console.log(JSON.stringify(summarizeForward(events), null, 2))).catch(() => {
  console.error('Forward report unavailable; no missing results have been counted as zero.'); process.exitCode = 1;
});
