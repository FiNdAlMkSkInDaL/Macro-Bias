# Published chart distribution

The live channel is `macrobias.bsky.social`. Both stocks and crypto have one slot each weekday at 14:15 UTC (15:15 BST; 14:15 GMT), up to five posts per newsletter per week. Closed/missing stock sessions and stale/invalid publications are skipped. The job runs on Vercel with the laptop off. It uses existing briefing data and credentials, with no extra model calls, advertising spend or new paid services. Existing hosting usage applies. The legacy backlog stays disabled. Grok's X/Reddit drafting is separate.

## Copy

Reuse the complete REGIME STATUS paragraph from that day's published briefing, keeping its limitation. Include the dated reading/close, model label, score and tracked link. When a complete paragraph exceeds the platform limit, use a factual comparison between the two latest published chart readings and an explicit limitation, including the news-override status. Malformed/promotional source paragraphs are skipped. No synthetic personal anecdotes, fake endorsements, engagement bait, invented urgency or extra model copy. Exact editorial excerpts cannot repeat on the same channel/market for 14 days.

Every post includes a 1200×630 PNG drawn from up to 30 published numeric readings. The scale is always −100 to +100; horizontal positions use actual dates; long data gaps are not joined. Dates, the base-model label/score and any news override are visible. These are model-context charts, not price charts, backtest returns or forecasts. The public endpoint is `/charts/{stocks|crypto}/{date}` and returns 404 for missing/invalid/unpublished readings and 503 for data failures. Only public publication metadata is used: paid article bodies, news and diagnostics are never serialized into images or feeds. The posting job checks that chart and fresh source scores match before claiming a delivery. Image generation errors prevent publication; no text-only fallback.

Only today's stock briefing or yesterday's completed UTC crypto session is eligible. Publication must be from today, and the score and label must match the stored score for that session. No backlog is read. A news override remains a news override; the pipeline never turns it into a model prediction.

## Delivery and controls

The Vercel cron is `/api/cron/distribution`; it requires `Authorization: Bearer <CRON_SECRET>`. Only production with `DISTRIBUTION_MODE=live` can publish. `DISTRIBUTION_CHANNELS=bluesky` is the initial setting. Preview deployments and unset mode cannot publish. `?preview=1` always previews both markets without claiming or publishing, even in production.

Delivery records use the existing service-only `marketing_event_log`, with event `distribution_delivery` and internal traffic metadata. A deterministic UUID for channel/market/source date is inserted **before** calling the provider. The primary-key constraint is the atomic claim, so simultaneous invocations cannot both send. Published, claimed, and uncertain outcomes are separate metadata states. They are outside the acquisition event allowlist and never count as visitors or subscribers. No database migration is needed.

A timed-out request may have reached the provider. Claims are therefore never automatically reclaimed. An uncertain response, or a crash after claiming, needs review; do not delete and retry a claim unless the remote account has been checked. This prioritises avoiding duplicate posts over guaranteed delivery. The authenticated endpoint includes 14 days of delivery status and returns 503 for unresolved outcomes older than five minutes. Provider errors and credentials are not returned or stored in the log. A database failure prevents sending; a failure after sending retains the claim.

The new `/go/chart/{channel}/{market}/{date}` redirect accepts only supported channels/markets and valid dates. It sends stock readers to `/today` and crypto readers to `/crypto`, with per-channel source, campaign `mb_chart_distribution_v1` and market/date content. The old `/go/{channel}/{market}/{date}` links retain their original `mb_distribution_v1` campaign. Crawlers are not counted as visits; existing consent/bot/internal-traffic filters apply at the destination. Delivery IDs remain compatible across pipeline versions to prevent reposting a session during upgrades.

RSS and JSON feeds include both newsletters, with up to 25 entries each, chart images and canonical stable item IDs. `?market=stocks` or `?market=crypto` selects up to 50 entries for that newsletter. Feed article links use source `rss`, medium `syndication`, campaign `mb_briefing_feed_v1` and market/date content. These feeds are available for future syndication; no Pinterest or other new platform account has been connected.

The sitemap now includes both archives, published dated entries, existing intelligence/regime explainers and useful public pages. Dates come from saved first-publication timestamps; static pages do not receive artificial daily last-modified dates. A metadata outage fails the sitemap rather than silently omitting an archive. Sitemap inclusion supports discovery and does not establish that a search engine indexed a page. Full-briefing authorization is unchanged.

The two public newsletter pages use matching components, market-specific signup defaults and visible optional choices. Either or both newsletters can be selected; neither is rejected before writes/mail. Referral codes are preserved. On mobile, signup precedes the score card. Saved initial signup choices populate the private analytics newsletter totals; people choosing both count once overall and once in each newsletter column. Original historical choices without a snapshot remain unknown. The chart-campaign shortcut filters the same genuine-growth report. Returning signups, reactivations, internal/test traffic and delivery records do not become new subscribers. Attribution requires consent; an unknown source is not evidence of direct acquisition or no traffic.

Each live hosted run also saves one private `distribution_growth_snapshot` checkpoint per UTC day in `marketing_event_log`, using the first-touch chart-campaign report over the last 30 days. It records aggregate metrics, initial newsletter choices, source breakdowns and coverage only. Partial data stores null metrics rather than zero. A repeat run updates that day's checkpoint. Preview requests never write checkpoints. These events are outside the acquisition allowlist, so the monitor cannot become traffic or subscribers. The endpoint exposes the snapshot only after cron-secret authorization; no outbound messages are sent.

## Preview and verification

`npm run verify:distribution` tests claims, ambiguous delivery, log failures, equal scheduling, freshness, score/image mismatch, repetition, preview side effects, fixed redirects, authentication, actual image embeds, feed/sitemap safety and zero-opt-in rejection without live writes. `npm run verify:analytics` covers filtered acquisition, duplicate suppression and immutable newsletter choices. Rendered QA checks both signup pages, desktop/mobile, real PNGs and XML/JSON output. Never submit a real signup as a production smoke test.

To inspect real copy without posting:

```
node --env-file=.env.production.local scripts/preview-distribution.cjs
```

Threads is implemented as an optional destination but is **not enabled**: its saved token failed validation on 12 October 2026 (Meta error 190). Reconnect it before enabling. The legacy refresh job logs/emails refreshed tokens and does not persist them into runtime configuration; do not activate that job as an unattended solution. No X API spending or partner outreach is part of this pipeline.

To pause new posts, set `DISTRIBUTION_MODE=preview` in production and redeploy. Existing posts remain on their platform. Review acquisition by UTM source/campaign and confirmed subscribers, then paid conversions, rather than impressions alone. Low volume is an experiment, not a promise of growth.
