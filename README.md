# Macro Bias

I got tired of vague “market outlook” posts, so I built a small daily research app.

Every morning it looks at a few macro features (equities, vol, credit, metals, oil — and a crypto path), finds similar past days, and publishes a simple next-session **permission**: LONG / SHORT / FLAT / NO_TRADE, with a reliability grade and size hint. Not a price target. Not a certainty claim.

Walk-forward checks against next-session open→close are the gate for model changes. If a knob doesn’t help those numbers, it doesn’t ship.

Learning project / personal product. Not financial advice.

## Stack

- Next.js (App Router) + TypeScript + Tailwind  
- Supabase (Postgres, auth helpers)  
- Market data sync + KNN-style regime scoring  
- Optional: Anthropic for briefing text, Resend email, Stripe billing, social posting  

Live-ish deploy (when up): see the repo homepage on GitHub / Vercel.

## What you can open

| Area | Routes |
|------|--------|
| Stocks | `/today`, `/dashboard`, `/track-record`, `/briefings` |
| Crypto | `/crypto`, `/crypto/dashboard`, `/crypto/track-record` |
| Growth | `/emails`, `/pricing`, `/refer` |
| Admin | `/analytics` (restricted) |

## Quant idea (stocks)

- Features (recent package): SPY RSI, VIX momentum, HYG/TLT, CPER/GLD, USO momentum  
- Stationarize levels to rolling percentiles  
- Cosine distance on z-scored features; adaptive K when vol is high  
- Map neighbor returns → score in [-100, 100]  
- Reliability grades A–F; **F → NO_TRADE**  
- Dead zone around zero → FLAT  

Shared signal types live under `src/lib/signal/`. Crypto has a parallel path in `src/lib/crypto-bias/`.

Check scripts (examples):

```bash
npm run verify:signal
npm run verify:model
npm run measure:quality
```

## Local dev

```bash
npm install
cp .env.example .env.local   # fill secrets you actually need
npm run dev
```

Cron / publish routes expect secrets like `CRON_SECRET` (and whatever Supabase / data APIs you wire up). See `.env.example`.

## Layout

| Path | What |
|------|------|
| `src/app/` | pages + API routes (including crons) |
| `src/lib/` | bias models, signal, billing, social |
| `supabase/migrations/` | schema |
| `scripts/` | one-off verification / ablations |

## Honest limits

- Research tooling + paper paths, not a managed fund.  
- Model versions move; the README won’t always match every experiment folder.  
- Marketing posts under `src/content/marketing/` are content for the product, not research claims.

If a number looks too good or a route is broken, open an issue or yell at me.
