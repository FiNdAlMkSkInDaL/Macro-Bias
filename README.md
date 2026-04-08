# MACRO BIAS — SYSTEM ARCHITECTURE & DOCUMENTATION

## 1. High-Level Overview

Macro Bias is a quantitative macro-regime SaaS for active traders. Each trading day, the system pulls fresh cross-asset OHLCV data, computes a decayed KNN-based bias score from a 6-factor state vector, stores the result in Supabase, and exposes that read through a premium dashboard, a shareable OG image, and an automated X publishing pipeline.

The current model is a 4-pillar engine:

- Trend & Momentum
- Credit & Risk Spreads
- Volatility
- Positioning

The Positioning pillar is now driven by `gammaExposure`, a synthetic dealer-gamma proxy derived from the inverse 5-session rate of change in VIX. The public site also includes a markdown-powered intel archive at `/intel/[slug]`, backed by the same marketing content directory used by the social distribution cron.

**Production URL:** https://www.macro-bias.com  
**Model version (current):** `macro-model-v3-knn`

---

## 2. Tech Stack

| Layer               | Technology                                          | Version          |
| ------------------- | --------------------------------------------------- | ---------------- |
| Frontend Framework  | Next.js App Router                                  | ^15.2.3          |
| UI Library          | React                                               | ^19.0.0          |
| Styling             | Tailwind CSS                                        | ^3.4.19          |
| Database & Auth     | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) | ^0.6.1 / ^2.49.8 |
| Hosting & Cron      | Vercel                                              | —                |
| Payments            | Stripe                                              | ^18.1.1          |
| Social Distribution | X (Twitter) API v2                                  | ^1.29.0          |
| Markdown Parsing    | gray-matter                                         | ^4.0.3           |
| Markdown Rendering  | react-markdown + remark-gfm                         | ^10.1.0 / ^4.0.1 |
| OG Image Generation | `@vercel/og`                                        | ^0.11.1          |
| Charting            | Recharts                                            | ^3.8.1           |
| Script Runner       | tsx                                                 | ^4.19.3          |
| Language            | TypeScript                                          | ^5.8.2           |

**Typography:** Space Grotesk for headlines and IBM Plex Mono for data surfaces.  
**Visual direction:** dark terminal UI, hard borders, restrained gradients, dense numeric metadata.

---

## 3. Repository Structure

```
.tmp-macro-bias-2026-04-07-backup.json   # Committed backup artifact; not used by runtime code

src/
  app/
    page.tsx                             # Landing/auth page (client component)
    layout.tsx                           # Root metadata, JSON-LD, dynamic OG/Twitter image wiring
    globals.css                          # Global Tailwind base styles
    robots.ts                            # Crawl rules
    sitemap.ts                           # Dynamic sitemap: home + published intel pages
    dashboard/
      page.tsx                           # Premium dashboard (server component, dynamic + noStore)
    intel/
      [slug]/page.tsx                    # Public markdown-backed intel article route
    auth/
      callback/route.ts                  # Supabase email confirmation callback
    api/
      bias/latest/route.ts               # Latest score API + four-pillar breakdown + analog payload
      checkout/route.ts                  # Stripe Checkout session creator
      cron/
        marketing/route.ts               # Scheduled marketing post publisher
        publish/route.ts                 # Daily macro-bias sync + X publish endpoint (GET and POST)
      og/route.tsx                       # Dynamic 1200x630 OG image route
      stripe/portal/route.ts             # Stripe Billing Portal redirect
      webhooks/stripe/route.ts           # Stripe webhook handler

  components/
    paywall-wrapper.tsx                  # Client-side upgrade gate with realtime refresh
    dashboard/
      AssetHeatmap.tsx                   # Core ETF heatmap (SPY/QQQ/XLP/TLT/GLD)
      BiasGauge.tsx                      # Bias score gauge + regime summary
      ShareEdgeButton.tsx                # Clipboard share helper
      SignalBreakdown.tsx                # Four-pillar breakdown UI + shared score types

  content/
    marketing/
      *.md                               # Flat markdown content store used by marketing cron and intel pages

  lib/
    billing/
      subscription.ts                    # getUserSubscriptionStatus / isSubscriptionActive
    macro-bias/
      calculate-daily-bias.ts            # Decayed KNN engine
      constants.ts                       # Model constants and pillar weights
      mock-bias-data.ts                  # Dev fixtures
      technical-analysis.ts              # SMA / RSI helpers
      types.ts                           # Shared macro-bias types
    market-data/
      derive-historical-analogs.ts       # Publish/dashboard analog reconstruction + playbook metrics
      get-latest-bias-snapshot.ts        # Latest macro_bias_scores row fetch
      upsert-daily-market-data.ts        # Main market-data sync and score persistence pipeline
    marketing/
      markdown-parser.ts                 # Markdown loader/frontmatter parser
    supabase/
      admin.ts                           # Service-role client
      browser.ts                         # Browser client factory
      middleware.ts                      # Session refresh helper
      server.ts                          # SSR server client factory
    server-env.ts                        # Environment variable helpers / getAppUrl
    stripe.ts                            # Stripe singleton + price helpers

  middleware.ts                          # Next.js auth gate for dashboard routes
  scripts/
    run-daily-macro-bias-sync.ts         # Manual sync entrypoint
  types/
    index.ts                             # Shared frontend types
  utils/
    knn.ts                               # Euclidean + temporal-decay distance helpers
    quantMath.ts                         # Publish-time pillar normalization helpers
    regime-classifier.ts                 # Regime filter over HYG/TLT + VIX

supabase/
  migrations/
    20260405_init_macro_bias.sql
    202604050001_create_users_table.sql
    202604050002_upgrade_macro_model.sql
    202604050003_add_uso_to_macro_model.sql
    202604050003_enable_knn_macro_model.sql
    202604070001_create_published_marketing_posts.sql

vercel.json                              # Publish + marketing cron schedules
```

