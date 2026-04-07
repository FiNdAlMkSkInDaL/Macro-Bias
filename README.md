# MACRO BIAS — SYSTEM ARCHITECTURE & DOCUMENTATION

## 1. High-Level Overview

Macro Bias is a quantitative financial SaaS dashboard for day traders. It replaces discretionary gut-feeling analysis with a rigorous mathematical framework: the system scans intermarket data across 9 tickers every morning, computes a macro regime score, and pattern-matches today's tape against a full decade of historical sessions using a K-Nearest Neighbors (KNN) model. The output is a single -100 to +100 Bias Score, a regime label, and a forward-looking intraday playbook showing SPY gap, drift, and session range expectations derived from the most statistically similar historical sessions.

**Production URL:** https://www.macro-bias.com  
**Model version (current):** `macro-model-v3-knn`

---

## 2. Tech Stack

| Layer               | Technology                     | Version                |
| ------------------- | ------------------------------ | ---------------------- |
| Frontend Framework  | Next.js (App Router)           | ^15.2.3                |
| UI Library          | React                          | ^19.0.0                |
| Styling             | Tailwind CSS                   | ^3.4.19                |
| Database & Auth     | Supabase (PostgreSQL + GoTrue) | ^2.49.8                |
| Hosting & Cron      | Vercel (Serverless + Edge)     | —                      |
| Payments            | Stripe                         | ^18.1.1                |
| Social Distribution | X (Twitter) API v2             | twitter-api-v2 ^1.29.0 |
| Content Parsing     | gray-matter                    | ^4.0.3                 |
| OG Image Generation | @vercel/og (Edge Runtime)      | ^0.11.1                |
| Charting            | Recharts                       | ^3.8.1                 |
| Script Runner       | tsx                            | ^4.19.3                |
| Language            | TypeScript                     | ^5.8.2                 |

**Typography:** Space Grotesk (headlines) + IBM Plex Mono (data/metadata). Theme: `bg-zinc-950` base, terminal/brutalist aesthetic, no radial gradients.

---

## 3. Repository Structure

