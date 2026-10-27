# Publication-aligned scoring research — 27 October 2026

Both newsletters need evidence that their estimates improve decisions. A useful daily reading should distinguish observed market state (trend, relative strength and volatility), estimates of the size of the next move, and a directional forecast. Only the last of these implies an up/down predictive edge. The number is not a probability, and a regime label is not a validated trading instruction.

Implemented two underlying challenger algorithms for **both stocks and crypto**, rather than changing the presentation of existing scores. Neither challenger qualifies for production. The existing daily readings, independent trading checks, stored history, newsletter jobs and X publishing policy are preserved. The only production-engine change resolves identical stock regime thresholds once per call; matching pools and predictions are unchanged.

## Algorithms and locked comparison

- **Aligned, shrunk analogues:** 40 equal-weight nearest neighbours, a 50% shrink toward the past base return/up frequency, three calendar years of eligible training, training-only standardized features clipped at four standard deviations, and volatility-normalized return targets. This tests whether a larger, less extreme match set improves the current 5–7-neighbour approach. It does not reuse the fragile same-regime partition or inverse-distance domination.
- **Aligned ridge:** a regularized return regression and a separate bounded up-frequency regression. Fixed penalty 1 on mean squared loss, unpenalized intercept, monthly refit, three-year training. Uses the existing six stationarized inputs plus 1/5/20/60-session asset returns and 20-session realized volatility. No hyperparameter sweep or sign reversal was selected from the results.
- **Benchmarks:** zero return / 50:50 forecast and cash; trailing training mean / up frequency; always up; 20- and 60-session momentum; current production raw reading and its actual separate permission layer. Continuous asset holding is reported separately for context because its overnight exposure and turnover differ.

The fixed recipe is `scoring-research-recipe.json`; the reproducible aggregate output is `scoring-benchmarks-20261027.json`. Code, recipe and exact price snapshot have SHA-256 fingerprints. The price cache and full per-date predictions are local research artifacts, not subscriber data.

## Timing, data and fairness

Stocks target the next SPY session open-to-close, conditional on receiving the briefing before that open. Crypto targets the full UTC session two calendar days after the source bar: a next-day noon email cannot capture an already elapsed UTC-session return. Actual historical delivery times are not reconstructed here, so these remain timing assumptions, not achieved live execution. Each target is one distinct nonoverlapping full session.

Training requires its target close date to be strictly before the prediction source date, an additional embargo. The production comparator also requires all three-session analogue labels to have matured. Rolling percentiles use only data through their source date, model scaling fits only the then-eligible training set, and ridge refits use only information available at the monthly refit. Crypto shared-market closes carry forward only from the past with a five-calendar-day staleness limit. FX/index quotes on NYSE holidays cannot invent SPY target sessions.

The fixed completed-data cutoff is **26 October 2026**. Stocks: 1,712 scored target sessions; crypto: 2,489. Later `--cutoff` snapshots cannot extend this fixed research evaluation. All historical years were previously inspected and used during earlier development. **Chronological replay prevents direct leakage; it does not make this reused history an untouched holdout.** Current stored open/close prices are not original publication-time data vintages. Different initial warmups, rounded RSI and session alignment can change this reconstruction relative to earlier audit counts.

## Results

Predictive losses below are on identical sessions within each market. Lower is better. Production scores target a different one/three-close blend, so assigning them a probability or a target-return MSE would be misleading; those fields are unavailable.

| Forecast | Stocks return MSE | Stocks up-probability Brier | Crypto return MSE | Crypto up-probability Brier |
|---|---:|---:|---:|---:|
| Zero return / 50:50 | 0.861475 | 0.250000 | 9.628077 | 0.250000 |
| Trailing mean / frequency | 0.861717 | 0.248767 | 9.640660 | 0.250311 |
| 40-neighbour shrunk analogue | 0.860864 | 0.250714 | 9.725959 | 0.252870 |
| Regularized regression | 0.860352 | 0.249858 | 9.632337 | 0.250877 |

The regression models reduce aggregate return MSE by tiny amounts versus the trailing mean, but the paired 95% block intervals include no improvement: stocks −0.012731 to +0.009753 MSE points; crypto −0.106143 to +0.084197. Neither improves up-probability loss over the base-frequency forecast. Both have worse return prediction error in the reviewed 2026 slice. The analogue candidate also fails. A numerically nonzero forecast is not evidence of a useful edge.

For the current raw readings, taking the sign on nonzero-score days gets stocks **51.37%** right versus **54.18%** for always-up on those exact days; crypto **47.35%** versus **50.71%**. This evaluates the number’s sign, including weak neutral readings; the separate production trading decisions are reported independently.

### Trading diagnostics, not an investable track record

Each active position is closed at the target-session close. Fixed round-trip friction is 10bp for stocks and 30bp for crypto. Zero and double costs are reported with positions held fixed, not reoptimized for each cost. Cash earns zero. An always-up session strategy repeatedly pays costs; it is **not buy-and-hold**. Exposure, active counts, drawdowns and same-exposure-long comparisons are included so staying out of the market is not mistaken for directional skill.

| Policy | Stocks mean net / target session | Stocks active sessions | Crypto mean net / target session | Crypto active sessions |
|---|---:|---:|---:|---:|
| Cash | +0.000000% | 0 | +0.000000% | 0 |
| Always up, daily round trip | -0.074570% | 1,712 | -0.156749% | 2,489 |
| 20-session momentum | -0.111628% | 1,712 | -0.208884% | 2,489 |
| 60-session momentum | -0.118072% | 1,711 | -0.215198% | 2,489 |
| Production raw label boundary | -0.020496% | 566 | -0.181428% | 1,709 |
| Production filtered permission | +0.009551% | 249 | -0.179299% | 1,690 |
| 40-neighbour shrunk analogue | -0.007425% | 237 | -0.078892% | 746 |
| Regularized regression | -0.000182% | 132 | +0.024141% | 711 |

