# Macro Bias

Macro Bias is a Next.js 15 and Supabase SaaS that publishes automated daily regime research for equities and crypto. The platform combines quantitative regime models, live market context, structured LLM synthesis, tiered email distribution, track-record dashboards, referral growth loops, and scheduled social distribution.

This README was refreshed against the git history after the previous README edit on 2026-04-16 and against the current `main` branch. The main changes since that edit were Threads publishing support, Meta compliance callbacks, a weekly Threads token-refresh cron, and a refactor of the shared social dispatch pipeline.

## Stack

- Next.js 15 App Router, React 19, TypeScript, Tailwind CSS
- Supabase for Postgres, auth helpers, and admin access
- Anthropic for structured briefing synthesis
- Finnhub plus internal market-data sync modules for research inputs
- Resend for email delivery
- Stripe for checkout, subscriptions, and referral coupons
- X, Bluesky, Threads, and optional Telegram for outbound distribution

## Product Surface

| Surface               | Route(s)                                                                    | Purpose                                                                      |
| --------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Stocks research       | `/today`, `/dashboard`, `/track-record`, `/briefings`                       | Daily bias snapshot, dashboard, track record, and archive                    |
| Crypto research       | `/crypto`, `/crypto/dashboard`, `/crypto/track-record`, `/crypto/briefings` | Crypto landing page, live dashboard, track record, and archive               |
| Conversion and growth | `/emails`, `/pricing`, `/refer`, `/intel/[slug]`, `/feed.json`, `/feed.xml` | Newsletter signup, billing, referrals, marketing posts, and feeds            |
| Admin                 | `/analytics`                                                                | Server-rendered analytics dashboard restricted to the configured admin email |
| Auth callback         | `/auth/callback`                                                            | Supabase auth completion flow                                                |

## How The System Works

### Stocks daily pipeline

Route: `/api/cron/publish`  
Schedule: `45 12 * * 1-5` UTC  
Methods: `GET` and `POST`

1. Validate cron auth using `CRON_SECRET` or `PUBLISH_CRON_SECRET`.
2. Refresh daily market data with `upsertDailyMarketData()`.
3. Load recent `macro_bias_scores` history.
4. Generate the briefing with `generateDailyBriefing()`, which runs the quant and news branches in parallel.
5. Persist the result to `daily_market_briefings`.
6. Deliver tiered emails through Resend.
7. Publish social snippets to the configured outbound channels.

Same-day reruns do not generate a second briefing row. They load the already-persisted briefing and attempt a re-publish or re-distribution pass instead.

### Crypto daily pipeline

Route: `/api/cron/crypto-publish`  
Schedule: `30 12 * * *` UTC  
Methods: `GET` and `POST`

1. Validate cron auth.
2. Refresh crypto market data with `upsertCryptoMarketData()`.
3. Load recent `crypto_bias_scores` history.
4. Generate the crypto briefing with `generateCryptoDailyBriefing()`.
5. Persist the result to `crypto_daily_briefings`.
6. Send tiered crypto emails.
7. Publish social snippets to the configured outbound channels.

Same-day reruns follow the same re-publish pattern as the stocks pipeline.

### Newsletter and growth flows

- `/api/subscribe` upserts `free_subscribers`, stores `stocks_opted_in` and `crypto_opted_in`, generates a referral code, attributes referrals when `ref` is present, enrolls the subscriber in the welcome drip, logs analytics, and tries an immediate first welcome email.
- `/api/cron/welcome-drip` advances the 4-step welcome sequence once per day.
- `/api/referral/status` returns referral progress, masked recent referrals, and reward state for the client.
- `/api/checkout`, `/api/stripe/portal`, and `/api/webhooks/stripe` handle paid subscriptions and billing state.
- `/api/analytics/track` and `/api/analytics/dashboard` power first-party marketing analytics.
- Markdown posts in `src/content/marketing/` are published into `published_marketing_posts` and rendered at `/intel/[slug]`.

## Cron Schedule

