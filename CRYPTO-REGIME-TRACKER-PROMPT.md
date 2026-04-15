# Crypto Regime Tracker: Full Implementation Brief

You are building a **BTC crypto regime tracker** that mirrors an existing, production equity regime tracker called Macro Bias. The equity version is live at macro-bias.com and has been running since January 2020. Your job is to create a parallel crypto system inside the same codebase that shares infrastructure (database, email, social, billing) but has its own model, features, briefing prompt, pages, and backtest.

Read this entire document before writing any code. Then create a detailed plan. Then execute.

---

## 1. THE EXISTING SYSTEM (what you are cloning)

### Architecture
- **Framework**: Next.js 15 (App Router), deployed on Vercel Hobby plan
- **Database**: Supabase (Postgres). Tables: `etf_daily_prices`, `macro_bias_scores`, `daily_market_briefings`, `scheduled_posts`, `free_subscribers`, `users`, `published_marketing_posts`
- **Market data**: Yahoo Finance `/v8/finance/chart/{ticker}` API, fetched daily via cron
- **AI briefing**: Anthropic Claude Haiku 4.5, max 1200 tokens, generates a daily email briefing from quant data + Finnhub news
- **Email**: Resend API, from `Macro Bias <briefing@macro-bias.com>`
- **Social**: Twitter API v2 (twitter-api-v2 package), Bluesky (@atproto/api)
- **Billing**: Stripe ($25/mo or $190/yr), 7-day free trial
- **Crons** (vercel.json): publish at 12:45 UTC, welcome-drip at 10:00 UTC, social-dispatch at 17:00 UTC

### The Equity Model (K-NN regime scoring)

**Core concept**: Each trading day is represented as a 6-dimensional feature vector. We find the 5 nearest historical neighbors (by Euclidean distance in z-scored feature space, with temporal decay), average their known forward SPY returns, and map that expectancy to a -100 to +100 score via `tanh`.

**The 6 equity features** (defined in `src/lib/macro-bias/types.ts` as `AnalogFeatureKey`):

| Feature | Computation | What it measures |
|---------|------------|------------------|
| `spyRsi` | Wilder RSI-14 on SPY closes | Trend/momentum |
| `gammaExposure` | `-1 * pctChange(VIX[t-5], VIX[t])` | Options positioning proxy |
| `hygTltRatio` | `HYG.close / TLT.close` | Credit risk appetite |
| `cperGldRatio` | `CPER.close / GLD.close` | Industrial vs safe-haven metals |
| `usoMomentum` | `pctChange(USO[t-5], USO[t])` | Energy sector risk appetite |
| `vixLevel` | Raw VIX close | Equity implied volatility |

**Tickers fetched from Yahoo Finance**:
- Tracked (shown in UI): `SPY`, `QQQ`, `XLP`, `TLT`, `GLD`
- Supplemental (features only): `HYG`, `CPER`, `USO`, `^VIX`

**Scoring pipeline** (`src/lib/macro-bias/calculate-daily-bias.ts`):
1. Build today's 6-feature vector from live prices
2. Z-score today + all historical analogs using population stats of the analog pool
3. Compute decayed Euclidean distance: `distance = euclidean(zToday, zAnalog) * exp(lambda * calendarDaysBetween)`
4. Sort ascending, take top K=5
5. Average their forward 1D and 3D SPY returns
6. Blend: `blended = 0.4 * avg1d + 0.6 * avg3d`
7. Map: `score = clamp(round(tanh(blended / 2.75) * 100), -100, 100)`

**Bias labels**:
- `EXTREME_RISK_OFF`: score <= -60
- `RISK_OFF`: -60 < score < -20
- `NEUTRAL`: -20 <= score <= 20
- `RISK_ON`: 20 < score < 60
- `EXTREME_RISK_ON`: score >= 60

**Model constants** (`src/lib/macro-bias/constants.ts`):
```
K = 5
blendedReturnScale = 2.75
temporalDecayLambda = 0.001
minimumHistoricalAnalogs = 20
usoMomentumLookbackSessions = 5
```

**K-NN distance** (`src/utils/knn.ts`):
```
decayedDistance = euclidean(zCurrent, zHistorical) * exp(lambda * |calendarDayDiff|)
```
Calendar days, not trading days. Lambda = 0.001. At 1000 days old, penalty is e^1 = 2.718x. At 2000 days, 7.39x.

