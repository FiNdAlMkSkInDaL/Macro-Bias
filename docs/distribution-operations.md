# Small distribution pipeline

The first channel is `macrobias.bsky.social`. Stocks run Tuesday and crypto Friday at 14:15 UTC (15:15 BST; 14:15 GMT). This adds two original notes a week, with equal space for both newsletters. It uses the existing Bluesky credentials and the existing briefing; there is no extra model call or advertising spend. The legacy queue and its 157 overdue posts stay disabled. Grok's X/Reddit drafting is separate.

## Copy

Reuse the complete REGIME STATUS paragraph from that day's published briefing. Keep the observation and its limitation together. The post includes the dated reading/close, model label and score, and a link. No synthetic personal anecdotes, fake endorsements, engagement bait, generic promotional fallback, or invented urgency. The shared daily email editorial rules still govern the source. If a complete excerpt does not fit, skip it instead of removing its caveat. Exact excerpts cannot repeat on the same channel/market for 14 days.

Only today's stock briefing or yesterday's completed UTC crypto session is eligible. Publication must be from today, and the score and label must match the stored score for that session. No backlog is read. A news override remains a news override; the pipeline never turns it into a model prediction.

## Delivery and controls

The Vercel cron is `/api/cron/distribution`; it requires `Authorization: Bearer <CRON_SECRET>`. Only production with `DISTRIBUTION_MODE=live` can publish. `DISTRIBUTION_CHANNELS=bluesky` is the initial setting. Preview deployments and unset mode cannot publish. `?preview=1` always previews both markets without claiming or publishing, even in production.

Delivery records use the existing service-only `marketing_event_log`, with event `distribution_delivery` and internal traffic metadata. A deterministic UUID for channel/market/source date is inserted **before** calling the provider. The primary-key constraint is the atomic claim, so simultaneous invocations cannot both send. Published, claimed, and uncertain outcomes are separate metadata states. They are outside the acquisition event allowlist and never count as visitors or subscribers. No database migration is needed.

A timed-out request may have reached the provider. Claims are therefore never automatically reclaimed. An uncertain response, or a crash after claiming, needs review; do not delete and retry a claim unless the remote account has been checked. This prioritises avoiding duplicate posts over guaranteed delivery. The authenticated endpoint includes 14 days of delivery status and returns 503 for unresolved outcomes older than five minutes. Provider errors and credentials are not returned or stored in the log. A database failure prevents sending; a failure after sending retains the claim.

The `/go/{channel}/{market}/{date}` redirect accepts only the two supported channels, the two markets and valid calendar dates. It redirects to a fixed Macro Bias origin with per-channel UTM source, campaign `mb_distribution_v1` and market/date content. It does not count link crawlers as visits. The existing consent and bot filtering apply at the destination.

## Preview and verification

`npm run verify:distribution` tests concurrent claims, ambiguous delivery, log failures, platform independence, freshness, score mismatch, repetition, preview side effects, redirects and authentication without live writes.

To inspect real copy without posting:

```
node --env-file=.env.production.local scripts/preview-distribution.cjs
```

Threads is implemented as an optional destination but is **not enabled**: its saved token failed validation on 12 October 2026 (Meta error 190). Reconnect it before enabling. The legacy refresh job logs/emails refreshed tokens and does not persist them into runtime configuration; do not activate that job as an unattended solution. No X API spending or partner outreach is part of this pipeline.

To pause new posts, set `DISTRIBUTION_MODE=preview` in production and redeploy. Existing posts remain on their platform. Review acquisition by UTM source/campaign and confirmed subscribers, then paid conversions, rather than impressions alone. Low volume is an experiment, not a promise of growth.