| Path                              | Schedule (UTC)  | Purpose                                    |
| --------------------------------- | --------------- | ------------------------------------------ |
| `/api/cron/welcome-drip`          | `0 10 * * *`    | Daily welcome drip processing              |
| `/api/cron/publish`               | `45 12 * * 1-5` | Stocks briefing pipeline                   |
| `/api/cron/crypto-publish`        | `30 12 * * *`   | Crypto briefing pipeline                   |
| `/api/cron/paper-trade`           | `15 13 * * 1-5` | Paper trading simulation after publish     |
| `/api/cron/social-dispatch`       | `15 13 * * 1-5` | Weekday queue drain, morning window        |
| `/api/cron/marketing`             | `30 14 * * 1-5` | Weekday queue drain, midday window         |
| `/api/cron/social-dispatch-pm`    | `0 15 * * 1-5`  | Weekday queue drain, afternoon window      |
| `/api/cron/social-dispatch-eod`   | `0 16 * * 1-5`  | Weekday queue drain, end-of-day window     |
| `/api/cron/post-market-scorecard` | `15 21 * * 1-5` | Publish the daily accountability scorecard |
| `/api/cron/threads-token-refresh` | `0 9 * * 1`     | Weekly Threads token refresh check         |

The paper-trade cron is intentionally scheduled after the stocks publish job so it can depend on the persisted `daily_market_briefings` and `macro_bias_scores` rows for the same market session.

The four weekday queue-drain routes all call the same `handleSocialDispatch()` function in `src/lib/social/scheduled-post-dispatch.ts`. Each run selects all due rows from `scheduled_posts`, sanitizes the copy for social, canonicalizes email CTA links, posts to X, and optionally cross-posts to Bluesky and Threads.

## Social Publishing

### Scheduled queue

The social queue is built in two steps:

1. `src/scripts/schedule-drafts.ts` turns draft JSON files in `src/content/marketing/` into `x-queue-scheduled.json`.
2. `src/scripts/arm-scheduled-social-queue.ts` loads that schedule into the `scheduled_posts` table.

The dispatcher is X-first. It always publishes to X when credentials are present, then best-effort cross-posts to Bluesky and Threads when those integrations are configured. Telegram is used by the daily briefing pipelines, not by the scheduled queue dispatcher.

### Post-market scorecard

Route: `/api/cron/post-market-scorecard`  
Schedule: `15 21 * * 1-5`

This job builds an accountability post from the latest regime call and realized SPY performance, including the current streak and rolling 30-day hit rate. It publishes to X and, when configured, to Bluesky and Threads.

### Threads integration

Threads support was added after the previous README revision and currently includes:

- publish support in `src/lib/social/threads.ts`
- Meta compliance callbacks at `/api/threads/deauthorize` and `/api/threads/delete`
- a weekly token refresh cron at `/api/cron/threads-token-refresh`
- a manual OAuth and token exchange helper at `scripts/threads-auth.ts`

Important: the weekly refresh route can fetch a new long-lived token and email or log it, but it does not update Vercel environment variables automatically. The refreshed token still has to be copied into `THREADS_ACCESS_TOKEN` manually.

## Billing, Referrals, And Analytics

### Billing

- `/api/checkout` supports `GET` redirect mode and `POST` JSON mode.
- Checkout sessions are created with a 7-day Stripe trial.
- `/api/stripe/portal` opens the Stripe billing portal for authenticated users.
- `/api/webhooks/stripe` syncs subscription state into the `users` table and legacy profile flags.

### Free list, paid users, and paywall

- `free_subscribers` stores email list subscribers, newsletter preferences, referral code state, and temporary premium unlock windows.
- `users` stores authenticated paid-user billing state.
- `premium_unlock_expires_at` allows a free subscriber to bypass the normal free-tier paywall temporarily.

### Referrals

The referral system is wired through `/today` landing links, `/refer`, `/api/subscribe`, and `/api/referral/status`.

Current reward fulfillment logic in `src/lib/referral/rewards.ts` uses these thresholds:

| Tier | Verified referrals | Reward                                     |
| ---- | ------------------ | ------------------------------------------ |
| 1    | 1                  | 7-day premium unlock                       |
| 2    | 7                  | 1 free month of Premium via Stripe coupon  |
| 3    | 15                 | Free annual subscription via Stripe coupon |