---

## 4. Macro Bias Model

### 4.1 Tracked Universe

| Category                           | Tickers                 | Role                                                                          |
| ---------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| Core ETFs                          | SPY, QQQ, XLP, TLT, GLD | Persisted daily prices + dashboard heatmap                                    |
| Supplemental model inputs          | `^VIX`, HYG, CPER, USO  | Feature construction for scoring engine                                       |
| Dashboard-only cross-asset context | IWM, UUP                | Fetched for the cross-asset regime panel, not part of the core scoring vector |

### 4.2 State Vector (6 Dimensions)

Each scored session is represented by a 6-factor vector:

| Feature Key     | Construction                                              | Pillar                 |
| --------------- | --------------------------------------------------------- | ---------------------- |
| `spyRsi`        | Wilder RSI(14) on SPY                                     | `trendAndMomentum`     |
| `gammaExposure` | Negative 5-session % change in VIX, rounded to 2 decimals | `positioning`          |
| `hygTltRatio`   | HYG close ÷ TLT close                                     | `creditAndRiskSpreads` |
| `cperGldRatio`  | CPER close ÷ GLD close                                    | `creditAndRiskSpreads` |
| `usoMomentum`   | 5-session % change in USO                                 | `creditAndRiskSpreads` |
| `vixLevel`      | VIX close level                                           | `volatility`           |

Notes:

- `gammaExposure` is currently a synthetic market-plumbing proxy, not a direct options-flow feed.
- Ratio features are level-based rather than daily-return-based.
- Both `usoMomentum` and `gammaExposure` use the 5-session lookback controlled by `ANALOG_MODEL_SETTINGS.usoMomentumLookbackSessions = 5`.

### 4.3 Daily KNN Scoring Flow

1. Build today's 6-factor vector from the latest sync output.
2. Load historical analog vectors from persisted market history.
3. Require at least `20` historical analogs before scoring (`ANALOG_MODEL_SETTINGS.minimumHistoricalAnalogs`).
4. Standardize each feature with population mean and standard deviation across the historical sample.
5. Compute decayed distance with:
   - Euclidean distance in z-score space
   - Temporal penalty `exp(lambda * calendarDayDifference)`
   - `lambda = 0.001` (`DEFAULT_TEMPORAL_DECAY_LAMBDA`)
6. Select `k = 5` nearest analogs.
7. Compute:
   - `averageForward1DayReturn`
   - `averageForward3DayReturn`
   - `bearishHitRate1Day`
   - `bearishHitRate3Day`
