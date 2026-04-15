# Macro Bias

Macro Bias is an automated quantitative research desk.

It runs a daily pre-market pipeline that combines a K-Nearest Neighbors historical price analog with real-time geopolitical and financial news, then distributes the result as a production-grade sector bias briefing. The system is built as a SaaS operating model, not a personal script: it persists market state, synthesizes a structured daily report, logs every run for audit and backtesting, distributes tiered email output, and supports scheduled growth automation.

The core product promise is simple: do not trade the tape in isolation. Macro Bias provides a quantitative baseline, tests whether today's news flow confirms or invalidates that baseline, and publishes a research note that tells the user whether the math is still safe to trust.

## What The System Produces

Every daily briefing has three layers:

1. A quantitative baseline derived from the latest K-NN regime score and historical analog set.
2. A qualitative overlay built from pre-market geopolitical and financial headlines.
3. A final briefing generated under a strict JSON contract by an LLM acting as a structured risk manager.

The finished note is distributed as a sector bias report with explicit regime language, a compact sector playbook, a system risk assessment, and raw model diagnostics.

## The Macro Override Engine

The Macro Override engine is the core business logic.

The K-NN model is the baseline decision layer. It identifies historically similar sessions from persisted market history and calculates the day's regime score from that analog cluster. That baseline is useful only if the live market structure still resembles the historical sample.

The LLM is not used as a discretionary signal generator. It acts as a risk manager.

Its job is to determine whether the current pre-market tape contains a structural break that invalidates the historical analog framework. If the news flow implies that the regime has materially changed, the system flips from trusting baseline math to warning that the analog is no longer safe.

Examples of structural breaks include:

- wars, missile strikes, ceasefires, sanctions, embargoes, and tariff shocks
- banking stress, liquidity events, or credit accidents
- abrupt policy surprises from central banks or governments
- energy disruptions, shipping chokepoints, or commodity shocks
- any macro catalyst that breaks normal analog behavior

When that condition is met, the system sets `is_override_active = true` and the final briefing explicitly warns the user not to trade the baseline math blindly.

In practical terms:

1. The K-NN engine still prints the raw baseline.
2. The LLM evaluates whether that baseline has been structurally invalidated.
3. If the tape is broken, Macro Bias escalates into Macro Override mode.
4. The report shifts from normal playbook framing to regime-risk framing.

The old standalone `macro-override.ts` era is gone. Override logic now lives inside the unified daily briefing pipeline.

## Daily Architecture

The primary orchestration boundary is the secure cron route at `/api/cron/publish`.

### End-to-end flow

1. Vercel Cron hits `/api/cron/publish` once per day.
2. The route validates the bearer secret using `CRON_SECRET` or `PUBLISH_CRON_SECRET`.
3. A same-day publish guard checks `daily_market_briefings` for the current UTC `briefing_date`.
4. If a row already exists, the route returns `200 OK` with `status = skipped` and exits without regenerating or redistributing the report.
5. If no row exists, the route refreshes market data with `upsertDailyMarketData()`.
6. The route loads recent `macro_bias_scores` snapshots from Supabase PostgreSQL.
7. `generateDailyBriefing()` runs the quantitative branch and the news branch in parallel.
8. Anthropic synthesizes the final note under a strict JSON schema.
9. If the News API or LLM degrades, retry and fallback logic still produce a complete report.
10. `persistDailyBriefing()` writes the report to `daily_market_briefings`.
11. `dispatchQuantBriefing()` distributes the result through Resend to free and premium cohorts.
12. Optional outbound publishing can also hit X and other channels when configured.

### Pipeline diagram

```text
Vercel Cron
  -> /api/cron/publish
    -> cron authorization
    -> same-day publish guard
    -> upsertDailyMarketData()
    -> load recent macro_bias_scores context
    -> generateDailyBriefing()
       -> Promise.all(fetchNews(), getQuantScore())
       -> Anthropic synthesis or deterministic fallback
    -> persistDailyBriefing()
    -> dispatchQuantBriefing()
    -> JSON response summary
```

### Parallel execution

The daily generator does not serialize the market and news branches.

It runs these paths concurrently:

- `fetchNews()` pulls the pre-market headline set from Finnhub.
- `getQuantScore()` reconstructs the K-NN context from PostgreSQL-backed market history and persisted model state.

