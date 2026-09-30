# Macro Bias

I wanted one number before the open, so I publish a daily score.

**What it is**

A score from -100 to +100 for stocks, and the same idea for crypto. Each score comes with a permission: LONG, SHORT, FLAT, or NO_TRADE. Reliability is a grade from A to F. F means NO_TRADE. A dead zone around zero means FLAT. It is not a price target and it is not a certainty claim.

**Who it is for**

People who want that permission on the site and in their inbox before the session, and who will stand aside when the grade says not to trade.

**How the score is made**

Stocks use the current feature package: SPY RSI, VIX momentum, HYG/TLT, CPER/GLD, and USO momentum. Levels become rolling percentiles. Similar past days are the nearest neighbors by cosine distance on z-scored features. K adapts when volatility is high. Neighbor returns map onto the score. Crypto uses the parallel path in `src/lib/crypto-bias/`. A sentence under the score can be written copy. The score itself is the KNN output.

**What paid unlocks**

Free shows the previous session's score on the site. Paid shows today's stock and crypto score, the grade, the size hint, and the morning email. Checkout is a Stripe subscription, monthly or annual. A failed payment removes access.

**Honest limits**

Not financial advice. Not a managed fund. `/track-record` lists settled next-session open-to-close results already stored with the scores. A session that has not settled is not on that page.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill the secrets in `.env.example` that you actually use: Supabase, the Stripe price ids, Resend, and `CRON_SECRET`.