**Regime classifier** (`src/utils/regime-classifier.ts`): Separate from the bias score. Uses only VIX level + HYG/TLT ratio with static thresholds (VIX <= 18 + HYG/TLT >= 0.88 = EXPANSION, VIX >= 24 + HYG/TLT <= 0.82 = CONTRACTION). Can dynamically calibrate from 30+ historical snapshots using p35/p65 quantiles.

**Backtest engine** (`src/lib/track-record/backtest-engine.ts`):
- Walk-forward from 2020-01-02. Each day only uses prior data (no lookahead).
- Strategy: LONG when yesterday's score > 20, SHORT when < -20, CASH when neutral
- 5 bps friction on every position change
- No leverage, no options
- Current result: +286% strategy vs +111% SPY buy-and-hold

**Database schema**:
```sql
-- Prices table (already holds equity tickers)
CREATE TABLE etf_daily_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,  -- constrained via CHECK
  trade_date date NOT NULL,
  open numeric(12,4), high numeric(12,4), low numeric(12,4),
  close numeric(12,4), adjusted_close numeric(12,4),
  volume bigint DEFAULT 0,
  source text DEFAULT 'yahoo-chart-api',
  UNIQUE (ticker, trade_date)
);

-- Scores table
CREATE TABLE macro_bias_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date date NOT NULL UNIQUE,
  score integer NOT NULL CHECK (score BETWEEN -100 AND 100),
  bias_label text NOT NULL,
  component_scores jsonb DEFAULT '[]',
  ticker_changes jsonb DEFAULT '{}',
  engine_inputs jsonb,
  technical_indicators jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### File structure you need to know

```
src/
  lib/
    macro-bias/               <-- equity model (DO NOT MODIFY)
      calculate-daily-bias.ts
      constants.ts
      mock-bias-data.ts
      technical-analysis.ts   <-- RSI, SMA implementations
      types.ts
    market-data/
      upsert-daily-market-data.ts  <-- equity data pipeline
    track-record/
      backtest-engine.ts      <-- equity backtest
    briefing/
      daily-briefing-config.ts     <-- equity briefing AI prompt
      daily-brief-generator.ts     <-- equity briefing pipeline
  utils/
    knn.ts                    <-- SHARED, reuse as-is
    quantMath.ts              <-- SHARED, reuse as-is
    regime-classifier.ts      <-- equity-specific, you will create a crypto version
  app/
    regime/
      page.tsx                <-- equity regime page
    dashboard/
      page.tsx                <-- equity dashboard
    track-record/
      page.tsx                <-- equity track record
    api/
      cron/
        publish/route.ts      <-- equity daily publish cron