Note: `src/app/api/referral/status/route.ts` still labels Tier 1 as `3` verified referrals. The fulfillment engine above is the current source of truth at `HEAD`.

### Analytics

The admin analytics page aggregates:

- subscriber and paid-user counts
- opt-in mix for stocks versus crypto
- 24-hour, 7-day, and 30-day marketing events
- top pages, top events, UTM sources, and recent event logs
- welcome drip, referral, and reward metrics
- latest stocks and crypto briefing counts and recent bias history

Access is currently restricted by a hard-coded admin email check in `src/app/analytics/page.tsx`.

## Key API Routes

| Route                        | Method(s)     | Purpose                                                                                |
| ---------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| `/api/subscribe`             | `POST`        | Free newsletter signup, preferences, referral attribution, and welcome drip enrollment |
| `/api/subscribe/unsubscribe` | `POST`        | Email unsubscribe                                                                      |
| `/api/referral/status`       | `GET`         | Referral progress for the referral UI                                                  |
| `/api/bias/latest`           | `GET`         | Latest bias snapshot for the frontend                                                  |
| `/api/analytics/track`       | `POST`        | First-party analytics ingest                                                           |
| `/api/analytics/dashboard`   | `GET`         | Analytics data for the admin dashboard                                                 |
| `/api/checkout`              | `GET`, `POST` | Stripe checkout session creation                                                       |
| `/api/stripe/portal`         | `GET`         | Stripe billing portal redirect                                                         |
| `/api/webhooks/stripe`       | `POST`        | Stripe webhook ingestion and entitlement sync                                          |
| `/api/threads/deauthorize`   | `POST`        | Meta deauthorization callback                                                          |
| `/api/threads/delete`        | `POST`        | Meta GDPR delete callback                                                              |

## Data Model

These are the main tables the current system depends on:

| Table                            | Purpose                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| `etf_daily_prices`               | Cross-asset historical price store used by the model inputs             |
| `macro_bias_scores`              | Daily stocks regime scores and model inputs                             |
| `crypto_bias_scores`             | Daily crypto regime scores and component data                           |
| `daily_market_briefings`         | Persisted stocks briefing ledger                                        |
| `crypto_daily_briefings`         | Persisted crypto briefing ledger                                        |
| `paper_trading_runs`             | One decision ledger row per simulated trading day                       |
| `paper_trading_executions`       | Simulated buy and sell executions produced by the paper trading agent   |
| `paper_trading_portfolio_snapshots` | Daily mark-to-market portfolio state and equity history             |
| `free_subscribers`               | Free email list, preferences, referral data, and temporary unlock state |
| `users`                          | Authenticated paid-user billing record                                  |
| `scheduled_posts`                | Social queue used by the weekday dispatch crons                         |
| `published_marketing_posts`      | Published blog and intel posts                                          |
| `marketing_event_log`            | First-party analytics event log                                         |
| `welcome_email_drip_enrollments` | Welcome sequence enrollment state                                       |
| `welcome_email_drip_deliveries`  | Welcome sequence delivery log                                           |
| `referrals`                      | Referral attribution records                                            |
| `referral_rewards`               | Reward fulfillment ledger                                               |

## Repository Map

