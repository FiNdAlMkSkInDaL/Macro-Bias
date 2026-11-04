/** Authorized aggregate report only. Does not publish, create subscribers or send mail. */
require('@next/env').loadEnvConfig(process.cwd());
require('./distribution-loader.cjs')()('src/lib/analytics/turnaround-report').getTurnaroundReport().then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(() => { console.error('Turnaround acquisition unavailable; no missing dataset counted as zero.'); process.exitCode = 1; });