```

---

## 2. THE CRYPTO MODEL (what you are building)

### Crypto Feature Vector (6 dimensions)

All tickers must be available on Yahoo Finance for data consistency.

| Feature | Ticker(s) | Computation | What it measures |
|---------|-----------|------------|------------------|
| `btcRsi` | `BTC-USD` | Wilder RSI-14 on BTC daily closes | BTC trend/momentum |
| `ethBtcRatio` | `ETH-USD`, `BTC-USD` | `ETH.close / BTC.close` | Alt rotation / risk appetite within crypto |
| `btcGldRatio` | `BTC-USD`, `GLD` | `BTC.close / GLD.close` | Crypto vs safe-haven divergence |
| `dxyMomentum` | `DX-Y.NYB` | `pctChange(DXY[t-5], DXY[t])` | Dollar strength (inversely correlated with BTC) |
| `btcRealizedVol` | `BTC-USD` | 20-day population stddev of daily log returns, annualized | Crypto-native volatility (replaces VIX) |
| `tltMomentum` | `TLT` | `pctChange(TLT[t-5], TLT[t])` | Rate expectations (increasingly correlated with BTC macro) |

**Tracked tickers** (shown in crypto dashboard UI): `BTC-USD`, `ETH-USD`, `SOL-USD`  
**Supplemental tickers** (features only): `GLD`, `DX-Y.NYB`, `TLT`

Note: `GLD` and `TLT` are already fetched by the equity pipeline. Your crypto data pipeline should check if today's data already exists before re-fetching to avoid duplicate Yahoo Finance requests.

### Crypto Model Constants

```typescript
const CRYPTO_ANALOG_MODEL_SETTINGS = {
  blendedReturnScale: 3.5,        // crypto has larger daily moves, widen the tanh mapping
  minimumHistoricalAnalogs: 20,
  nearestNeighborCount: 5,
  temporalDecayLambda: 0.0015,    // slightly faster decay for shorter history
  dxyMomentumLookbackSessions: 5,
  tltMomentumLookbackSessions: 5,
  btcRealizedVolWindow: 20,
} as const;
```

**Important calibration notes**:
- `blendedReturnScale` should be 3.5 (not 2.75) because BTC daily moves are roughly 2-3x larger than SPY. A +3.5% blended return should map to roughly +76 on the score scale, same as +2.75% does for equities.
- `temporalDecayLambda` should be 0.0015 because the crypto analog pool starts ~2017, giving roughly 8-9 years vs 10+ for equities. Slightly faster decay compensates for the shorter history by weighting recent analogs more.
- The backtest should start at `2020-01-02` to match the equity backtest start date, even though BTC data goes back further. This makes the track record comparison apples-to-apples.
- Forward returns are BTC-USD returns, not SPY returns. The prediction target changes.

### Crypto Regime Classifier

The equity regime classifier uses VIX + HYG/TLT. For crypto, use `btcRealizedVol` + `ethBtcRatio`:

```
EXPANSION: btcRealizedVol <= 55 AND/OR ethBtcRatio >= 0.055
CONTRACTION: btcRealizedVol >= 80 AND/OR ethBtcRatio <= 0.035
NEUTRAL: everything else
```

These are starting thresholds. The dynamic calibration system (p35/p65 quantiles from 30+ samples) should work the same way.

### Crypto Bias Labels

Use the same thresholds as equity:
- `EXTREME_RISK_OFF`: score <= -60
- `RISK_OFF`: -60 < score < -20
- `NEUTRAL`: -20 <= score <= 20
- `RISK_ON`: 20 < score < 60
- `EXTREME_RISK_ON`: score >= 60

### Backtest Strategy Rules

Same logic as equity but applied to BTC-USD:
- LONG BTC when yesterday's score > 20
- SHORT BTC when yesterday's score < -20
- CASH when neutral
- 10 bps friction per trade (crypto spreads are wider than SPY)
- Walk-forward from 2020-01-02
- No leverage

---

## 3. DATABASE CHANGES

### Migration: Add crypto tickers to price table

```sql
ALTER TABLE public.etf_daily_prices
  DROP CONSTRAINT IF EXISTS etf_daily_prices_ticker_check;

ALTER TABLE public.etf_daily_prices
  ADD CONSTRAINT etf_daily_prices_ticker_check
  CHECK (ticker IN (
    'SPY', 'QQQ', 'XLP', 'TLT', 'GLD', 'VIX', 'HYG', 'CPER', 'USO',
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'DXY'
  ));
```

Note: `DX-Y.NYB` is stored as `DXY` in the database (same pattern as `^VIX` being stored as `VIX`).

### New table: Crypto scores

```sql
CREATE TABLE IF NOT EXISTS public.crypto_bias_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date date NOT NULL UNIQUE,
  score integer NOT NULL CHECK (score BETWEEN -100 AND 100),
  bias_label text NOT NULL CHECK (
    bias_label IN ('EXTREME_RISK_OFF', 'RISK_OFF', 'NEUTRAL', 'RISK_ON', 'EXTREME_RISK_ON')
  ),
  component_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  ticker_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  engine_inputs jsonb,
  technical_indicators jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS crypto_bias_scores_trade_date_idx
  ON public.crypto_bias_scores (trade_date DESC);

CREATE TRIGGER set_crypto_bias_scores_updated_at
  BEFORE UPDATE ON public.crypto_bias_scores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### New table: Crypto briefings

```sql
CREATE TABLE IF NOT EXISTS public.crypto_daily_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date date NOT NULL UNIQUE,
  brief_content text NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN -100 AND 100),
  bias_label text NOT NULL,
  is_override_active boolean NOT NULL DEFAULT false,
  model_version text NOT NULL DEFAULT 'crypto-model-v1',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS crypto_daily_briefings_trade_date_idx
  ON public.crypto_daily_briefings (trade_date DESC);
```

---

## 4. FILE STRUCTURE TO CREATE