```
src/
  app/
    page.tsx                        # Landing page — auth (sign in / sign up)
    layout.tsx                      # Root layout, structured data (Schema.org), SEO metadata
    globals.css                     # Global Tailwind base styles
    robots.ts                       # Crawl rules — disallows /dashboard and /auth/callback
    sitemap.ts                      # XML sitemap — single page, daily changeFrequency
    dashboard/
      page.tsx                      # Pro dashboard (server-rendered, force-dynamic + noStore)
    auth/
      callback/route.ts             # Supabase email-confirmation callback → redirect to /dashboard
    api/
      bias/latest/route.ts          # GET: latest bias snapshot + pillar breakdown + historical analogs
      checkout/route.ts             # POST: creates Stripe Checkout session (monthly or annual)
      cron/
        marketing/route.ts          # GET: scheduled X content publisher by campaignType
        publish/route.ts            # GET: daily engine — ingest, score, write DB, post to X
      og/route.tsx                  # GET: dynamic 1200×630 OG image (Edge Runtime)
      stripe/portal/route.ts        # GET: redirects to Stripe billing portal
      webhooks/stripe/route.ts      # POST: Stripe webhook handler (Node.js runtime)
  components/
    paywall-wrapper.tsx             # Client component — realtime paywall gating via Supabase subscription
    dashboard/
      BiasGauge.tsx                 # Animated -100/+100 score bar with regime label
      AssetHeatmap.tsx              # Per-ticker price + daily change grid (SPY/QQQ/XLP/TLT/GLD)
      SignalBreakdown.tsx           # Three-pillar diagnostic card (VIX / HYG-TLT / SPY RSI)
      ShareEdgeButton.tsx           # Share button that copies the dashboard share URL
  content/
    marketing/
      *.md                          # Flat gray-matter X content files filtered by campaignType
  lib/
    server-env.ts                   # getRequiredServerEnv / getAppUrl helpers
    stripe.ts                       # Singleton Stripe client, plan price ID helpers
    billing/
      subscription.ts               # getUserSubscriptionStatus, isSubscriptionActive
    macro-bias/
      calculate-daily-bias.ts       # KNN engine — vector build, z-scoring, Euclidean distance, scoring
      constants.ts                  # TRACKED_TICKERS, BIAS_PILLAR_WEIGHTS, ANALOG_MODEL_SETTINGS
      technical-analysis.ts         # calculateSimpleMovingAverage, calculateRelativeStrengthIndex (Wilder)
      types.ts                      # All shared TypeScript types for the model
      mock-bias-data.ts             # Dev fixture data (risk-on / neutral / risk-off scenarios)
    market-data/
      upsert-daily-market-data.ts   # Full sync pipeline: Yahoo → Supabase → calculateDailyBias
      get-latest-bias-snapshot.ts   # Single query: most recent macro_bias_scores row
      derive-historical-analogs.ts  # Post-score analog enrichment: overnightGap / intradayNet / sessionRange
    marketing/
      markdown-parser.ts            # Gray-matter parser for flat marketing content directory
    supabase/
      admin.ts                      # createSupabaseAdminClient (service-role key)
      browser.ts                    # createSupabaseBrowserClient (anon key, client-side)
      server.ts                     # createSupabaseServerClient (SSR cookie-based)
      middleware.ts                 # updateSession — refreshes auth token on every request
  middleware.ts                     # Next.js edge middleware — protects /dashboard, builds redirectTo
  types/
    index.ts                        # CORE_ASSET_TICKERS, AssetTicker, BiasAsset, BiasData
  scripts/
    run-daily-macro-bias-sync.ts    # Manual trigger for upsertDailyMarketData (npm run macro-bias:sync)
  utils/
    knn.ts                          # Shared KNN helper utilities
    quantMath.ts                    # Quant math helpers used by publish-time analog logic
supabase/
  migrations/
    20260405_init_macro_bias.sql                # Core tables: etf_daily_prices, macro_bias_scores
    202604050001_create_users_table.sql         # Billing users table + on_auth_user_created trigger
    202604050002_upgrade_macro_model.sql        # Adds technical_indicators column, expands ticker constraint
    202604050003_add_uso_to_macro_model.sql     # Adds USO to ticker constraint
    202604050003_enable_knn_macro_model.sql     # Sets model_version default to macro-model-v3-knn
    202604070001_create_published_marketing_posts.sql # Marketing post publication ledger
vercel.json                                     # Publish cron plus marketing distribution schedules
```

---

## 4. The KNN Scoring Model

### 4.1 Tracked Universe

| Category                            | Tickers                      | Role                                            |
| ----------------------------------- | ---------------------------- | ----------------------------------------------- |
| Core ETFs (stored + displayed)      | SPY, QQQ, XLP, TLT, GLD      | Primary OHLCV storage, front-end ticker changes |
| Supplemental (stored, model inputs) | VIX (`^VIX`), HYG, CPER, USO | Feature construction for KNN vectors            |

### 4.2 Feature Vector (6 dimensions)

Each trading session is represented as a 6-dimensional state vector:

| Feature Key    | Construction                                  | Pillar                |
| -------------- | --------------------------------------------- | --------------------- |
| `spyRsi`       | Wilder RSI(14) of SPY adjusted close          | Trend & Momentum      |
| `qqqXlpRatio`  | QQQ close ÷ XLP close (level-based)           | Trend & Momentum      |
| `hygTltRatio`  | HYG close ÷ TLT close (level-based)           | Credit & Risk Spreads |
| `cperGldRatio` | CPER close ÷ GLD close (level-based)          | Credit & Risk Spreads |
| `usoMomentum`  | USO 5-session momentum (% change over 5 days) | Credit & Risk Spreads |
| `vixLevel`     | VIX close (absolute level)                    | Volatility            |

Ratios are level-based (not percent-change) to capture cross-asset leadership structure. USO uses a 5-session lookback (`ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions = 5`) to reduce single-day noise in the energy tape.