8. Blend forward returns as `0.4 * 1-day + 0.6 * 3-day`.
9. Map expectancy to score with:

```ts
normalizedExpectancy = blendedForwardReturn / 2.75;
score = round(tanh(normalizedExpectancy) * 100);
```

This means the score saturates smoothly toward `-100` / `+100`; it is not a linear mapping.

### 4.4 Pillars and Weights

| Pillar                | Key                    | Weight |
| --------------------- | ---------------------- | ------ |
| Trend & Momentum      | `trendAndMomentum`     | 25%    |
| Credit & Risk Spreads | `creditAndRiskSpreads` | 25%    |
| Volatility            | `volatility`           | 25%    |
| Positioning           | `positioning`          | 25%    |

`component_scores` persists one diagnostic result per pillar. The final bias score is still analog-expectancy driven rather than a straight weighted linear sum.

### 4.5 Bias Labels

| Score Range    | Label              |
| -------------- | ------------------ |
| `<= -60`       | `EXTREME_RISK_OFF` |
| `-59` to `-21` | `RISK_OFF`         |
| `-20` to `20`  | `NEUTRAL`          |
| `21` to `59`   | `RISK_ON`          |
| `>= 60`        | `EXTREME_RISK_ON`  |

---

## 5. Data and Publishing Pipeline

### 5.1 Daily Publish Cron

**Cron schedule:** `45 12 * * *` (UTC)  
**Vercel path:** `/api/cron/publish`  
**Route methods supported:** `GET`, `POST`  
**Runtime:** Node.js  
**Auth:** `CRON_SECRET` or `PUBLISH_CRON_SECRET`, checked with `timingSafeEqual`

Because Vercel cron expressions are UTC-based, New York local time shifts with DST. The current production schedule fires at `12:45 UTC`.

**Execution sequence:**

```
Vercel Cron -> /api/cron/publish
  |
  |- 1. Validate cron secret
  |
  |- 2. Read the latest stored macro_bias_scores trade date
  |
  |- 3. Run upsertDailyMarketData()
  |     |- Fetch Yahoo Chart API history for SPY, QQQ, XLP, TLT, GLD, ^VIX, HYG, CPER, USO
  |     |- Backfill missing holiday/weekend sessions by walking backward to the last valid session
  |     |- Upsert daily rows into etf_daily_prices
  |     |- Compute SPY technical indicators (RSI14, SMA20 distance)
  |     |- Compute USO 5-session momentum
  |     |- Compute synthetic gamma exposure from inverse 5-session VIX change
  |     |- Build historical analog vectors
  |     |- Score the session with calculateDailyBias()
  |     |- Persist macro_bias_scores for the current trade date
  |
  |- 4. If the trade date did not advance, return { status: "skipped" }
  |
  |- 5. Load recent snapshots and a 10-year analog window from macro_bias_scores
  |
  |- 6. Rebuild publish-time analogs with deriveHistoricalAnalogs()
  |     |- applyRegimeFilter: true
  |     |- disablePersistedMatchFallback: true
  |     |- rollingWindowStartDate: latestTradeDate minus 10 years
  |
  |- 7. Build publish payload
  |     |- headline, regimeSentence, share URL, OG URL, X text
  |     |- top analogs with SPY gap / intraday net / range playbook stats
  |
  |- 8. Publish to configured destinations
  |     |- X is active when X credentials are present
  |     |- Discord code exists but DISCORD_PUBLISHING_ENABLED is currently false
  |
  `- 9. Return JSON summary: publishedTo, failures, analogs, playbook, preview, tradeDate
