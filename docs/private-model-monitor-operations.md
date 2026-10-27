# Private model monitoring and research

Owner instruction on 27 October: monitor failures and consistent benchmark improvement, keep improving the underlying accuracy privately, and preserve subscriber emails. The current approved release is main `c01ec5c79606c161c75a529a1ab326c64ef4c5a9`. This task does not roll back its stock risk section or change subscriber content generation, templates, delivery schedules or production scores. `subscriber-model-freeze.json` records normalized hashes of 40 generation, scoring, collection and schedule source files. Ordinary daily content and model fits continue under those existing rules. Do not promote a research model or change those rules without a new explicit owner decision.

## Daily follow-up

Run `node scripts/monitor-model-forward.cjs --record` from the authorized genuine-growth-analytics checkout. Production access is SELECT-only through the existing service configuration. The only writes are dated aggregate local monitoring state. It does not call any live cron, generate scores, settle outcomes, post, send email or create subscriber records. An unavailable read preserves the last complete snapshot and is an access failure, not zero activity. The normal report script remains available for a simpler aggregate inspection.

The former local daily alert task is superseded by the private hosted hourly owner-email monitor. Weekly private research is now also hosted; see `cloud-private-model-research.md`. The checks below describe the unchanged monitoring policy:

- Fresh complete collection health, malformed/changed records and explicit collector errors.
- Missing scheduled stock/crypto forecasts, respecting exchange holidays, the initial already-open stock session and the fixed end date.
- Outcomes more than 48 hours overdue after their target session closes.
- Changes to the frozen subscriber/scoring source files.
- Benchmark improvement within each market/model-hash/recipe cohort separately.

Failure and recovery notices are deduplicated in `model-forward-monitor-state.json`. Preserve the existing two-week X follow-up as a separate automation and do not resume old listing/Outlook schedules. No credentials or subscriber identities belong in saved state or chat output.

The private GitHub workflow now delivers owner emails independently of the laptop and Vercel collector. Weekly research is also hosted; its private ledger is canonical. These are owner email alerts, not cloud notifications in this chat. Check the actual project cron configuration read-only if collector health becomes stale; do not change schedules or invoke a live collector to conceal a missing run. The collector's last immutable initial crypto lock is valid even though its optional source commit is empty; its deployment ID and model hash are preserved. The deployment metadata fallback is fixed for subsequent locks.

## Definition of sustained early evidence

Policy is frozen in `model-monitor-policy.json`. Evaluate performance on Mondays only. Require at least 60 completed observations in the same cohort; an improvement in both of the last two nonoverlapping 20-session blocks as well as overall; a paired 20-session moving-block bootstrap interval wholly below zero; no deterioration in the secondary loss overall or over the last 40 sessions; and confirmation at the next weekly review with additional outcomes. The per-review interval uses 10,000 deterministic replications and conservative Bonferroni tails for 11 primary comparisons across both markets.

Directional challengers are the fixed analogue and ridge learners. They must beat both zero-return and trailing-mean return forecasts on squared error, without worsening up-probability Brier loss. Stock risk EWMA must beat constant variance on QLIKE without worsening absolute-move MAE. The crypto blend must beat both constant variance and EWMA by the same criteria. Counts and intervals do not pool markets, candidate revisions or incomplete results. A market-state score itself is not a probability or a certified trade recommendation.

These are practical alert rules, not an independent confirmatory test: weekly intervals overlap, later looks introduce sequential selection, and comparison-family adjustment does not remove that effect. Describe a qualifying alert as sustained early evidence and show sample sizes, baselines, losses and uncertainty. Do not call it proof of a profitable trading edge. Any trading discussion also needs the existing costs, exposure, active-count and net-return checks. No automatic promotion is allowed. Send a final evaluation after settlement ends on 3 February, even if no candidate qualifies; stop this finite follow-up after that review.

## Private research

The first new hypothesis is declared in `score-calibration-recipe-20261027.json`: a one-feature, nonnegative, ridge-regularized calibration of causal reconstructed raw scores, shrunk 50% toward past average return/up frequency. Only mature outcomes enter training, using a three-year window and monthly fits. No sign flip or parameter search was selected from the results. Training starts with 252 mature reconstructed scores, so its evaluation dates are later than the earlier full-feature experiment. Compare all candidates/baselines on those identical dates.

`node scripts/research-score-calibration.cjs <existing-historical-research-directory> <NEW-output-directory>` writes local per-date evidence and an aggregate report only. It refuses to overwrite an earlier result. The saved report is `score-calibration-results-20261027.json`. It uses previously examined history through 26 October and current stored quote vintages, not a fresh holdout.

Results: 1,459 stock and 2,235 crypto observations. Stock Brier 0.249434 versus base-frequency 0.249411; crypto 0.250622 versus 0.250612 (lower is better). Neither reliably improves probability forecasting. Stock return error improves only slightly with an interval spanning no improvement; crypto return error worsens. Stock policy takes no trades at the declared cost threshold; crypto net diagnostics are negative after the base cost. Both decisions are DO_NOT_PROMOTE. Preserve these failed results rather than tuning against them until they appear to win.

The former local Wednesday research task is paused after migration to the private hosted workflow. Read `cloud-private-model-research.md` and the private cloud ledger before any further research. The local JSON is historical and must not be used to choose or duplicate experiments. The owner authorized a 14-hypothesis weekly queue on 27 October 2026, replacing the original two-hypothesis limit. The historical design cutoff, failed-result preservation and prohibition on subscriber changes or automatic promotion remain in force. The current fixed forward experiment is not expanded or used to choose these recipes.

Verification: `node scripts/verify-forward-monitor.cjs`, `node scripts/verify-score-calibration.cjs`, and `node scripts/generate-forward-fingerprint.cjs --check`. Tests cover false alarms, missing slots, late settlement, weekly/cohort/sample gates, repeated notification suppression, chronological append invariance, poisoned future/unmatured outcomes and monthly fit embargoes. No application source, email or existing forward recipe is modified by this work.