### 4.3 KNN Matching Algorithm

1. **History requirement:** Minimum 730 calendar days of stored OHLCV data and at least 20 historical analog vectors (`ANALOG_MODEL_SETTINGS.minimumHistoricalAnalogs`).
2. **Z-score normalization:** Each feature dimension is standardized using population mean and standard deviation computed from the full historical sample before distance calculations.
3. **Euclidean distance:** Standard Euclidean distance is computed in z-score space across all 6 features for every historical session.
4. **Neighbor selection:** The top `k = 5` nearest sessions are selected (`ANALOG_MODEL_SETTINGS.nearestNeighborCount`).
5. **Expectancy derivation:**
   - `averageForward1DayReturn` = mean SPY next-session return of the 5 neighbors
   - `averageForward3DayReturn` = mean SPY 3-session return of the 5 neighbors
   - `bearishHitRate1Day` / `bearishHitRate3Day` = fraction of neighbors with negative forward returns
6. **Score mapping:** The blended forward return is mapped to the -100 to +100 scale using `ANALOG_MODEL_SETTINGS.blendedReturnScale = 2.75`. A blended return of +2.75% maps to +100; -2.75% maps to -100.

### 4.4 Pillar Weights

| Pillar                | Key                    | Weight |
| --------------------- | ---------------------- | ------ |
| Trend & Momentum      | `trendAndMomentum`     | 30%    |
| Credit & Risk Spreads | `creditAndRiskSpreads` | 40%    |
| Volatility            | `volatility`           | 30%    |

### 4.5 Bias Score Labels

| Score Range | Label              |
| ----------- | ------------------ |
| ≤ −60       | `EXTREME_RISK_OFF` |
| −60 to −21  | `RISK_OFF`         |
| −20 to +20  | `NEUTRAL`          |
| +21 to +59  | `RISK_ON`          |
| ≥ +60       | `EXTREME_RISK_ON`  |

---

## 5. The Core Data Pipeline

### 5.1 Daily Automated Run

**Cron schedule:** `30 12 * * *` (UTC) = **8:30 AM ET**, one hour before the New York open.  
**Endpoint:** `GET /api/cron/publish`  
**Runtime:** Node.js serverless function  
**Auth:** `CRON_SECRET` (or `PUBLISH_CRON_SECRET`) via `Authorization: Bearer <secret>` header or `x-cron-secret` header, verified with `crypto.timingSafeEqual` to prevent timing attacks.

**Full execution sequence:**

```
Vercel Cron → GET /api/cron/publish
  │
  ├─ 1. Auth check (timingSafeEqual CRON_SECRET)
  │
  ├─ 2. upsertDailyMarketData()
  │     ├─ Fetch OHLCV from Yahoo Finance Chart API
  │     │   ├─ Core tickers: SPY, QQQ, XLP, TLT, GLD
  │     │   └─ Supplemental tickers: ^VIX, HYG, CPER, USO
  │     ├─ Holiday/missing-data fallback: step back until valid session found
  │     ├─ Upsert rows into etf_daily_prices (ON CONFLICT ticker, trade_date)
  │     ├─ Compute technical_indicators per ticker:
  │     │   └─ SPY: rsi14 (Wilder), distanceFromSmaPercent (SMA20)
  │     ├─ Build HistoricalAnalogVectors from stored OHLCV (min 730 days lookback)
  │     ├─ calculateDailyBias() — run KNN engine
  │     └─ Upsert result into macro_bias_scores (ON CONFLICT trade_date)
  │
  ├─ 3. Read last 180 snapshots from macro_bias_scores for publish-time analog matching
  │     └─ Weighted Euclidean distance using 11 features:
  │         score, SPY%, QQQ%, XLP%, TLT%, GLD%, VIX%, HYG%, CPER%, spyRsi14, spyDistanceSma
  │         (requires ≥ 4 overlapping features to count as a valid match)
  │
  ├─ 4. Build PublishPayload
  │     ├─ headline, regimeSentence, discordText, xText
  │     ├─ dashboardUrl, shareUrl, ogImageUrl
  │     └─ top analog matches (tradeDate, score, biasLabel, similarity)
  │
  ├─ 5. Post tweet to X (Twitter) via twitter-api-v2
  │     └─ OAuth 1.0a user-context: X_API_KEY + X_API_SECRET + X_ACCESS_TOKEN + X_ACCESS_SECRET
  │
  └─ 6. Return JSON publish summary
```