The crypto regression’s aggregate +18.10% hypothetical compound return comes with **73.85% drawdown**, turns negative at double costs, and loses **19.51% in 2026**. Its mean net return versus cash has a paired interval of −0.052484% to +0.104037% per target session. Its advantage versus an always-long position on the exact same exposed days also spans zero. It is rejected, not promoted because of one positive aggregate number. The stock regression loses 2.30% overall and 2.32% in 2026 under the specified costs.

The existing stock trading filters have positive aggregate diagnostics, but lose money in four of the seven annual slices, including 2026, and turn negative at double costs. This does not validate the published score as a directional forecast. Crypto’s current filtered diagnostics fail more strongly. Daily trading costs and intermittent exposure make these diagnostics unsuitable for direct comparison with continuously holding an asset. For context only, continuous unadjusted-price SPY holding returned +138.31% with 34.10% close-observed drawdown, and BTC +1045.50% with 76.63% drawdown, over the corresponding target bounds; these include overnight exposure, omit dividends and pay only one round trip.

### A more promising use: forecast risk, independently of direction

A fixed 0.94 EWMA of past, matured target squared returns was compared with constant variance estimated from the same rolling training window. QLIKE evaluates the variance estimate, including underestimation of large moves. Absolute-move MAE additionally uses the explicit, approximate normal RMS-to-absolute conversion; it is not a price interval or a coverage guarantee.

| Risk comparison | Stocks | Crypto |
|---|---:|---:|
| Absolute-move forecast error reduction, all sessions | 9.08% | 10.56% |
| Absolute-move forecast error reduction, 2026 | 19.28% | 4.31% |
| EWMA minus constant QLIKE, lower is better | −0.255399 | +0.033801 |
| Paired 95% interval for QLIKE difference | [−0.541211, −0.056848] | [−0.063327, +0.143819] |

Stocks improve QLIKE in **all seven annual slices**, although the smaller 2026 interval alone includes no improvement. This is a plausible component for a genuinely useful daily “how volatile might the session be?” assessment. Crypto’s smaller typical-error improvement does not survive the tail-sensitive variance test: QLIKE worsens in four of seven years, including 2026. It is not ready to be marketed as a reliable risk forecast. These are reused-history findings and descriptive block intervals, not a prospective validation or a multiple-testing-adjusted proof.

## Promotion and forward evidence

Neither directional challenger passes the recorded promotion checks: baseline-relative prediction quality, recent-period quality, cost robustness and prospective validation. Production is not switched to either. Bigger daily scores, a sign flip, or selecting the best year would not fix the underlying problem.

A useful product should first explain observable market conditions (trend, relative strength, volatility and the concrete conditions that would change the reading), while separately testing any forecast of future direction or movement size. In this batch, adaptive stock risk estimation is the strongest research result; crypto needs further work. Neither newsletter should claim a reliable daily buy/sell edge from these results. This research does not rename or rescale the live daily number.

The optional `--lock-forward` path writes a local append-only, timestamped shadow forecast only before its target session opens. A first crypto lock for source 26 October / target **28 October 00:00 UTC** is preserved in `scoring-shadow-crypto-20261028.json`. Both challengers and the risk estimates are recorded; no outcome or trade is recorded. There is no eligible stock forward lock from this completed-price snapshot: the 27 October target had already opened. Do not backfill it. The lock is one prospective observation, not a completed trial, and this CLI is not a new hosted daily collector.

## Reproduction and checks

```powershell
npx tsx scripts/research-score-benchmarks.ts "$env:TEMP\mb-score-benchmarks-20261027" --lock-forward
npx tsx scripts/verify-scoring-research.ts
npx tsc --noEmit --project scripts/tsconfig.scoring-research.json
```

Use a separate output directory with `--cutoff=YYYY-MM-DD` to collect a later completed-price snapshot under the unchanged recipe. Missing/unfinished prices and labels are never filled with zero. Existing forward locks are not overwritten; a changed recipe/code cannot silently replace them. Price access uses the existing authorized service account read-only; research writes only local files. No email, social post, subscriber, production score, order or database record is created by these commands.

For the full-pipeline leakage check, an earlier cache ending 30 June 2026 was replayed with exactly the same code, then compared with the full 26 October cache. **1,631 stock and 2,373 crypto per-date predictions** match exactly, including the production comparator, training metadata, risk estimates and feature context; only generation timestamps are excluded. Evidence is `scoring-benchmark-verification-20261027.json`. Reproduce with `verify-scoring-research-replay.ts <full-directory> <earlier-directory>`. This is an append-invariance test, not another fresh holdout.

Unit checks cover embargoes, poisoning future and unmatured rows, known regression coefficients, unpenalized intercepts, invalid inputs, cost and short-return signs, insufficient uncertainty samples, crypto UTC alignment and stock weekends. The stock threshold-caching refactor is checked against the original classifications for small, quantile-calibrated and tied histories. Daily-score semantics, existing model checks, dedicated research typecheck and the optimized application build pass.

Method references: [time-ordered validation with a gap](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html), [ridge regression objective](https://scikit-learn.org/stable/modules/linear_model.html#ridge-regression-and-classification). These motivate methodology; all performance figures above come from this repository’s own recorded experiment, not those sources.
