# Stock session risk and hosted forward validation

The public stock newsletter and stock dashboards show an estimated absolute SPY open-to-close move, adapted to recent completed returns. This is the historically tested 0.94 EWMA recipe, using the same three-calendar-year training window and strict source-date embargo as the 27 October research. The percentage is an approximate typical absolute move under the research's normal RMS conversion, not a confidence interval, high-to-low range, overnight-gap forecast or directional prediction. The dollar illustration uses the dated source close as a reference, not an invented opening price. Existing daily scores and trading filters are independent.

The estimate is available to Free and Pro readers. Customer surfaces expose only its source date, target date, capture time, move estimate and reference price. Private predictions, coefficients and training inputs remain server-only. An estimate must have both its capture time and its database creation time before the actual target open. A stale, late, invalid or unreadable estimate displays an unavailable notice; no historical estimate is regenerated and presented as a live forecast.

## Hosted collection

- `/api/cron/model-forward` runs daily at 09:00 UTC. The current Hobby plan can invoke it during the following hour. This precedes the 12:30 UTC newsletter job and the earliest US cash open. It works independently of the laptop and Codex app.
- Existing 00:15, 06:15 and 22:15 price jobs supply completed bars. The stock publisher has an additional idempotent recovery opportunity if a valid risk estimate is missing before dispatch. A risk-data failure does not stop the ordinary newsletter.
- Experiment `mb_model_forward_20261027_v1` captures target sessions before 1 February 2027. Final outcome settlement stops at 3 February 00:00 UTC; subsequent invocations are no-ops. No automatic extension or model promotion occurs.
- Review requires at least 60 completed sessions per market and unchanged algorithm cohort. Trading claims also require at least 20 active decisions and improvement against forecast and cash baselines with costs and uncertainty considered. Counts alone do not establish an edge.
- Stocks target the next genuine SPY open-to-close session. Crypto targets the full UTC session source date + 2 days, respecting next-day newsletter publication latency. Only completed outcomes are settled, after the conservative finality buffer and a stored positive open/close quote are available.
- Ordinary retries and concurrent calls preserve the original slot. Missed targets are not backfilled. There are no orders, marketing posts, new subscribers or manual emails in the test.

The route requires the existing `CRON_SECRET` as a bearer header. Writes require `VERCEL_ENV=production` and `MODEL_FORWARD_MODE` other than `paused`. `?preview=1` is always read-only, including failure handling. Set `MODEL_FORWARD_MODE=paused` and redeploy to stop new collection without altering stored evidence. Do not pass a clock, source date or outcome to the HTTP endpoint; these are derived on the server.

## Frozen learners and benchmarks

The shared portable feature/math code reproduces the previously validated stock and crypto predictions, including the stock EWMA risk estimate. Training and normalization use only then-mature labels. Monthly ridge coefficients are reused from the existing cohort's stored fit so later price revisions cannot silently refit a previous month. An incremental Wilder RSI implementation exactly matches the original helper and removes repeated full-history calculations.

Both markets record the 40-neighbour, 50%-shrunk analogue and regularized regression challengers alongside zero/50:50/cash, historical mean/frequency, always-up, 20/60-session momentum and the current numeric engine with/without its trading permission. The engine comparison is a prepublication reconstruction, not proof of email receipt or a replay of later news overrides. No directional challenger has been approved for production.

Risk benchmarks are rolling constant variance and EWMA. Crypto additionally records a predeclared 50/50 blend of those two estimates, intended to reduce underestimation after quiet periods. Its reused-history experiment is `crypto-risk-shrink-20261027.json`: QLIKE improves from 3.208468 to 3.153991 overall, with point improvements in each annual slice. The 2026 improvement is small and its interval crosses zero. Absolute-move error is worse in 2021. These are research findings; the candidate remains private and requires prospective evidence.

## Storage, identity and privacy

Private rows reuse the existing service-only, RLS-protected `marketing_event_log`. Deterministic UUIDs reserve one prediction per experiment/market/target and a separate outcome per prediction. The collector uses inserts, never updates or upserts, for forecasts and outcomes. A JSONB-order-independent checksum catches changed prediction payloads. The database creation timestamp is authoritative if a slow write crosses the target open. Outcomes retain their settled quote and are never silently regraded after a provider revises prices.

`model_forward_prediction`, `model_forward_outcome` and `model_forward_health` have explicit internal traffic flags, no browser/subscriber identities, and are excluded from acquisition and legacy marketing counters. No migration or new browser permission is required. This does not give anonymous or ordinary authenticated clients table access.

`npm run prebuild` generates a normalized source fingerprint from the fixed learning, feature, calendar and eligibility code. Predictions preserve this model hash, recipe hash, source snapshot hash, source commit when available and Vercel deployment ID. The owner report separates hashes; a later algorithm cannot borrow an earlier algorithm's sample count. Changes to the learning policy require a new recipe/experiment rather than selecting a winning revision from the same future window.

## Review and operations

The owner-only report is `/analytics/models`, linked from acquisition analytics. It shows locked/completed/pending counts, collector health, baseline-relative forecasting losses, cost sensitivity, risk errors and paired 20-session block intervals. An interval needs at least 40 completed observations and does not waive the 60-session review minimum. No outcomes yet is shown as awaiting evidence, not zero error. Query failure is unavailable, not an empty successful test.

Use `node scripts/report-model-forward.cjs` for authorized read-only aggregate checks. Do not call the live cron for a report. An authenticated production `?preview=1` request is a safe deployment preflight; it performs reads and calculations without recording a forecast or a health checkpoint. A deliberate initial live collection can save only future, eligible target sessions and is idempotent.

Relevant checks: `npm run verify:forward-models`, `npx tsc --noEmit`, the existing model/publisher/content/access suites and the optimized build. `verify-model-forward.cjs <prior-research-directory>` also compares actual shared learner outputs with the frozen historical research snapshot. Its providers are in-memory fixtures, with no production writes. Browser QA covers the real public page's unavailable state, owner sign-in protection, and labeled local fixtures for Free/Pro/public estimates, missing data, report tables and actual email HTML on desktop/mobile. Temporary fixtures are removed before release.

This is a hosted collector and an on-demand owner report. It does not promise cloud chat notifications or extend the earlier Outlook/listing schedules.