### 5.2 Marketing Content Distribution

Three additional cron routes manage evergreen educational and promotional X posts:

- `GET /api/cron/marketing?type=weather` → `30 17 * * 1-5` (UTC) = **12:30 PM ET**, Monday-Friday
- `GET /api/cron/marketing?type=close` → `15 20 * * 1-5` (UTC) = **3:15 PM ET**, Monday-Friday
- `GET /api/cron/marketing?type=marketing` → `0 15 * * *` (UTC) = **10:00 AM ET**, daily

Each marketing cron run:

1. Validates `CRON_SECRET` / `PUBLISH_CRON_SECRET` using the same header flow as `/api/cron/publish`.
2. Reads flat `.md` files from `src/content/marketing/` through `src/lib/marketing/markdown-parser.ts`.
3. Parses gray-matter frontmatter and filters by `campaignType` (`weather`, `close`, or `marketing`).
4. Loads previously published slugs from `published_marketing_posts` using the Supabase service-role client.
5. Publishes the first available post to X via `twitter-api-v2`.
6. Inserts `{ slug, published_at }` into `published_marketing_posts` to prevent duplicates.

**Current content state (2026-04-07):** the flat content directory contains sample `weather` and `close` posts plus evergreen `marketing` posts. All three campaign types are wired through the same parser and cron route.

Publishing state for the marketing cron is tracked in the database ledger, not in markdown frontmatter. The `published` field in content files is currently editorial metadata only.

### 5.3 Manual Sync Script

Run outside of the Vercel cron at any time for backfills or debugging:

```bash
npm run macro-bias:sync
```

Executes `src/scripts/run-daily-macro-bias-sync.ts` via `tsx`, loads `.env.local` via `@next/env`, runs `upsertDailyMarketData()`, and pretty-prints `{ tradeDate, score, label }` to stdout.

### 5.4 Data Source

OHLCV data is fetched from the **Yahoo Finance Chart API** (`query2.finance.yahoo.com/v8/finance/chart/`). The raw response is typed as `YahooChartResponse` and mapped to `DailyPriceInsert` rows. Adjusted close is read from the `adjclose` indicator array.

---

## 6. Database Schema

All tables live in the `public` schema. `etf_daily_prices`, `macro_bias_scores`, and `users` have RLS enabled. `published_marketing_posts` is a server-managed ledger with RLS disabled. Server-side code uses the service-role key when it needs to bypass RLS or write publication state; browser clients use the anon key.

### `etf_daily_prices`
| Column                               | Type            | Notes                                                                   |
| ------------------------------------ | --------------- | ----------------------------------------------------------------------- |
| `id`                                 | `uuid`          | PK, `gen_random_uuid()`                                                 |
| `ticker`                             | `text`          | Constraint: SPY, QQQ, XLP, TLT, GLD, VIX, HYG, CPER, USO                |
| `trade_date`                         | `date`          | Unique with ticker                                                      |
| `open/high/low/close/adjusted_close` | `numeric(12,4)` | OHLC + split-adjusted close                                             |
| `volume`                             | `bigint`        |                                                                         |
| `source`                             | `text`          | Default `'yahoo-chart-api'`                                             |
| `technical_indicators`               | `jsonb`         | Per-ticker computed indicators (e.g. SPY RSI14, distanceFromSmaPercent) |
| `created_at`                         | `timestamptz`   |                                                                         |

Indexes: `(ticker, trade_date DESC)`, `(trade_date DESC)`

