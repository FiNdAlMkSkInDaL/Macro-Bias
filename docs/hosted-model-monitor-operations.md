# Hosted model checks and owner email alerts

The owner requested monitoring and alerts that continue with the laptop off, and selected email delivery. A separate private GitHub repository, `FiNdAlMkSkInDaL/Macro-Bias-Model-Monitor`, runs an hourly workflow at minute 37 UTC. It is independent of Vercel's daily forecast collector. There is no new paid plan or billing upgrade. Scheduled runs can be delayed or dropped by GitHub; this is hourly monitoring, not an instantaneous or guaranteed delivery service.

## Read and delivery boundaries

`GET /api/monitor/model-forward` requires a dedicated `MODEL_MONITOR_READ_TOKEN` bearer header. It rejects the collector secret, anonymous requests and short/unconfigured tokens before any read. It returns only complete aggregate health, cohort counts and completed-outcome comparisons. It cannot collect forecasts, settle outcomes, send messages or access subscriber identities through its response. The token is never placed in a URL or report. Responses are no-store and noindex. Missing/incomplete data is a failure, not zero activity.

The route uses the same pure projection and fixed policy as the local monitor. It exposes model hash, source commit and deployment ID for provenance, with no future forecast values, feature vectors, fit coefficients, source quotes or browser/subscriber identities. The private runner checks response identity/freshness and reads the actual deployed public source revision to compare the existing 40 protected source hashes. It does not execute code from that public checkout.

The private runner has the dedicated report token, the existing restricted email sending key and the chosen owner recipient in GitHub repository secrets. It has no Supabase credentials or collector/publishing secrets. The sending key is reused because the existing key has sending-only access and cannot create a separate key; it is not changed or revoked. Owner alerts call Resend directly, so a Vercel outage does not prevent the alert attempt. Subscriber email generation, template, schedule, recipient selection and scoring rules are unchanged.

Private issue 1 preserves aggregate monitoring state, queued alert bodies, provider acceptance receipts and deduplication. Nothing is published in a public issue. Outbox entries are saved before sending; retries use the same request/body and Resend idempotency key. Pending deliveries older than 23 hours are flagged for inspection rather than automatically replayed outside the provider's 24-hour key window. If the monitor's own state becomes inaccessible, it attempts a separate idempotent owner failure notice. Failed workflow runs remain visible even when email sending is unavailable. Provider acceptance is distinguished from actual inbox delivery.

## Alerts and finite duration

Alert on new failures, recoveries, sustained early benchmark improvement and the final evaluation. Quiet successful hourly checks do not send email. The fixed minimum 60 observations, last two improving 20-session blocks, adjusted paired intervals and separate cohorts remain unchanged. Hourly polling only evaluates weekly performance on Mondays after 10:30 UTC and confirms it at the next weekly review with new observations. No automatic model promotion or live scoring change.

Captures stop before 1 February 2027; settlement ends on 3 February. After a complete final review and accepted final email, the workflow disables itself. If final reporting or delivery fails, keep the failure visible rather than silently declaring success. Do not extend forecast capture. The independent hosted workflow replaces local daily alert checks; weekly private research also runs in a separate hosted workflow under the same historical design cutoff. Its owner-authorized queue now covers 14 weekly experiments through 27 January; see `cloud-private-model-research.md`. The X experiment's separate follow-up is unchanged.

## Verification

`node scripts/verify-hosted-model-report.cjs` checks the private projection, dedicated auth, no-store responses and sanitized errors. `node scripts/verify-forward-monitor.cjs` checks sample/cohort gates, Monday timing, failures, recovery and deduplication. The private repository's `node verify.cjs <public-source-checkout>` runs a fully mocked outage/recovery/send-failure drill before every live check. It proves durable outbox ordering and same-key retries without sending test messages to subscribers. The application build and unchanged model fingerprint must pass before release.

Set up the dedicated production environment token and three private repository secrets without logging values. Create private issue 1 before enabling the workflow. After deployment, dispatch the hosted workflow with `setup_check=true`, inspect the actual run and saved state, then verify the explicitly labeled owner delivery-check email. Do not run the forecast collector, regenerate scores, create subscribers or send a newsletter to test monitoring.

Read-only sources: [GitHub scheduled workflow limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys). These document delivery mechanics; model results come from the private experiment.