```

### 5.2 Marketing Distribution Cron

Configured routes in `vercel.json`:

- `/api/cron/marketing?type=weather` → `30 17 * * 1-5`
- `/api/cron/marketing?type=close` → `15 20 * * 1-5`
- `/api/cron/marketing?type=marketing` → `0 15 * * *`

Each run:

1. Validates the same cron secret flow used by `/api/cron/publish`.
2. Reads `src/content/marketing/*.md` through `src/lib/marketing/markdown-parser.ts`.
3. Parses frontmatter with `gray-matter`.
4. Filters by `campaignType`.
5. Deduplicates against `published_marketing_posts`.
6. Publishes the next available post to X.
7. Inserts `{ slug, published_at }` into `published_marketing_posts`.

**Current checked-in content inventory:**

- `conviction-needs-history`
- `discretion-breaks-under-pressure`
- `gut-feeling-costs`
- `history-beats-emotion`
- `intuition-is-not-edge`

All current markdown files are `campaignType: "marketing"`. The `weather` and `close` routes are configured and code-complete, but they currently have no matching source files, so they are expected to no-op until content is added.

### 5.3 Public Intel Archive

The same markdown content system now powers a public article route:

- Route: `/intel/[slug]`
- Source: `getAllMarketingPosts("marketing")` / `getMarketingPostBySlug(slug, "marketing")`
- Rendering: `react-markdown` with `remark-gfm`
- Metadata: article-specific canonical URL, Open Graph, Twitter card, and JSON-LD `Article`

Important distinction:

- The article route can resolve any checked-in `marketing` markdown slug.
- The sitemap only includes posts already recorded in `published_marketing_posts`.

### 5.4 Manual Sync Script

```bash
npm run macro-bias:sync
```

Runs `src/scripts/run-daily-macro-bias-sync.ts`, loads `.env.local`, executes `upsertDailyMarketData()`, and prints a compact `{ tradeDate, score, label }` summary.

### 5.5 Data Source

Market data comes from the Yahoo Finance Chart API (`query2.finance.yahoo.com/v8/finance/chart/`). Adjusted close is read from the `adjclose` block when available. The sync pipeline converts raw chart responses into `DailyPriceInsert` rows before indicators and analog vectors are built.

---

## 6. Database Schema

All tracked tables live in the `public` schema.

- `etf_daily_prices`, `macro_bias_scores`, and `users` have RLS enabled.
- `published_marketing_posts` is a server-managed ledger with RLS disabled.
- Server-side code uses the service-role key for privileged writes and sitemap/publication tasks.

### `etf_daily_prices`

| Column                               | Type            | Notes                                                               |
| ------------------------------------ | --------------- | ------------------------------------------------------------------- |
| `id`                                 | `uuid`          | PK, `gen_random_uuid()`                                             |
| `ticker`                             | `text`          | Allowed values include SPY, QQQ, XLP, TLT, GLD, VIX, HYG, CPER, USO |
| `trade_date`                         | `date`          | Unique with `ticker`                                                |
| `open/high/low/close/adjusted_close` | `numeric(12,4)` | Daily OHLC + adjusted close                                         |
| `volume`                             | `bigint`        | Raw daily volume                                                    |
| `source`                             | `text`          | Defaults to `yahoo-chart-api`                                       |
| `technical_indicators`               | `jsonb`         | Indicator payload, primarily SPY RSI/SMA fields                     |
| `created_at`                         | `timestamptz`   | Insert timestamp                                                    |

Indexes: `(ticker, trade_date DESC)`, `(trade_date DESC)`

### `macro_bias_scores`

| Column                      | Type          | Notes                                                               |
| --------------------------- | ------------- | ------------------------------------------------------------------- |
| `id`                        | `uuid`        | PK                                                                  |
| `trade_date`                | `date`        | Unique trade date                                                   |
| `score`                     | `integer`     | Bias score in `[-100, 100]`                                         |
| `bias_label`                | `text`        | One of the five label values                                        |
| `component_scores`          | `jsonb`       | Array of four `BiasComponentResult` objects                         |
| `ticker_changes`            | `jsonb`       | Core ETF close / prevClose / percentChange map                      |
| `model_version`             | `text`        | Defaults to `macro-model-v3-knn`                                    |
| `engine_inputs`             | `jsonb`       | Full model input snapshot, including `marketPlumbing.gammaExposure` |
| `technical_indicators`      | `jsonb`       | Score-time technical payload, currently SPY-focused                 |
| `created_at` / `updated_at` | `timestamptz` | Audit timestamps                                                    |

Index: `(trade_date DESC)`, `(model_version)`

### `users`

| Column                      | Type          | Notes                   |
| --------------------------- | ------------- | ----------------------- |
| `id`                        | `uuid`        | FK to `auth.users(id)`  |
| `email`                     | `text`        | Unique                  |
| `subscription_status`       | `text`        | Stripe lifecycle status |
| `stripe_customer_id`        | `text`        | Unique                  |
| `stripe_subscription_id`    | `text`        | Unique                  |
| `created_at` / `updated_at` | `timestamptz` | Audit timestamps        |

`handle_new_user()` auto-inserts or updates the billing row on new Supabase auth users. Users can only `SELECT` their own row under RLS.

### `published_marketing_posts`

| Column         | Type          | Notes                  |
| -------------- | ------------- | ---------------------- |
| `slug`         | `text`        | PK / deduplication key |
| `published_at` | `timestamptz` | Defaults to `now()`    |

This table drives both marketing deduplication and the `/sitemap.xml` intel page list.

### `profiles` (Optional)

Not created by a tracked migration, but referenced by the billing layer when present. Used columns: `id`, `is_pro`, `stripe_customer_id`.

---

## 7. HTTP Routes

### `GET /api/bias/latest`

**Caching:** `dynamic = "force-dynamic"`, `revalidate = 0`

Returns the latest persisted bias snapshot with:

- `componentScores`: aggregated four-pillar breakdown
- `detailedComponentScores`: raw persisted `BiasComponentResult[]`
- `tickerChanges`: core ETF ticker map only
- `historicalAnalogs`: playbook payload from `deriveHistoricalAnalogs()`

Response shape:

```ts
{
  data: {
    tradeDate: string;
    score: number;
    label: BiasLabel;
    tickerChanges: Record<string, FrontendTickerChange>;
    componentScores: PillarBreakdown[];
    detailedComponentScores: BiasComponentResult[];
    historicalAnalogs: HistoricalAnalogsPayload | null;
    createdAt: string;
    updatedAt: string;
  };
}
```

### `POST /api/checkout?plan=monthly|annual`

Creates a Stripe Checkout Session for the authenticated user. Upserts a `users` row, rejects already-active subscriptions, then returns `{ url }`.

### `GET /api/stripe/portal`

Creates a Stripe Billing Portal session for the signed-in user and returns `{ url }`.

### `POST /api/webhooks/stripe`

Verifies the Stripe signature and handles:

- `checkout.session.completed`
- `invoice.paid`
- `customer.subscription.updated`
- `customer.subscription.deleted`

User resolution waterfall:

1. Stripe metadata (`supabaseUUID`, `supabaseUserId`, aliases)
2. `stripe_subscription_id`
3. `stripe_customer_id`
4. Email fallback

Production webhook endpoint: `https://www.macro-bias.com/api/webhooks/stripe`

### `GET` / `POST /api/cron/publish`

Runs the daily sync-and-publish flow described in Section 5.1. Returns:

- success payload with `publishedTo`, `failures`, `analogs`, `playbook`, `preview`, `tradeDate`
- or `{ status: "skipped", reason: "Data vendor not yet updated for today's session" }`

### `GET /api/cron/marketing?type=weather|close|marketing`

Publishes the next unpublished markdown post for the requested campaign type to X, or returns a no-op response if no unpublished post exists.

### `GET /api/og`

Generates a 1200x630 OG image from the latest bias snapshot. The image includes:

- score gauge
- label and trade date
- execution-state tagline
- four-item signal stack with 25% weights

Fonts are fetched dynamically from Google Fonts' GitHub sources and cached in-memory.

---

## 8. Frontend Architecture

### 8.1 Landing Page (`/`)

Client component with combined sign-in and sign-up flows. It uses `createSupabaseBrowserClient`, listens for auth state changes, sanitizes `redirectTo`, and routes signed-in users to `/dashboard` or the validated redirect target.

The public marketing copy still foregrounds three surface-level themes:

- Volatility
- Credit Spreads
- Trend

That marketing framing is simpler than the live dashboard model, which now exposes four internal diagnostic pillars.

### 8.2 Dashboard Page (`/dashboard`)

Server component with:

- `dynamic = "force-dynamic"`
- `noStore()`
- server-side subscription resolution

High-level data flow:

1. Resolve `isPro` with `getUserSubscriptionStatus()`.
2. Fetch `/api/bias/latest` from the current origin.
3. Build `BiasData`, pillar maps, analog tables, and cross-asset context.
4. Render free vs Pro sections.

Current dashboard surfaces:

- `BiasGauge` for the composite score
- `AssetHeatmap` for SPY, QQQ, XLP, TLT, GLD
- Four-pillar Context Engine:
  - Volatility Regime (`^VIX`)
  - Credit Stress (`HYG vs TLT`)
  - Trend Exhaustion (`SPY RSI`)
  - Market Plumbing (`GEX Proxy`)
- Cross-Asset Regime panel using SPY, QQQ, XLP, TLT, GLD, IWM, HYG, VIX, UUP, USO
- Historical Analogs intraday playbook (Pro)
- Locked Pro preview state for non-subscribers

The diagnostics footer currently advertises:

- Temporal decay `lambda = 0.001`
- Regime filter active
- Exact decayed KNN top-5 selection
- 10-year rolling dataset cap

### 8.3 Intel Article Pages (`/intel/[slug]`)

`src/app/intel/[slug]/page.tsx` is a public server-rendered article route with:

- `dynamicParams = false`
- static params generated from `marketing` markdown slugs at build time
- article metadata and JSON-LD
- markdown rendering through `react-markdown` + `remark-gfm`
- CTA back into the Macro Bias product

Each article uses the markdown file's frontmatter for `slug`, `title`, and `campaignType`, and uses the file modification time as `publishedAt`.

Because `dynamicParams` is disabled, adding a new intel markdown file requires a rebuild before the new slug becomes routable.

### 8.4 Paywall Wrapper

`PaywallWrapper` is a client component that listens to realtime `users` updates via `postgres_changes`. If `subscription_status` flips to `active` or `trialing`, it triggers `router.refresh()` so the locked dashboard sections unlock without a full reload.

### 8.5 Shared Dashboard Components

**`BiasGauge`**

- clamps score to `[-100, 100]`
- classifies Risk-On / Neutral / Risk-Off for UI copy
- renders the primary summary sentence

**`AssetHeatmap`**

- displays core ETF close + daily percent move
- uses green/rose/zinc color thresholds based on move direction and magnitude

**`SignalBreakdown.tsx`**

- defines the shared `SignalBreakdownScore` type used by the dashboard
- mirrors the four live pillars
- supports legacy key lookup aliases for `dealerPositioning`, `positioning`, and `gammaExposure`

**`ShareEdgeButton`**

- copies the dashboard share URL to the clipboard

---

## 9. Authentication and Middleware

### Supabase Auth

- Email/password auth in the browser via `createSupabaseBrowserClient`
- Email confirmation handled by `/auth/callback`
- SSR session handling via `createSupabaseServerClient`

### Next.js Middleware

`src/middleware.ts` refreshes the auth session on non-static, non-API routes. If a user without a valid session requests `/dashboard` or a nested dashboard route, the middleware redirects to `/?redirectTo=<path>`.

---

## 10. Billing and Subscription System

### Plans

- Monthly: `STRIPE_MONTHLY_PRICE_ID` or fallback `STRIPE_PRICE_ID`
- Annual: `STRIPE_ANNUAL_PRICE_ID`

### Active Statuses

`isSubscriptionActive()` returns `true` for:

- `active`
- `trialing`

### Pro Resolution Order

1. `profiles.is_pro`
2. `users.subscription_status`

`getUserSubscriptionStatus()` returns `{ isPro, user, subscriptionStatus }` and is called on each dashboard render.

---

## 11. Environment Variables

### Required

| Variable                                       | Used by          | Purpose                             |
| ---------------------------------------------- | ---------------- | ----------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                     | Browser + server | Supabase project URL                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                | Browser + server | Public Supabase anon key            |
| `SUPABASE_SERVICE_ROLE_KEY`                    | Server only      | Privileged DB access                |
| `STRIPE_SECRET_KEY`                            | Server only      | Stripe API secret                   |
| `STRIPE_WEBHOOK_SECRET`                        | Webhooks         | Stripe signature validation         |
| `STRIPE_PRICE_ID` or `STRIPE_MONTHLY_PRICE_ID` | Checkout         | Monthly price ID                    |
| `STRIPE_ANNUAL_PRICE_ID`                       | Checkout         | Annual price ID                     |
| `CRON_SECRET` or `PUBLISH_CRON_SECRET`         | Cron routes      | Prevent unauthorized cron execution |

### Required for X Publishing

| Variable          | Purpose                  |
| ----------------- | ------------------------ |
| `X_API_KEY`       | Consumer key             |
| `X_API_SECRET`    | Consumer secret          |
| `X_ACCESS_TOKEN`  | User access token        |
| `X_ACCESS_SECRET` | User access token secret |

Legacy aliases are still accepted:

- `X_API_KEY_SECRET` → `X_API_SECRET`
- `X_ACCESS_TOKEN_SECRET` → `X_ACCESS_SECRET`

### Optional

| Variable                      | Purpose                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL`         | Override public app URL; defaults to `http://localhost:3000` locally                 |
| `DISCORD_PUBLISH_WEBHOOK_URL` | Discord webhook URL; currently unused because Discord publishing is disabled in code |

---

## 12. SEO, Crawl, Sitemap, and Social

- **`layout.tsx`** now uses dynamic `/api/og?ts=<cacheBuster>` URLs for both Open Graph and Twitter metadata instead of static image files.
- **Structured data** includes `SoftwareApplication` and `Product` JSON-LD.
- **`robots.ts`** allows crawlers on the public site and excludes auth/dashboard surfaces.
- **`sitemap.ts`** returns:
  - the homepage
  - one entry per row in `published_marketing_posts`, mapped to `/intel/[slug]`
- **`/intel/[slug]`** emits page-level article metadata and `Article` JSON-LD.
- **`/api/og`** is the live site-wide share image source as well as the publish-cron image source.

---

## 13. npm Scripts

| Script            | Command                                        | Purpose                      |
| ----------------- | ---------------------------------------------- | ---------------------------- |
| `dev`             | `next dev`                                     | Local development server     |
| `build`           | `next build`                                   | Production build             |
| `start`           | `next start`                                   | Production server            |
| `typecheck`       | `tsc --noEmit`                                 | TypeScript validation        |
| `macro-bias:sync` | `tsx src/scripts/run-daily-macro-bias-sync.ts` | Manual one-shot sync + score |

---

## 14. Maintenance Notes and Edge Cases

- **README audit baseline:** the previous README update landed in commit `477c067353ae79051a76db57dd1f254dc63f73b0` on `2026-04-07 01:47:33 +0100`. This document has been reconciled against all commits through current `HEAD`.
- **Publish cron timing:** `vercel.json` now schedules `/api/cron/publish` at `45 12 * * *` UTC. Older README references to `30 12 * * *` are obsolete.
- **Publish skip behavior:** `/api/cron/publish` now skips cleanly if the vendor has not advanced to a new trade date yet.
- **Gamma proxy:** the live engine no longer uses `qqqXlpRatio`. It now uses `gammaExposure`, derived from inverse 5-session VIX change.
- **Four-pillar model:** the current dashboard and API expose Trend, Credit, Volatility, and Positioning. Older three-pillar documentation is obsolete.
- **Regime filter implementation:** publish-time analog filtering is implemented by `src/utils/regime-classifier.ts`, which classifies `EXPANSION`, `NEUTRAL`, and `CONTRACTION` from `hygTltRatio` and `vixLevel`. The dashboard UI calls this a regime filter, but the code is not a full hidden Markov model implementation.
- **10-year rolling window:** publish-time analog reconstruction is hard-capped to a 10-year window to reduce stale-distribution distortion.
- **Intel sitemap behavior:** a markdown article can exist on disk without appearing in `/sitemap.xml`; only slugs present in `published_marketing_posts` are emitted.
- **Current content coverage:** all checked-in marketing posts are `campaignType: "marketing"`. `weather` and `close` cron routes are ready but currently have no source files.
- **Discord publishing:** `DISCORD_PUBLISHING_ENABLED` is `false`, so X is currently the only active publish target.
- **Stripe webhook redirect bug:** production webhooks must use `https://www.macro-bias.com/api/webhooks/stripe`; the apex domain still issues a `307` redirect before signature verification.
- **Profiles soft dependency:** the billing layer tolerates missing `profiles` tables/columns and falls back to `users.subscription_status`.
- **Committed backup artifact:** `.tmp-macro-bias-2026-04-07-backup.json` exists in the repo root but is not referenced by runtime code.