### `macro_bias_scores`
| Column                      | Type          | Notes                                                          |
| --------------------------- | ------------- | -------------------------------------------------------------- |
| `id`                        | `uuid`        | PK                                                             |
| `trade_date`                | `date`        | Unique                                                         |
| `score`                     | `integer`     | Constraint: -100 to +100                                       |
| `bias_label`                | `text`        | Constraint: one of the 5 label values                          |
| `component_scores`          | `jsonb`       | Array of `BiasComponentResult` (pillar diagnostics)            |
| `ticker_changes`            | `jsonb`       | `TickerChangeMap` — per-ticker close, prevClose, percentChange |
| `model_version`             | `text`        | Default `'macro-model-v3-knn'`                                 |
| `engine_inputs`             | `jsonb`       | Full inputs snapshot for the publish-time analog matcher       |
| `technical_indicators`      | `jsonb`       | SPY and supplemental indicator values at snapshot time         |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` auto-maintained by trigger                        |

Index: `(trade_date DESC)`, `(model_version)`

### `users` (billing)
| Column                      | Type          | Notes                                                                                          |
| --------------------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| `id`                        | `uuid`        | FK → `auth.users(id)`, ON DELETE CASCADE                                                       |
| `email`                     | `text`        | Unique                                                                                         |
| `subscription_status`       | `text`        | One of: inactive, active, trialing, past_due, canceled, unpaid, incomplete, incomplete_expired |
| `stripe_customer_id`        | `text`        | Unique                                                                                         |
| `stripe_subscription_id`    | `text`        | Unique                                                                                         |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` auto-maintained by trigger                                                        |

A `handle_new_user()` trigger automatically inserts a `users` row (or updates email) on every new `auth.users` insert.  
RLS policy: users can `SELECT` their own row only (`auth.uid() = id`).

### `published_marketing_posts`
| Column         | Type          | Notes                                          |
| -------------- | ------------- | ---------------------------------------------- |
| `slug`         | `text`        | PK, used as the deduplication key across posts |
| `published_at` | `timestamptz` | Default `now()`                                |

RLS is disabled on this table. It is written by `GET /api/cron/marketing` through the service-role Supabase client to prevent reposting the same markdown slug.

### `profiles` (optional enrichment)
Not created by a tracked migration, but referenced by the billing layer. Columns used: `id`, `is_pro` (boolean), `stripe_customer_id`. The billing code gracefully ignores missing-table errors (`42P01`, `PGRST204`, `PGRST205`).

---

## 7. API Routes

### `GET /api/bias/latest`
**Runtime:** Edge-compatible serverless (force-dynamic, revalidate=0)  
Returns the most recent `macro_bias_scores` row enriched with:
- **Pillar breakdown** (`PillarBreakdown[]`): aggregated contribution, signal, weight, analog dates, forward return stats grouped by pillar key
- **Historical analogs** (`HistoricalAnalogsPayload`): derived from `deriveHistoricalAnalogs()` — top 5 matches with `overnightGap`, `intradayNet`, `sessionRange` pulled from the persisted OHLCV engine inputs; cluster average playbook; aligned session count; candidate count; feature tickers used
- **Ticker changes** filtered to `CORE_ASSET_TICKERS` (SPY, QQQ, XLP, TLT, GLD)

Response shape:
```ts
{
  data: {
    score: number;               // -100..+100
    label: string;               // BiasLabel
    tradeDate: string;           // YYYY-MM-DD
    createdAt: string;
    updatedAt: string;
    componentScores: PillarBreakdown[];
    tickerChanges: Record<AssetTicker, FrontendTickerChange>;
    historicalAnalogs: HistoricalAnalogsPayload | null;
  }
}
```

### `POST /api/checkout?plan=monthly|annual`
**Runtime:** Node.js  
Creates a Stripe Checkout Session for the authenticated user. Upserts a `users` row for the user, verifies the subscription is not already active, then creates a Stripe session with `payment_method_types: ['card']`, success/cancel URLs, and `metadata.supabaseUserId`. Returns `{ url }` for client-side redirect.