That parallel design keeps the route fast enough for the pre-bell window while preserving a clean separation between quantitative state and live-news state.

### Resilience and fallback design

The system is designed to degrade gracefully rather than fail open.

- `retry.ts` wraps external dependencies in exponential backoff.
- `daily-briefing-strategies.ts` applies a Strategy Pattern to switch between `news-aware` and `news-unavailable` fallback behavior.
- If Finnhub fails, Macro Bias still generates a report from quant context and inserts a clear news-unavailable disclaimer.
- If the LLM fails, the system falls back to a deterministic briefing built from the latest quant context and whatever news state is available.

The important invariant is operational: the desk still produces a report even when the external edge services are degraded.

## Output Contract

The LLM is required to return strict JSON in this shape:

```json
{
  "is_override_active": true,
  "newsletter_copy": "..."
}
```

The generated briefing must contain these four sections in this order:

1. `BOTTOM LINE`
2. `SECTOR BREAKDOWN`
3. `RISK CHECK`
4. `MODEL NOTES`

That stable contract makes the output auditable, renderable, and testable across email, social previews, and future analytics workflows.

The diagnostics layer also exposes raw model evidence such as:

- Intraday Net
- Session Range
- Match Confidence
- closest analog reference

## Persistence, Audit, and Backtesting

Every generated report is written to `public.daily_market_briefings`.

That ledger stores the briefing date, trade date, quant score, bias label, override state, news status, headline set, analog reference, final briefing body, source model, generation method, and timestamp.

This persistence layer has three jobs:

1. preserve a full audit trail of every research note
2. power the same-day duplicate guard
3. create a backtesting dataset for analog reliability, override behavior, and fallback quality

Primary datasets used by the research pipeline:

- `etf_daily_prices`: raw market history used to build the cross-asset feature space
- `macro_bias_scores`: persisted regime scores and model inputs
- `daily_market_briefings`: the final generated report ledger
- `free_subscribers`: frictionless lead-capture list for free-tier distribution
- `scheduled_posts`: scheduled X queue used by the growth automation layer

## Delivery and Growth Automation

Macro Bias now includes two distribution surfaces beyond the core report generator.

### Tiered email delivery

`email-dispatch.ts` builds both premium and free-tier email variants.

- premium users receive the full report
- free users receive a paywalled preview with upgrade prompts
- recipient cohorts are assembled in the publish cron from active paid users and `free_subscribers`

### Scheduled X dispatch

The codebase now includes a scheduled social queue.

- `scheduled_posts` is the live queue table
- `/api/cron/social-dispatch` drains the queue
- the dispatcher finds the oldest row where `status = 'scheduled'` and `scheduled_at <= now()`
- successful sends are marked `published` with `published_at`

This growth path is not part of the core Macro Override decision engine, but it is part of the current production runtime and should be documented as such.

## Repository Map

```text
src/
  app/
    api/
      cron/
        publish/
          route.ts
        social-dispatch/
          route.ts
      subscribe/
        route.ts
    emails/
      page.tsx
  lib/
    briefing/
      daily-brief-generator.ts
      daily-briefing-config.ts
      daily-briefing-strategies.ts
      persist-daily-briefing.ts
      retry.ts
      types.ts
    marketing/
      email-dispatch.ts
    social/
      scheduled-post-dispatch.ts
    market-data/
      fetch-morning-news.ts
      upsert-daily-market-data.ts
  scripts/
    arm-scheduled-social-queue.ts
    run-daily-macro-bias-sync.ts

supabase/
  migrations/
    202604080001_create_daily_market_briefings.sql
    202604090001_create_free_subscribers.sql
```

### File roles