```text
src/
  app/
    analytics/                # Admin analytics dashboard
    briefings/                # Stocks briefing archive
    crypto/                   # Crypto landing, dashboard, track record, archive
    dashboard/                # Stocks live dashboard
    emails/                   # Newsletter signup surface
    intel/                    # Marketing post pages
    pricing/                  # Plans and billing surface
    refer/                    # Referral hub
    today/                    # SEO/share landing page
    api/
      analytics/              # Track + dashboard APIs
      bias/                   # Latest bias API
      checkout/               # Stripe checkout
      cron/                   # Stocks, crypto, drip, social, scorecard, Threads refresh
      referral/               # Referral status API
      stripe/                 # Billing portal API
      subscribe/              # Signup + unsubscribe
      threads/                # Meta compliance callbacks
      webhooks/stripe/        # Stripe webhook
  components/
    dashboard/                # Stocks dashboard UI
    track-record/             # Stocks and crypto performance charts
  content/
    marketing/                # Markdown posts and social queue JSON
  lib/
    analytics/                # Event logging helpers
    billing/                  # Subscription status helpers
    briefing/                 # Stocks briefing pipeline
    crypto-bias/              # Crypto scoring logic
    crypto-briefing/          # Crypto briefing pipeline
    crypto-market-data/       # Crypto data sync
    crypto-track-record/      # Crypto backtest logic
    macro-bias/               # Stocks scoring logic
    market-data/              # Stocks data sync and news fetch
    marketing/                # Email delivery, welcome drip, markdown parser
    paper-trading/            # Paper trading agent context and portfolio state
    referral/                 # Referral attribution, rewards, premium unlock
    social/                   # X, Bluesky, Threads, Telegram, scorecard, shared queue dispatch
    supabase/                 # Client factories
    track-record/             # Stocks backtest logic
  scripts/                    # Operational scripts that run against the app data model

scripts/                      # Standalone utility scripts
supabase/migrations/          # Schema history
vercel.json                   # Cron definitions
```

## Scripts And Operator Commands

### App scripts from `package.json`

```bash
npm install
npm run dev
npm run security:audit
npm run schema:audit
npm run typecheck
npm run build
npm run macro-bias:sync
npm run social:arm-queue
npm run referral:report
npm run referral:simulate
```

### Additional operational scripts

```bash
npx tsx src/scripts/run-daily-crypto-bias-sync.ts
npx tsx src/scripts/backfill-crypto-prices.ts
npx tsx src/scripts/publish-marketing-posts.ts
npx tsx src/scripts/schedule-drafts.ts x-queue-drafts-v4.json
npx tsx src/scripts/audit-analytics.ts
npx tsx scripts/audit-backtest.ts
npx tsx scripts/test-regimes.ts
npx tsx scripts/test-crypto-regimes.ts
npx tsx scripts/threads-auth.ts
```

## Environment Variables

The table below reflects the current codebase, not just the checked-in `.env.example`. The checked-in example currently covers only part of the env surface, so use this section as the source of truth when wiring a new environment.

### Core platform

| Variable                        | Required | Purpose                                                      |
| ------------------------------- | -------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes      | Supabase project URL                                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes      | Public Supabase key for browser auth flows                   |
| `SUPABASE_SERVICE_ROLE_KEY`     | Yes      | Server-side admin access for cron routes and writes          |
| `NEXT_PUBLIC_APP_URL`           | Yes      | Canonical app URL used in emails, redirects, and share links |
| `NODE_ENV`                      | No       | Standard Next.js runtime mode                                |

### Cron auth

| Variable              | Required | Purpose                                                           |
| --------------------- | -------- | ----------------------------------------------------------------- |
| `CRON_SECRET`         | Yes      | Primary auth secret for cron routes                               |
| `PUBLISH_CRON_SECRET` | Optional | Backward-compatible fallback secret checked by most cron handlers |

### Research and AI

| Variable            | Required                                      | Purpose                  |
| ------------------- | --------------------------------------------- | ------------------------ |
| `FINNHUB_API_KEY`   | Yes for stocks briefing generation            | Pre-market news source   |
| `ANTHROPIC_API_KEY` | Yes for stocks and crypto briefing generation | Structured LLM synthesis |

### Email delivery

| Variable              | Required                          | Purpose                                 |
| --------------------- | --------------------------------- | --------------------------------------- |
| `RESEND_API_KEY`      | Yes for all email delivery        | Resend transport                        |
| `RESEND_FROM_ADDRESS` | Recommended                       | Authenticated sender address            |
| `SHADOW_RUN_EMAIL`    | Recommended for local and staging | Redirects outbound mail to a safe inbox |

### Billing