```
src/
  lib/
    crypto-bias/                          <-- NEW: mirrors macro-bias/
      calculate-crypto-bias.ts            <-- crypto scoring pipeline
      constants.ts                        <-- crypto model constants
      types.ts                            <-- crypto type definitions
    crypto-market-data/
      upsert-crypto-market-data.ts        <-- crypto data pipeline (Yahoo Finance)
    crypto-track-record/
      crypto-backtest-engine.ts           <-- crypto backtest
    crypto-briefing/
      crypto-briefing-config.ts           <-- crypto briefing AI prompt
      crypto-brief-generator.ts           <-- crypto briefing pipeline
  utils/
    crypto-regime-classifier.ts           <-- crypto regime classifier
  app/
    crypto/
      page.tsx                            <-- crypto regime overview page
      dashboard/
        page.tsx                          <-- crypto dashboard
      track-record/
        page.tsx                          <-- crypto track record / backtest
      briefings/
        page.tsx                          <-- crypto briefing archive
        [date]/
          page.tsx                        <-- individual crypto briefing
    api/
      cron/
        crypto-publish/
          route.ts                        <-- crypto daily publish cron
  scripts/
    run-daily-crypto-bias-sync.ts         <-- manual crypto data sync script
scripts/
  test-crypto-regimes.ts                  <-- crypto regime test script
supabase/
  migrations/
    YYYYMMDD_create_crypto_model.sql      <-- all crypto DB migrations
```

---

## 5. WHAT TO REUSE VS WHAT TO CREATE NEW

### Reuse directly (do not duplicate):
- `src/utils/knn.ts` -- the K-NN distance function is asset-agnostic
- `src/utils/quantMath.ts` -- z-score and normalization math
- `src/lib/macro-bias/technical-analysis.ts` -- RSI and SMA calculations
- `src/lib/supabase/admin.ts` -- Supabase client
- `src/lib/server-env.ts` -- env var helpers
- `src/lib/analytics/` -- analytics tracking
- Resend email infrastructure
- Stripe billing infrastructure
- Social posting infrastructure

### Create new (parallel implementations):
- Crypto feature vector types and constants
- Crypto bias calculation pipeline
- Crypto data fetching (new tickers, dedup with equity pipeline for shared tickers like GLD, TLT)
- Crypto backtest engine
- Crypto briefing AI prompt (completely different content)
- Crypto regime classifier
- All crypto pages (regime, dashboard, track record, briefings)
- Crypto publish cron route

---

## 6. CRYPTO BRIEFING AI PROMPT

The crypto briefing should follow the same structure as the equity briefing but with crypto-specific content. Use the same section headers for consistency:

**Sections**: BOTTOM LINE, SECTOR BREAKDOWN (rename to MARKET BREAKDOWN for crypto), RISK CHECK, MODEL NOTES

**Voice**: Same as equity -- sharp, experienced trader explaining to a friend. Plain English. No jargon. No em-dashes. No AI slop words.

**Key differences from equity prompt**:
- Reference BTC, ETH, SOL instead of SPY, QQQ, XLP
- "Sector Breakdown" becomes "Market Breakdown" covering: Bitcoin, Altcoins (ETH-led), DeFi/L1s, Stablecoins/Flows
- Risk Check should reference crypto-specific risks: exchange risk, regulatory news, whale movements, funding rates
- Model Notes should reference crypto-specific features: BTC realized vol, ETH/BTC ratio, DXY correlation
- Add a note about 24/7 markets: "The crypto market trades around the clock. This briefing reflects the daily close at midnight UTC and conditions at time of writing."
- The delivery hook is "before the US session opens" (not "before the bell")

**Restrictions**: Same as equity. No specific trade advice. No long/short/buy/sell/entry/target/stop.

---

## 7. CRON AND DELIVERY

### Crypto publish cron
- Path: `/api/cron/crypto-publish`
- Schedule: `0 13 * * *` (1:00 PM UTC, about 15 minutes after the equity cron at 12:45)
- This gives the equity cron time to finish and avoids Yahoo Finance rate limits from concurrent requests

### Add to vercel.json:
```json
{
  "path": "/api/cron/crypto-publish",
  "schedule": "0 13 * * *"
}
```

### Important: Vercel Hobby plan limits
The Hobby plan allows **daily** cron expressions only. `0 13 * * *` is fine. Do NOT use sub-daily frequencies.