### `GET /api/stripe/portal`
**Runtime:** Node.js  
Resolves the user's `stripe_customer_id` (checking `profiles` first, then `users`) and creates a Stripe Billing Portal session with `return_url: https://macro-bias.com/dashboard`. Returns `{ url }` for redirect.

### `POST /api/webhooks/stripe`
**Runtime:** Node.js (raw body required for signature verification)  
Verifies the Stripe webhook signature using `STRIPE_WEBHOOK_SECRET`. Handles:
- `checkout.session.completed` → resolves user by `metadata.supabaseUserId` / `supabaseUUID`, updates `users.subscription_status` and `profiles.is_pro`
- `invoice.paid` → same sync via subscription ID or customer email fallback
- `customer.subscription.updated` / `customer.subscription.deleted` → updates subscription status

User resolution waterfall (most → least reliable):
1. `metadata.supabaseUUID` / `supabaseUserId` / `supabase_uuid` / `supabase_user_id`
2. `stripe_subscription_id` lookup in `users`
3. `stripe_customer_id` lookup in `users`
4. Email address lookup in `users`

> **Production webhook URL:** `https://www.macro-bias.com/api/webhooks/stripe`  
> Use the `www.` subdomain. The apex domain `macro-bias.com` returns a 307 redirect before the Next.js handler runs, which breaks Stripe's raw-body signature verification.

### `GET /api/cron/publish`
See Section 5.1 — The Core Data Pipeline.

### `GET /api/cron/marketing?type=weather|close|marketing`
**Runtime:** Node.js  
Validates the same cron secret as `/api/cron/publish`, loads flat markdown posts from `src/content/marketing/`, filters them by gray-matter `campaignType`, excludes any slug already present in `published_marketing_posts`, publishes the first available post to X, and then records the slug as published. Returns either a publish summary (`{ ok, published, slug, tweetId, type, publishedAt }`) or a no-op reason when no matching unpublished post exists.

### `GET /api/og`
**Runtime:** Edge (`@vercel/og`)  
Fetches the latest `macro_bias_scores` row from Supabase and renders a 1200×630 OG image using JSX-in-Edge. Visual elements: score (color-coded green/orange/white), gauge progress bar, regime label, trade date, and tagline. Falls back to a "warming up" placeholder if no snapshot exists. Used by the publish cron payload and share assets; the default site metadata currently points at static OG/Twitter image files.

---

## 8. Frontend Architecture

### 8.1 Landing Page (`/`)
Client component. Handles both sign-in and sign-up in a single form via `mode: 'signin' | 'signup'`. Uses `createSupabaseBrowserClient` for auth. After successful auth, redirects to `?redirectTo` query param (sanitized to prevent open-redirect) or `/dashboard`.

Displays three marketing stat blocks and three "quant pillars" (Volatility / Credit Spreads / Trend) with methodology descriptions.

### 8.2 Dashboard Page (`/dashboard`)
Server component. Declares `export const dynamic = "force-dynamic"` and calls `noStore()` to force request-time data fetching. Protected by middleware — unauthenticated users are redirected to `/?redirectTo=/dashboard`.

**Data flow:**
1. Calls `getUserSubscriptionStatus()` server-side to determine `isPro`
2. Fetches `/api/bias/latest` using the request's origin header
3. Maps API response to `BiasData` and `SignalBreakdownScore[]` structures
4. Renders components conditionally based on `isPro`

**Layout:**
- `BiasGauge` — always visible — renders the -100/+100 score bar with regime label and interpretive summary
- `AssetHeatmap` — always visible — 5-tile grid showing SPY, QQQ, XLP, TLT, GLD prices and daily % change
- `SignalBreakdown` — always visible — three pillar cards (Volatility / Credit Stress / Trend Exhaustion) with signal disposition (Bullish / Neutral / Bearish), contribution points, and weight
- Intraday Playbook (historical analog table) — **Pro only**, wrapped in `PaywallWrapper`
- Full Cross-Asset details — **Pro only**, wrapped in `PaywallWrapper`