| Variable                             | Required                  | Purpose                                                             |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes for frontend checkout | Browser Stripe key                                                  |
| `STRIPE_SECRET_KEY`                  | Yes                       | Server Stripe key                                                   |
| `STRIPE_MONTHLY_PRICE_ID`            | Recommended               | Monthly subscription price ID                                       |
| `STRIPE_ANNUAL_PRICE_ID`             | Yes                       | Annual subscription price ID                                        |
| `STRIPE_PRICE_ID`                    | Fallback                  | Legacy monthly price fallback if `STRIPE_MONTHLY_PRICE_ID` is unset |
| `STRIPE_WEBHOOK_SECRET`              | Yes                       | Stripe webhook signature verification                               |

### Social distribution

| Variable                      | Required             | Purpose                                                                         |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| `X_API_KEY`                   | Yes for X publishing | X API app key                                                                   |
| `X_API_SECRET`                | Yes for X publishing | X API app secret                                                                |
| `X_ACCESS_TOKEN`              | Yes for X publishing | X access token                                                                  |
| `X_ACCESS_SECRET`             | Yes for X publishing | X access token secret                                                           |
| `X_API_KEY_SECRET`            | Legacy fallback      | Older X secret name still supported in the stocks publish route                 |
| `X_ACCESS_TOKEN_SECRET`       | Legacy fallback      | Older X access-secret name still supported in the stocks publish route          |
| `BLUESKY_IDENTIFIER`          | Optional             | Bluesky account identifier                                                      |
| `BLUESKY_APP_PASSWORD`        | Optional             | Bluesky app password                                                            |
| `THREADS_ACCESS_TOKEN`        | Optional             | Long-lived Threads publishing token                                             |
| `THREADS_USER_ID`             | Optional             | Threads user ID                                                                 |
| `THREADS_APP_ID`              | Optional             | Needed by the manual Threads OAuth helper                                       |
| `THREADS_APP_SECRET`          | Optional             | Needed by the manual Threads OAuth helper and weekly refresh route              |
| `TELEGRAM_BOT_TOKEN`          | Optional             | Telegram bot token for daily briefing cross-posts                               |
| `TELEGRAM_CHANNEL_ID`         | Optional             | Telegram channel or chat ID                                                     |
| `DISCORD_PUBLISH_WEBHOOK_URL` | Currently unused     | Discord webhook env is present, but Discord publishing is hard-disabled in code |

## Local Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Fill in the core env vars above. If you want Bluesky, Threads, or the full email and AI stack, add those manually because they are not all present in `.env.example`.
4. Apply Supabase migrations from `supabase/migrations/`.
5. Run `npm run dev`.
6. Run `npm run security:audit`, `npm run schema:audit`, `npm run typecheck`, and `npm run build` before deploying.

## Supabase Security Guardrails

- Every repo-managed table is expected to have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` in migrations.
- New application code must not reference Supabase tables that are missing from `supabase/migrations/`.
- `npm run security:audit` enforces those rules and also flags `SECURITY DEFINER` functions that do not lock `search_path`.
- `npm run schema:audit` checks literal table/column usage in app code against the migrated schema and flags drift.
- Treat a failing security audit as a deployment blocker, even if the app still builds.

### Local cron testing

```bash
# Stocks daily pipeline
curl -X POST http://localhost:3000/api/cron/publish \
  -H "Authorization: Bearer <CRON_SECRET>"

# Paper trading simulation
curl -X POST http://localhost:3000/api/cron/paper-trade \
  -H "Authorization: Bearer <CRON_SECRET>"

# Crypto daily pipeline
curl -X POST http://localhost:3000/api/cron/crypto-publish \
  -H "Authorization: Bearer <CRON_SECRET>"

# Shared social queue dispatcher
curl -X GET http://localhost:3000/api/cron/social-dispatch \
  -H "Authorization: Bearer <CRON_SECRET>"

# Weekly Threads token refresh
curl -X GET http://localhost:3000/api/cron/threads-token-refresh \
  -H "Authorization: Bearer <CRON_SECRET>"
```

## Deployment

The app is deployed on Vercel with cron jobs defined in `vercel.json`. Supabase provides the database and auth surface, Resend handles email, Stripe handles billing, Anthropic provides synthesis, and social distribution is gated by whichever channel credentials are present.

```bash
vercel --prod
```
