/** Authorized aggregate reporting only. No identities, recipients or live publishing. */
require('@next/env').loadEnvConfig(process.cwd());
const load = require('./distribution-loader.cjs')();
load('src/lib/social/x-experiment.ts').xTestReport().then(report => {
  console.log(JSON.stringify(report, null, 2));
}).catch(() => { console.error('X experiment report unavailable; do not substitute zero.'); process.exitCode = 1; });