| File                                                                 | Responsibility                                                                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/briefing/daily-brief-generator.ts`                          | Coordinates the full daily synthesis flow. Runs quant and news in parallel, calls Anthropic, normalizes malformed output, and applies deterministic fallback logic when needed. |
| `src/app/api/cron/publish/route.ts`                                  | Secure daily orchestration boundary. Handles cron authorization, same-day skip protection, market-data refresh, report generation, persistence, and outbound publishing.        |
| `src/lib/marketing/email-dispatch.ts`                                | Builds HTML and text emails, supports free and premium tiers, honors `SHADOW_RUN_EMAIL`, and sends through Resend.                                                              |
| `src/lib/briefing/daily-briefing-config.ts`                          | Defines the model, retry budgets, JSON schema, section headers, and prompt contract for the LLM.                                                                                |
| `src/lib/briefing/daily-briefing-strategies.ts`                      | Implements the Strategy Pattern for `news-aware` and `news-unavailable` briefing behavior.                                                                                      |
| `src/lib/briefing/retry.ts`                                          | Provides exponential backoff for external dependencies such as Finnhub and Anthropic.                                                                                           |
| `src/lib/briefing/persist-daily-briefing.ts`                         | Writes the final report record into `daily_market_briefings`.                                                                                                                   |
| `supabase/migrations/202604080001_create_daily_market_briefings.sql` | Creates the persistence table used for audit history, duplicate-run protection, and future backtesting.                                                                         |
| `src/app/api/subscribe/route.ts`                                     | Accepts frictionless free-tier email capture and upserts `free_subscribers`.                                                                                                    |
| `src/lib/social/scheduled-post-dispatch.ts`                          | Executes due X posts from `scheduled_posts` and marks them published.                                                                                                           |

## Environment Variables

Macro Bias does not consume a raw `DATABASE_URL` in the application runtime. The live runtime uses Supabase via `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

### Core platform

| Variable                        | Required | Purpose                                                                            |
| ------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes      | Supabase project URL used by server-side and browser-side clients.                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes      | Public Supabase client key for browser auth flows.                                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | Yes      | Privileged server-side access for cron routes, persistence, and subscriber writes. |
| `NEXT_PUBLIC_APP_URL`           | Yes      | Canonical base URL for dashboard, email, and share links.                          |
| `CRON_SECRET`                   | Yes      | Primary bearer secret for `/api/cron/publish` and `/api/cron/social-dispatch`.     |
| `PUBLISH_CRON_SECRET`           | Optional | Backward-compatible fallback secret name.                                          |

### Research generation

| Variable            | Required | Purpose                                                |
| ------------------- | -------- | ------------------------------------------------------ |
| `FINNHUB_API_KEY`   | Yes      | Pre-market news source used by the qualitative branch. |
| `ANTHROPIC_API_KEY` | Yes      | LLM synthesis and Macro Override evaluation.           |

### Email delivery and safe testing

| Variable              | Required                                   | Purpose                                                                                                             |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`      | Yes                                        | Resend API key for email distribution.                                                                              |
| `RESEND_FROM_ADDRESS` | Recommended                                | Authenticated production sender, ideally a verified `@macro-bias.com` address.                                      |
| `SHADOW_RUN_EMAIL`    | Strongly recommended for local and staging | Forces all email dispatch to one inbox so you can test the full pipeline without touching the real subscriber list. |

### Billing and paywall surface

| Variable                             | Required               | Purpose                                     |
| ------------------------------------ | ---------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes for checkout flows | Browser Stripe key.                         |
| `STRIPE_SECRET_KEY`                  | Yes for checkout flows | Server-side Stripe key.                     |
| `STRIPE_MONTHLY_PRICE_ID`            | Yes for paid plans     | Monthly price ID used by checkout.          |
| `STRIPE_ANNUAL_PRICE_ID`             | Yes for paid plans     | Annual price ID used by checkout.           |
| `STRIPE_WEBHOOK_SECRET`              | Yes for billing sync   | Signature verification for Stripe webhooks. |

### Optional outbound channels

| Variable                      | Purpose                                |
| ----------------------------- | -------------------------------------- |
| `X_API_KEY`                   | X app key for direct posting.          |
| `X_API_SECRET`                | X app secret.                          |
| `X_ACCESS_TOKEN`              | X user access token.                   |
| `X_ACCESS_SECRET`             | X user access secret.                  |
| `DISCORD_PUBLISH_WEBHOOK_URL` | Optional Discord distribution webhook. |

## Local Setup

1. Install dependencies.
2. Populate environment variables.
3. Apply the checked-in Supabase migrations.
4. Ensure your Supabase project also contains the `scheduled_posts` table if you plan to use the X queue.
5. Start the app.
6. Validate type safety and the production build.

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

Useful operational commands:

```bash
npm run macro-bias:sync
npm run social:arm-queue
```

`macro-bias:sync` refreshes the underlying market dataset without running the publish route. `social:arm-queue` inserts the scheduled X queue from `src/content/marketing/x-queue-scheduled.json` into `scheduled_posts`.

## Email Dispatch and Deliverability

Resend is the email transport layer.

Production delivery is designed around an authenticated custom domain sender on `macro-bias.com` with standard deliverability controls:

- SPF alignment for the sending domain
- DKIM signing through Resend
- DMARC enforcement for visibility and policy-backed rejection behavior

The codebase supports safe testing by design. If `SHADOW_RUN_EMAIL` is set, outbound mail is forced to that single inbox, which prevents local and staging runs from spamming the real subscriber list.

Operationally:

- leave `SHADOW_RUN_EMAIL` set for local and staging validation
- use a verified `RESEND_FROM_ADDRESS` for production
- unset or intentionally manage `SHADOW_RUN_EMAIL` before live delivery to the full audience

## Testing and Shadow Runs

The safest local validation path is to call the cron routes directly with the bearer secret.

### Trigger the daily publish route

```bash
curl -X POST http://localhost:3000/api/cron/publish \
  -H "Authorization: Bearer <CRON_SECRET>"