### 8.3 PaywallWrapper
Client component. Receives `initialIsPro` from server. Subscribes to real-time Supabase `users` table changes filtered by `id = userId` using `postgres_changes`. When a `subscription_status` of `active` or `trialing` is detected, calls `router.refresh()` to re-render the server components without a full page reload. Renders a locked overlay with an upgrade CTA when `!isPro`.

### 8.4 Components

**`BiasGauge`**
- Score range: -100 to +100 (clamped)
- Regime label thresholds: Risk-On > 30, Risk-Off < -30, Neutral otherwise
- Color coding: `text-emerald-400` (Risk-On), `text-rose-400` (Risk-Off), `text-white` (Neutral)
- Visual: horizontal progress bar with a position indicator + interpretive sentence

**`AssetHeatmap`**
- Displays close price (formatted as USD) and daily % change per ticker
- Color thresholds: gain > 0.75% → emerald, any gain → emerald, loss > 0.75% → rose, any loss → rose, flat → zinc-300

**`SignalBreakdown`**
- One card per pillar: VIX (Volatility Regime), HYG vs TLT (Credit Stress), SPY RSI/SMA (Trend Exhaustion)
- Disposition label: Bullish (signal > 0.15), Bearish (signal < -0.15), Neutral otherwise
- Shows: signal value, weight %, contribution points, methodology description, analog dates if available

**`ShareEdgeButton`**
- Copies the dashboard share URL to the clipboard

---

## 9. Authentication & Middleware

### Supabase Auth
- Email + password auth via `createSupabaseBrowserClient`
- Email confirmation handled by `GET /auth/callback` — exchanges the code for a session, calls `supabase.auth.getUser()` to confirm it, then redirects to `/dashboard`
- SSR sessions managed via cookie-based `createSupabaseServerClient` (from `@supabase/ssr`)

### Next.js Middleware (`src/middleware.ts`)
Runs on all non-static, non-API paths. Calls `updateSession()` to refresh the Supabase auth token on every request. If the path is `/dashboard` or starts with `/dashboard/` and no user session exists, redirects to `/?redirectTo=<path><search>`. The `redirectTo` value is sanitized on the landing page before use.

---

## 10. Billing & Subscription System

### Plans
- **Monthly:** `STRIPE_MONTHLY_PRICE_ID` or `STRIPE_PRICE_ID` (fallback)
- **Annual:** `STRIPE_ANNUAL_PRICE_ID`

### Subscription Status States
`inactive` → `active` / `trialing` → `past_due` → `canceled` / `unpaid` / `incomplete` / `incomplete_expired`

`isSubscriptionActive()` returns `true` for `active` and `trialing` only.

### isPro Resolution
The billing layer checks two sources in order:
1. `profiles.is_pro` (boolean, set by webhook)
2. `users.subscription_status` (Stripe-synced via webhook)

The `getUserSubscriptionStatus()` function returns `{ isPro, user, subscriptionStatus }` and is called on every dashboard server render.

---

## 11. Environment Variables

### Required (all environments)
| Variable                                       | Used by          | Purpose                                          |
| ---------------------------------------------- | ---------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`                     | Browser + Server | Supabase project URL                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                | Browser + Server | Public Supabase anon key                         |
| `SUPABASE_SERVICE_ROLE_KEY`                    | Server only      | Service-role key for admin client (bypasses RLS) |
| `STRIPE_SECRET_KEY`                            | Server only      | Stripe API secret                                |
| `STRIPE_WEBHOOK_SECRET`                        | Webhook handler  | Stripe webhook signing secret                    |
| `STRIPE_PRICE_ID` or `STRIPE_MONTHLY_PRICE_ID` | Checkout route   | Monthly plan price ID                            |
| `STRIPE_ANNUAL_PRICE_ID`                       | Checkout route   | Annual plan price ID                             |
| `CRON_SECRET` or `PUBLISH_CRON_SECRET`         | Cron endpoint    | Prevents unauthorized cron triggers              |

### Required for social distribution
| Variable          | Purpose                                |
| ----------------- | -------------------------------------- |
| `X_API_KEY`       | X (Twitter) OAuth 1.0a consumer key    |
| `X_API_SECRET`    | X (Twitter) OAuth 1.0a consumer secret |
| `X_ACCESS_TOKEN`  | X (Twitter) OAuth 1.0a access token    |
| `X_ACCESS_SECRET` | X (Twitter) OAuth 1.0a access secret   |

Legacy aliases also accepted: `X_API_KEY_SECRET` (= `X_API_SECRET`), `X_ACCESS_TOKEN_SECRET` (= `X_ACCESS_SECRET`).

### Optional
| Variable                      | Purpose                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`         | Public-facing base URL. Defaults to `http://localhost:3000`                                           |
| `DISCORD_PUBLISH_WEBHOOK_URL` | Discord channel webhook (publishing currently disabled in code: `DISCORD_PUBLISHING_ENABLED = false`) |

