---
title: "Why We Stopped Leading With a 40,000% Crypto Backtest"
slug: "backtested-41576-vs-btc"
campaignType: "marketing"
published: true
---

For a while, our crypto research backtest produced an eye-watering long-only multiple versus BTC buy-and-hold. That number was real as a spreadsheet output. It was not a credible promise of what live trading would deliver.

So we stopped leading with it.

## What that number actually was

It came from a full-history re-sim of a regime filter on daily closes: long BTC when the model was risk-on, cash otherwise. No leverage. Still, a multi-decade-style multiple over a few years is almost always a warning label, not a headline.

Path dependence, one crypto cycle, optimistic costs, and marketing that freezes a lucky equity curve will destroy trust the first time the live book has a dull quarter.

## What we publish instead

1. **Research backtest** — full re-sim of the production algorithm, with friction, labeled as research.
2. **Live paper ledger** — equity from scores that were actually published to the database, lagged one session, with friction and a size-scaled path.
3. **Tradable output** — LONG / FLAT / NO_TRADE, a size cue from 0 to 1, and a reliability grade.

If the live paper ledger underperforms a sexy re-sim, that is the point. Honesty compounds better than vanity multiples.

## How to use the crypto model

Treat it as a permission layer, not an autopilot:

- Risk-on with solid reliability: you may size up within your own rules.
- Neutral or NO_TRADE: sit out or cut size.
- Never ignore your own risk limits because a chart from 2020 looked heroic.

## The honest caveat

Past research results do not guarantee future results. Crypto is path dependent. Friction, gaps, and weekends are real. The product is daily context with a graded signal, not a guaranteed alpha factory.

Full numbers, including the live paper ledger when enough published days exist: macro-bias.com/crypto/track-record.