### Crypto publish cron logic (mirrors equity):
1. Fetch crypto market data (BTC-USD, ETH-USD, SOL-USD, DX-Y.NYB from Yahoo Finance; GLD and TLT already fetched by equity cron)
2. Build today's 6-feature vector
3. Compute the crypto bias score via K-NN
4. Upsert into `crypto_bias_scores`
5. Generate the crypto briefing via Claude
6. Upsert into `crypto_daily_briefings`
7. Send the crypto briefing email (to a separate crypto subscriber list, or to the same list with a crypto section -- your call, but I recommend a separate list initially)
8. Post to social (crypto-specific social posts)

### Data pipeline note
BTC-USD, ETH-USD, and SOL-USD trade 24/7 on Yahoo Finance. The daily "close" is midnight UTC. When fetching, use the same `interval=1d` parameter as the equity pipeline. The Yahoo Finance chart API returns the same OHLCV format regardless of whether the instrument is a stock or crypto pair.

DX-Y.NYB (US Dollar Index) only trades during forex hours. It will have gaps on weekends. Handle missing DXY data by carrying forward the last known close (same approach the equity pipeline uses for VIX on holidays).

---

## 8. PAGE DESIGN

All crypto pages should follow the same design language as the equity pages:
- Dark zinc/black background, white text
- `font-data` monospace for numbers, `font-heading` for headings
- Bracketed uppercase labels like `[ CRYPTO ]` and `[ BTC REGIME ]`
- Same component patterns (gauges, heatmaps, charts via Recharts)

### Routes:
- `/crypto` -- Crypto regime overview (mirrors `/regime`)
- `/crypto/dashboard` -- Live crypto dashboard (mirrors `/dashboard`)
- `/crypto/track-record` -- Crypto backtest results (mirrors `/track-record`)
- `/crypto/briefings` -- Crypto briefing archive (mirrors `/briefings`)
- `/crypto/briefings/[date]` -- Individual crypto briefing

### Navigation
Add a "Crypto" link to the site nav (`src/components/SiteNav.tsx`). Consider a subtle nav element that lets users toggle between "Stocks" and "Crypto" contexts.

---

## 9. BRAND VOICE (critical, read PRODUCT-PERSONA.md)

There is a file called `PRODUCT-PERSONA.md` in the repo root. Read it. Every piece of crypto content must follow the same voice guidelines. Key rules:
- No em-dashes, ever
- No jargon: "regime blindness", "executable regime call", "quant protocol", "institutional flow"
- No AI slop: "delve", "tapestry", "testament", "landscape", "navigate"
- Plain English, confident but accessible
- Conversational, like a trader talking to a friend

The crypto content should feel like it was written by the same person as the equity content.

---

## 10. EXECUTION PLAN (suggested order)

### Phase 1: Data layer
1. Write the Supabase migration SQL
2. Create `src/lib/crypto-bias/types.ts` with crypto feature types
3. Create `src/lib/crypto-bias/constants.ts` with crypto model constants
4. Create `src/lib/crypto-market-data/upsert-crypto-market-data.ts` -- fetch BTC-USD, ETH-USD, SOL-USD, DX-Y.NYB from Yahoo Finance, dedup shared tickers
5. Create `src/scripts/run-daily-crypto-bias-sync.ts` for manual testing

### Phase 2: Model
6. Create `src/lib/crypto-bias/calculate-crypto-bias.ts` -- the crypto scoring pipeline (mirror the equity version, swap features)
7. Create `src/utils/crypto-regime-classifier.ts` -- crypto regime classification
8. Create `src/lib/crypto-track-record/crypto-backtest-engine.ts` -- walk-forward backtest from 2020-01-02

### Phase 3: Briefing
9. Create `src/lib/crypto-briefing/crypto-briefing-config.ts` -- crypto-specific AI prompt
10. Create `src/lib/crypto-briefing/crypto-brief-generator.ts` -- crypto briefing generation pipeline

### Phase 4: API and cron
11. Create `src/app/api/cron/crypto-publish/route.ts` -- the crypto publish cron
12. Add the cron to `vercel.json`

### Phase 5: Pages
13. Create `/crypto` regime overview page
14. Create `/crypto/dashboard` page
15. Create `/crypto/track-record` page
16. Create `/crypto/briefings` and `/crypto/briefings/[date]` pages
17. Add crypto nav link

### Phase 6: Backtest validation
18. Run the backtest locally and print results
19. Only proceed with launch if the strategy return meaningfully outperforms BTC buy-and-hold
20. If numbers are weak, try adjusting `blendedReturnScale`, `temporalDecayLambda`, or the feature set before giving up

---

## 11. THINGS TO WATCH OUT FOR