---

## 12. SEO, Crawl, and Social

- **`layout.tsx`:** Exports Next.js `Metadata` with title, description, keywords, canonical URL (`https://macro-bias.com`), static Open Graph image (`/opengraph-image.png`), static Twitter image (`/twitter-image.png`), and structured data (`SoftwareApplication` + `Product` Schema.org graph in JSON-LD)
- **`robots.ts`:** Allows all crawlers on `/`, disallows `/dashboard` and `/auth/callback`. Points to `/sitemap.xml`
- **`sitemap.ts`:** One entry for the root URL, `changeFrequency: 'daily'`, `priority: 1`
- **`/api/og`:** Dynamic per-score OG image. Score-colored gauge bar, regime label, trade date. Used by the publish cron payload and manual share assets, not the default site-wide metadata image.

---

## 13. npm Scripts

| Script            | Command                                        | Purpose                             |
| ----------------- | ---------------------------------------------- | ----------------------------------- |
| `dev`             | `next dev`                                     | Local development server            |
| `build`           | `next build`                                   | Production build                    |
| `start`           | `next start`                                   | Start production server             |
| `typecheck`       | `tsc --noEmit`                                 | TypeScript type check (no emit)     |
| `macro-bias:sync` | `tsx src/scripts/run-daily-macro-bias-sync.ts` | Manual one-shot data sync + scoring |

---

## 14. Known Edge Cases & Maintenance Notes

- **X API rate limits:** The X Developer API Free Tier allows ~500 tweets/month. If exceeded, the cron publishes the DB write successfully but logs a `402 CreditsDepleted` error. The tweet is silently skipped until the monthly billing cycle resets.
- **Stale frontend dates:** The dashboard uses `force-dynamic` plus `noStore()`, and the relevant API routes use `force-dynamic` plus `revalidate = 0`, to disable caching. The `Data as of:` timestamp on the dashboard reflects the latest Supabase row.
- **Stripe webhook redirect bug:** The production webhook URL must be `https://www.macro-bias.com/api/webhooks/stripe`. The apex domain `https://macro-bias.com/...` triggers a 307 redirect that breaks Stripe's raw-body signature verification before Next.js can handle it.
- **Holiday/gap fallback:** `upsertDailyMarketData` steps back day-by-day to find the most recent valid trading session if Yahoo Finance returns null data for the previous calendar day (weekends, public holidays).
- **Profiles table soft dependency:** The billing layer gracefully ignores Postgres error codes `42P01` (relation does not exist), `42703` (column does not exist), `PGRST204`, and `PGRST205` when querying `profiles`. The subscription system degrades gracefully to `users.subscription_status` alone if the `profiles` table has not been created.
- **Model version tracking:** Every `macro_bias_scores` row is tagged with `model_version = 'macro-model-v3-knn'`. Historical rows written by earlier model versions (v1, v2) remain intact and are still used as analog candidates by the KNN engine — the feature vectors are re-constructed from the persisted `engine_inputs` JSONB column.
- **Marketing cron coverage:** As of 2026-04-07, `src/content/marketing/` contains sample `weather` and `close` posts plus evergreen `marketing` posts. All three scheduled campaign types are active through the same flat-directory parser.