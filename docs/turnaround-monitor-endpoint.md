# Turnaround aggregate monitoring endpoint

`GET /api/monitor/turnaround` is a read-only service endpoint for the owner's private cloud monitoring workflow. It requires the existing dedicated `MODEL_MONITOR_READ_TOKEN` bearer token, with at least 32 characters. There is no `CRON_SECRET` fallback. Authentication runs before service reporting. Responses are `no-store`, `noindex`, and vary on Authorization. Unauthorized requests return 401; unexpected acquisition reporting failures return a sanitized 503.

The existing monitor token now authorizes aggregate turnaround reporting as well as the existing model monitor reads. No subscriber identity, email address, raw event, post text, credential, live model diagnostic, or write operation is exposed.

## Contract

- `schemaVersion`: `turnaround-monitor-v1`.
- `capturedAt`: UTC ISO timestamp. `sourceRevision` is the production Git commit when Vercel supplies a valid 40-character SHA.
- `campaign`: `mb_acquisition_turnaround_20261104` only.
- `acquisition`: `getTurnaroundReport` with the fixed 4–17 November UTC acquisition window and 18 November review date. `first` is the primary first-touch report; `latestAssist` is a separate assist report. Each exposes `complete`, `range`, `metrics`, original `newsletters`, `sources`, broad `contents`, UTM `attributionContents`, `coverage`, and `freshness`. Incomplete reports have null metric/breakdown fields. The acquisition exclusions and deduplication remain unchanged.
- `resourceEntries`: remains inside `acquisition`. It reports the three public resource entry paths across all sources. These overlap campaign acquisition; never add these counts to campaign totals or add distinct visitors across rows.
- `deliveries`: `complete` and `rows`. A bounded exact-count read selects only campaign `acquisition_turnaround_delivery` receipts. Each row projects `channel`, `contentId`, `market`, `status`, `account`, `permalink`, `remoteUri`, `remoteCid`, `claimedAt`, `finishedAt`, `repositoryVerified`, and `publicPostVerified`. Unknown fields are null. Only known public account/link shapes are returned. Failed, uncounted, or truncated reads have `complete: false`, `rows: null`, and a fixed error code. Receipt verification fields describe saved launch evidence; they do not replace a fresh public-post check.

The currently declared delivery is the standalone Bluesky `learn_intro` resource post, published 4 November. Pending free directory submissions are not expected delivery receipts or publishing failures. The original X experiment `mb_x_commentary_20261028` is separate and is not included in this endpoint.

`metrics.newSubscribers` is the unique-person primary subscriber count. `newsletters.stocks` and `newsletters.crypto` each include people originally choosing both; `stocks + crypto - both + unknown` equals the unique count. A person choosing both counts once overall. A new subscriber is not proof of verified email, engagement, or causality. Unidentified page views and unattributed subscribers remain unknown rather than becoming zero people or direct traffic.

The endpoint does not schedule publishing, invoke crons, send messages, query Outlook, retry deliveries, generate synthetic traffic, or change subscriber emails or scores.

Verification: `node scripts/verify-turnaround-monitor.cjs`, `node scripts/verify-turnaround-report.cjs`, and `npm run typecheck`.