```

### Trigger the scheduled social dispatcher

```bash
curl -X GET http://localhost:3000/api/cron/social-dispatch \
  -H "Authorization: Bearer <CRON_SECRET>"
```

### Expected daily behavior

On the first successful run of the day, `/api/cron/publish` should:

1. refresh market data
2. generate the briefing
3. persist the row in `daily_market_briefings`
4. distribute the report through the configured channels

If a briefing for the current UTC date already exists, the route returns `200 OK` and exits gracefully with a skipped status. This is the same-day publish guard, and it is intentional.

Example skipped response shape:

```json
{
  "briefingDate": "2026-04-09",
  "message": "Briefing already generated for today.",
  "ok": true,
  "status": "skipped"
}
```

The social dispatcher behaves similarly. If no scheduled X post is due, it exits cleanly without publishing.

## Operational Notes

- The daily publish cron is the authoritative research-generation boundary.
- The K-NN model is the baseline, not the final authority.
- The LLM's highest-value job is invalidation, not creativity.
- Every report is persisted before distribution.
- The same-day guard prevents accidental duplicate sends.
- The shadow-run mechanism exists specifically to keep local testing safe.

Macro Bias is now a production automation system: data refresh, synthesis, override judgment, persistence, email delivery, and scheduled growth automation all run as part of one integrated desk workflow.
      email-dispatch.ts
    market-data/
      fetch-morning-news.ts
      upsert-daily-market-data.ts

supabase/
  migrations/
    202604080001_create_daily_market_briefings.sql
```

### File roles

| File                                                                 | Responsibility                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/briefing/daily-brief-generator.ts`                          | Coordinates the full daily synthesis flow. Runs the quant and news branches in parallel, calls Anthropic, and applies deterministic fallback logic if needed. |
| `src/app/api/cron/publish/route.ts`                                  | Secure cron entrypoint. Handles authorization, same-day skip protection, market-data refresh, persistence, and outbound publication.                          |
| `src/lib/marketing/email-dispatch.ts`                                | Builds HTML and text emails and sends them through Resend. Supports shadow-run recipient locking for safe testing.                                            |
| `src/lib/briefing/daily-briefing-config.ts`                          | Centralizes the Anthropic model, output schema, prompt contract, and retry budgets.                                                                           |
| `src/lib/briefing/daily-briefing-strategies.ts`                      | Encapsulates fallback generation behavior for `news-aware` and `news-unavailable` states.                                                                     |
| `supabase/migrations/202604080001_create_daily_market_briefings.sql` | Creates the persistence table used for reporting history and same-day duplicate prevention.                                                                   |

## Data Model

The daily briefing path relies on three primary datasets:

- `etf_daily_prices`: raw market history used to construct the quant feature set.
- `macro_bias_scores`: persisted daily regime scores and model inputs.
- `daily_market_briefings`: the final generated report ledger used for backtesting and duplicate-run protection.

## Environment Variables

### Required for the daily briefing pipeline

| Variable                        | Required                | Purpose                                                                        |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL`           | Yes                     | Base URL for dashboard links and share links.                                  |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes                     | Supabase project URL.                                                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes                     | Public Supabase client key for app auth flows.                                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | Yes                     | Server-side privileged database access.                                        |
| `CRON_SECRET`                   | Yes                     | Primary secret for `/api/cron/publish`.                                        |
| `PUBLISH_CRON_SECRET`           | Optional                | Backward-compatible fallback secret name.                                      |
| `FINNHUB_API_KEY`               | Yes                     | Pre-market news source.                                                        |
| `ANTHROPIC_API_KEY`             | Yes                     | LLM synthesis and Macro Override evaluation.                                   |
| `RESEND_API_KEY`                | Yes                     | Email dispatch provider key.                                                   |
| `RESEND_FROM_ADDRESS`           | Recommended             | Production sender, ideally an authenticated `@macro-bias.com` address.         |
| `SHADOW_RUN_EMAIL`              | Recommended for testing | Forces all briefing mail to one inbox during shadow runs and local validation. |