1. **Yahoo Finance rate limits**: The equity pipeline already fetches 9 tickers with staggered requests and retry logic. The crypto pipeline adds 4 more (but 2 overlap with equity: GLD, TLT). Stagger crypto fetches 200-300ms apart. Add User-Agent header. Use the same retry-with-exponential-backoff pattern.

2. **24/7 markets**: BTC never closes. Yahoo Finance uses midnight UTC as the daily close. Your "trade date" for crypto should be the UTC date. Do not try to align with NYSE trading days.

3. **Weekend data**: BTC trades on weekends. DXY and TLT do not. For Saturday/Sunday crypto scores, carry forward the last Friday close for DXY and TLT. The model should still produce a score on weekends (this is actually a feature -- equity traders don't get weekend scores).

4. **Shared price data**: GLD and TLT are already in `etf_daily_prices` from the equity pipeline. Do NOT re-fetch them. Query the existing data. Only fetch if today's row is missing (the equity cron ran 15 minutes earlier and should have it).

5. **The ticker CHECK constraint**: The migration must update the CHECK constraint on `etf_daily_prices` to include the new crypto tickers. The existing constraint is: `ticker IN ('SPY', 'QQQ', 'XLP', 'TLT', 'GLD', 'VIX', 'HYG', 'CPER', 'USO')`.

6. **Realized volatility calculation**: BTC realized vol is NOT available from Yahoo Finance as a separate ticker. You must compute it from the last 20 daily closes of BTC-USD: `stddev(ln(close[t]/close[t-1])) * sqrt(365)`. Note: annualize by sqrt(365), not sqrt(252), because crypto trades every day.

7. **DXY ticker on Yahoo Finance**: The ticker is `DX-Y.NYB`. Store it as `DXY` in the database (strip the special characters, same as `^VIX` -> `VIX`).

8. **SOL-USD history**: SOL only has reliable Yahoo Finance data from ~April 2020. This is fine since the backtest starts 2020-01-02, but the first few months may have missing SOL data. SOL is a tracked ticker for the UI only, it is not used in any feature calculations, so this is cosmetic.

9. **Do not modify any existing equity code**. The crypto system is additive. If you need a shared utility, import from the existing location. If you need to extend a type, create a new type in the crypto types file.

10. **Vercel Hobby plan**: Maximum 1 cron job execution per day per path. The crypto cron at `0 13 * * *` is fine. Do not add additional sub-daily crons.

---

## 12. ACCEPTANCE CRITERIA

The system is complete when:

- [ ] `npx tsx src/scripts/run-daily-crypto-bias-sync.ts` successfully fetches crypto data, computes a score, and upserts it
- [ ] The crypto backtest runs from 2020-01-02 to present and produces a strategy return, SPY-equivalent (BTC buy-and-hold) return, and equity curve
- [ ] `/crypto` renders a regime overview page with the current crypto bias score
- [ ] `/crypto/dashboard` renders a live dashboard with BTC, ETH, SOL prices and the crypto bias gauge
- [ ] `/crypto/track-record` renders the crypto backtest results with an equity curve chart
- [ ] `/crypto/briefings` lists past crypto briefings
- [ ] `/crypto/briefings/[date]` renders a single crypto briefing with free/premium gating
- [ ] The crypto publish cron at `/api/cron/crypto-publish` works end-to-end: data fetch -> score -> briefing -> email -> social
- [ ] `next build` succeeds with no type errors
- [ ] All new code follows the brand voice in PRODUCT-PERSONA.md
- [ ] No existing equity functionality is broken

---

## 13. WHAT NOT TO DO

- Do not over-engineer. Mirror the equity patterns. If the equity version does something a certain way, do it the same way for crypto unless there is a clear reason not to.
- Do not add WebSocket feeds, real-time data, or sub-daily scoring. This is a daily product.
- Do not add altcoin scoring (DOGE, AVAX, etc). BTC only for the model. ETH and SOL are tracked for display only.
- Do not create a separate subscriber list yet. For now, crypto briefings go to the same `free_subscribers` table with a `crypto_opted_in` boolean column (add this in the migration). The publish cron sends crypto briefings only to opted-in subscribers.
- Do not modify the equity briefing prompt, equity scoring, or equity pages.
- Do not add new npm dependencies unless absolutely necessary. The existing stack (Next.js, Supabase, Anthropic SDK, Recharts, Resend) handles everything.