### Optional secondary channels

| Variable                      | Purpose                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `X_API_KEY`                   | X API app key.                                            |
| `X_API_SECRET`                | X API app secret.                                         |
| `X_ACCESS_TOKEN`              | X user access token.                                      |
| `X_ACCESS_SECRET`             | X user access secret.                                     |
| `X_API_KEY_SECRET`            | Legacy fallback secret name supported by the route.       |
| `X_ACCESS_TOKEN_SECRET`       | Legacy fallback token-secret name supported by the route. |
| `DISCORD_PUBLISH_WEBHOOK_URL` | Optional Discord webhook if that channel is re-enabled.   |

The repository also contains Stripe billing infrastructure for the product surface, but the variables above are the critical set for the daily automated research pipeline.

## Local Setup

1. Install dependencies.
2. Configure the required environment variables.
3. Apply the Supabase migrations, including `202604080001_create_daily_market_briefings.sql`.
4. Start the app.
5. Validate the TypeScript build.

```bash
npm install
npm run dev
npm run typecheck
```

To refresh quant data manually without triggering the publish route:

```bash
npm run macro-bias:sync
```

## Email Dispatch And Deliverability

Email distribution is handled by Resend.

For production delivery, the intended setup is:

- `RESEND_FROM_ADDRESS` points to an authenticated `macro-bias.com` sender
- SPF is published for the sending domain
- DKIM is enabled through Resend
- DMARC is enforced so alignment failures are observable and policy-backed

The codebase also supports safe testing behavior. During a shadow run, outbound mail is forced to `SHADOW_RUN_EMAIL` so the pipeline can be tested end-to-end without touching the live subscriber list.

If you are validating the system locally or in pre-production, keep the shadow-run recipient lock enabled. If you are moving to production, switch to the authenticated custom-domain sender and remove the shadow-run recipient override.

## Shadow Run Testing

The recommended local test path is to invoke the publish route directly with the cron secret header.

### Trigger the daily route

```bash
curl -X POST http://localhost:3000/api/cron/publish \
  -H "Authorization: Bearer <CRON_SECRET>"
```

### Expected behavior

On the first successful run of the day, the route should:

1. refresh market data
2. generate the daily briefing
3. persist the new row to `daily_market_briefings`
4. send exactly one email to `SHADOW_RUN_EMAIL`

On a second run on the same UTC date, the same-day publish guard should return `200 OK` and skip dispatch.

Example skip response:

```json
{
  "briefingDate": "2026-04-08",
  "message": "Briefing already generated for today.",
  "ok": true,
  "status": "skipped"
}
```

This is the safety mechanism that prevents accidental duplicate briefings and subscriber spam if the cron is retried or manually re-fired.

## Scheduling

The primary daily job is defined in `vercel.json`:

```json
{
  "path": "/api/cron/publish",
  "schedule": "45 12 * * *"
}
```

The schedule is expressed in UTC. Adjust operational expectations accordingly for New York pre-market timing and daylight-saving changes.

## Architectural Principles

The current codebase is organized around a few explicit principles:

- quant remains the baseline model
- the LLM is used as a structured synthesis and risk-escalation layer, not as a discretionary trading engine
- a daily report must still be generated under partial dependency failure
- every report must be persisted for auditability and backtesting
- distribution must be safe by default during testing and shadow runs

That architecture is what turns Macro Bias into a daily automated financial research SaaS rather than a one-off market script.
