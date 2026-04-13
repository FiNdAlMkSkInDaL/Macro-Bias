import { ALL_REGIME_SLUGS, type RegimeSlug } from "./regime-data";

// ----- Regime content definitions -----

export type RegimeContent = {
  headline: string;
  tagline: string;
  description: string;
  whatItMeans: string;
  tradingImplications: string[];
  historicalContext: string;
  keyIndicators: string[];
  faq: Array<{ question: string; answer: string }>;
  seoTitle: string;
  seoDescription: string;
};

const REGIME_CONTENT: Record<RegimeSlug, RegimeContent> = {
  "extreme-risk-on": {
    headline: "Extreme Risk On",
    tagline: "Maximum bullish conviction across all macro axes.",
    description:
      "Extreme Risk On is the algo's strongest bullish signal. It fires when equity momentum, credit spreads, volatility suppression, and commodity flows all align in the same direction — a rare confluence that historically precedes sustained directional moves in SPY.",
    whatItMeans:
      "Capital is flowing aggressively into equities and credit. Bonds are selling off as investors rotate out of safety. VIX is compressed below its 20-day average. High-yield (HYG) is outperforming treasuries (TLT). Oil demand signals are rising. This is the institutional \"risk budget is fully deployed\" regime.",
    tradingImplications: [
      "Continuation and breakout setups have historically higher win rates in this regime.",
      "Mean-reversion shorts carry elevated risk — trends persist longer than expected.",
      "Sector rotation favors high-beta names: tech, consumer discretionary, small caps.",
      "Position sizing can be expanded relative to Risk On — the algo's confidence is at maximum.",
      "Watch for VIX divergence as the earliest warning sign the regime may be peaking.",
    ],
    historicalContext:
      "Extreme Risk On is the rarest of the five regimes. When it triggers, forward 1-day and 3-day SPY returns have historically skewed positive with reduced drawdown risk. The regime tends to cluster in the early stages of bull market impulses and after major capitulation events.",
    keyIndicators: [
      "SPY RSI above 60 with price above 20-day SMA",
      "HYG/TLT ratio rising — credit confidence expanding",
      "VIX below 20-day average and declining",
      "USO momentum positive — demand cycle intact",
      "K-NN analog matches show strong forward returns",
    ],
    faq: [
      {
        question: "What does Extreme Risk On mean for day trading?",
        answer:
          "Extreme Risk On is the algo's highest conviction bullish regime. It means all five macro pillars — equity trend, credit spreads, volatility, commodity demand, and historical analogs — are aligned for risk-seeking behavior. Continuation long setups historically outperform in this environment.",
      },
      {
        question: "How often does Extreme Risk On trigger?",
        answer:
          "Extreme Risk On is the rarest regime, typically appearing in fewer than 15% of trading sessions. It clusters after major capitulation events and during early-stage bull impulses when institutional capital is being deployed aggressively.",
      },
      {
        question: "What should I watch for when the regime is Extreme Risk On?",
        answer:
          "Monitor VIX for divergence (rising while SPY continues higher), HYG/TLT ratio for flattening, and USO momentum for reversal. These are early signals the regime may be transitioning back to standard Risk On or Neutral.",
      },
      {
        question: "How does Macro Bias calculate the Extreme Risk On score?",
        answer:
          "The model uses K-Nearest Neighbors analysis across SPY, TLT, GLD, USO, and HYG price data, combined with VIX levels, RSI, MACD, and moving average crossovers. A score above +60 with all pillars aligned triggers the Extreme Risk On classification.",
      },
    ],
    seoTitle: "Extreme Risk On Regime — Macro Bias Algo Signal for Day Traders",
    seoDescription:
      "Understand the Extreme Risk On macro regime signal. Learn what it means for day trading, how often it triggers, and what setups work best when all macro pillars are bullish.",
  },

  "risk-on": {
    headline: "Risk On",
    tagline: "Institutional capital is flowing into equities and credit.",
    description:
      "Risk On is the algo's standard bullish signal. It indicates that the balance of intermarket evidence — equity momentum, credit confidence, volatility, and commodity flows — favors risk-seeking behavior. Most of your best trending days occur in this regime.",
    whatItMeans:
      "The macro backdrop supports directional long exposure. SPY is trending above key moving averages. Credit spreads are tightening (HYG outperforming TLT). Volatility is contained. This is the \"normal bullish\" state where momentum strategies have historically outperformed.",
    tradingImplications: [
      "Trend-following and momentum setups are favored over mean reversion.",
      "Pullback entries on strong names tend to resolve higher rather than breaking down.",
      "Volatility selling strategies (short premium) have a statistical edge in this regime.",
      "Defensive sectors (utilities, staples) tend to underperform — avoid hiding in safety.",
      "Keep a trailing stop rather than a fixed target — trends extend further than you expect.",
    ],
    historicalContext:
      "Risk On is the most common bullish regime, appearing in roughly 30-40% of trading sessions. It represents the \"default state\" of a healthy market tape. Transitions from Neutral to Risk On often signal the start of multi-week trending periods.",
    keyIndicators: [
      "SPY above 20-day SMA with positive RSI momentum",
      "HYG/TLT ratio stable or rising",
      "VIX below 20 or declining toward its moving average",
      "Gold (GLD) flat or declining — no flight-to-safety demand",
      "K-NN analogs show moderate positive forward expectancy",
    ],
    faq: [
      {
        question: "What does Risk On mean for day traders?",
        answer:
          "Risk On means the algo's intermarket model sees bullish conditions: equity momentum is positive, credit spreads are tight, volatility is contained, and historical K-NN analogs suggest positive forward returns. Trend-following and breakout entries are statistically favored.",
      },
      {
        question: "How is Risk On different from Extreme Risk On?",
        answer:
          "Risk On is the standard bullish regime where most (but not all) macro pillars are aligned. Extreme Risk On requires unanimous alignment across all five pillars and typically has higher conviction scores. Risk On is more common; Extreme Risk On is rare.",
      },
      {
        question: "What sectors perform best during Risk On?",
        answer:
          "High-beta sectors like technology (QQQ), consumer discretionary, and small caps (IWM) historically outperform during Risk On. Defensive sectors like utilities and consumer staples (XLP) tend to lag as capital rotates toward growth.",
      },
      {
        question: "How do I get daily Risk On/Risk Off alerts?",
        answer:
          "Sign up for the free Macro Bias daily email. You'll receive the algo's regime score every trading day before the bell. Premium subscribers get the full briefing with sector scoring, K-NN diagnostics, and system risk protocol.",
      },
    ],
    seoTitle: "Risk On Regime — Daily Macro Bias Signal for Day Traders",
    seoDescription:
      "Learn about the Risk On macro regime signal. Discover what drives it, how it affects day trading setups, which sectors outperform, and how to get daily regime alerts.",
  },

  neutral: {
    headline: "Neutral",
    tagline: "Mixed signals. The macro tape is indecisive.",
    description:
      "Neutral fires when the algo detects conflicting signals across the intermarket complex. Some pillars lean bullish, others lean bearish, and the net score lands near zero. This is the environment where discretionary traders get chopped up most often.",
    whatItMeans:
      "There's no clear macro wind at your back or in your face. Equity momentum may be positive while credit spreads are widening, or VIX may be declining while commodity demand is weakening. The model sees cross-currents that cancel each other out.",
    tradingImplications: [
      "Reduce position sizing — the macro backdrop doesn't support high-conviction directional bets.",
      "Mean-reversion strategies (fading extremes) tend to outperform trend-following in Neutral.",
      "Range-bound tactics: trade the range, don't force the breakout until the regime shifts.",
      "Intraday time horizons work better than swing trades — overnight gap risk is elevated.",
      "This is the best regime for sitting on your hands. Capital preservation is edge.",
    ],
    historicalContext:
      "Neutral is the transition regime. It often appears between Risk On and Risk Off phases, acting as a buffer zone. Markets can persist in Neutral for days or weeks. The key alpha is recognizing which direction the regime is likely to resolve toward — the Macro Bias daily trend analysis addresses this directly.",
    keyIndicators: [
      "SPY near its 20-day SMA — no clear trend direction",
      "HYG/TLT ratio flat — credit market is indecisive",
      "VIX near its 20-day average — balanced fear/greed",
      "Mixed K-NN analog signals — neighbors disagree on forward returns",
      "Score between -20 and +20 — net macro pressure is minimal",
    ],
    faq: [
      {
        question: "What does a Neutral macro regime mean for trading?",
        answer:
          "Neutral means the algo's five macro pillars are sending conflicting signals. Some lean bullish, others bearish, and the net effect cancels out. This is when most retail traders get chopped — the model advises reducing size and favoring mean-reversion over trend-following.",
      },
      {
        question: "Should I avoid trading during Neutral regimes?",
        answer:
          "Not necessarily, but you should adjust your approach. Reduce position sizing, favor intraday over swing setups, and focus on mean-reversion trades that fade extremes. The key edge in Neutral is capital preservation — knowing when NOT to push.",
      },
      {
        question: "How long do Neutral regimes typically last?",
        answer:
          "Neutral periods vary from a single session to multiple weeks. They often appear as transition zones between Risk On and Risk Off. The daily Macro Bias briefing tracks the trend direction within Neutral to help anticipate which regime will resolve next.",
      },
      {
        question: "What causes a Neutral regime to shift?",
        answer:
          "A catalyst — usually a VIX spike, a credit spread widening, or a decisive break of SPY's 20-day SMA — pushes the model out of Neutral. The premium daily briefing includes K-NN diagnostics that quantify how close the current state is to flipping.",
      },
    ],
    seoTitle: "Neutral Regime — When to Sit Tight | Macro Bias Algo",
    seoDescription:
      "The Neutral macro regime means mixed signals across equity, credit, and volatility. Learn why most traders get chopped in this regime and how to adapt your strategy.",
  },

  "risk-off": {
    headline: "Risk Off",
    tagline: "Capital is rotating into safety. Defense wins.",
    description:
      "Risk Off indicates that the balance of intermarket evidence favors defensive positioning. Bonds are bid, credit spreads are widening, and equity momentum is deteriorating. This is the regime where stubborn longs get punished.",
    whatItMeans:
      "Institutional capital is rotating out of equities and into treasuries and gold. VIX is elevated or rising. High-yield credit (HYG) is underperforming investment-grade bonds (TLT). The market is pricing in fear, not growth. Fighting this tape with long equity exposure is fighting the current.",
    tradingImplications: [
      "Defensive positioning is favored — bonds (TLT), gold (GLD), and low-beta names outperform.",
      "Short setups and put spreads have a statistical edge when the model reads Risk Off.",
      "Volatility expansion strategies (long premium) are historically profitable in this regime.",
      "Avoid buying dips without confirmation — falling knives are common in Risk Off.",
      "Cash is a legitimate position. The best trade might be no trade at all.",
    ],
    historicalContext:
      "Risk Off regimes appear during market corrections, geopolitical shocks, and periods of tightening financial conditions. They tend to be shorter than Risk On periods but more intense. The sharpest single-day drops and highest VIX readings occur in Risk Off.",
    keyIndicators: [
      "SPY below 20-day SMA with declining RSI",
      "HYG/TLT ratio falling — credit stress widening",
      "VIX above 20-day average and rising",
      "Gold (GLD) bid — flight-to-safety active",
      "K-NN analogs show negative forward return expectancy",
    ],
    faq: [
      {
        question: "What does Risk Off mean for my trading?",
        answer:
          "Risk Off means the algo detects institutional capital rotating into bonds, gold, and cash while equities and credit weaken. Short setups, defensive sector longs, and volatility expansion strategies historically outperform. Stubborn long equity exposure is the most common mistake in this regime.",
      },
      {
        question: "How do I trade Risk Off as a day trader?",
        answer:
          "Focus on short setups, put spreads, or TLT/GLD longs. If you trade equities, stick to low-beta names with relative strength. Reduce overall sizing and avoid overnight long exposure. The premium briefing provides specific sector-by-sector scoring and catalyst analysis.",
      },
      {
        question: "How quickly can Risk Off reverse to Risk On?",
        answer:
          "V-shaped recoveries happen, but the model typically transitions through Neutral first. A direct Risk Off to Risk On flip is rare and usually requires a major catalyst (dovish Fed pivot, geopolitical de-escalation). The daily algo catches these transitions in real time.",
      },
      {
        question: "What macro indicators cause Risk Off conditions?",
        answer:
          "The key drivers are: widening credit spreads (HYG/TLT ratio declining), VIX expansion above its 20-day average, SPY breaking below its 20-day SMA, and negative K-NN forward-return analogs. All five pillars must lean bearish for Extreme Risk Off; Risk Off requires a majority.",
      },
    ],
    seoTitle: "Risk Off Regime — Defensive Trading Signal | Macro Bias Algo",
    seoDescription:
      "The Risk Off regime signals capital flight from equities to bonds and gold. Learn how to adapt your day trading strategy when the algo scores the macro tape as bearish.",
  },

  "extreme-risk-off": {
    headline: "Extreme Risk Off",
    tagline: "Maximum defensive posture. All pillars are bearish.",
    description:
      "Extreme Risk Off is the algo's strongest bearish signal. It fires when every macro pillar — equity trend, credit spreads, volatility, commodity demand, and K-NN analogs — unanimously signals risk aversion. This is the crash-protection regime.",
    whatItMeans:
      "Panic-level stress across the intermarket complex. SPY is in rapid decline. Credit spreads are blowing out. VIX is spiking. Gold is surging as a safe haven. Historical K-NN analogs from similar states show steep negative forward returns. This is the environment where portfolio-level risk management matters more than stock selection.",
    tradingImplications: [
      "Maximum defensive posture — heavy cash, long bonds (TLT), long gold (GLD).",
      "Short-selling and put buying have historically extreme positive expectancy in this regime.",
      "Do NOT buy the dip — the strongest declines come when all pillars align bearish.",
      "Volatility is elevated — reduce position sizes even on directional shorts.",
      "Watch for exhaustion signals: when VIX spikes above 35-40, the regime often reverses within days.",
    ],
    historicalContext:
      "Extreme Risk Off is the rarest bearish regime. It appears during market crashes, acute credit crises, and systemic shocks. While terrifying in real time, these periods historically mark capitulation bottoms — but the bottom is nearly impossible to time. The algo helps by flagging when regime conditions begin to normalize.",
    keyIndicators: [
      "SPY RSI below 30 — deeply oversold with no bounce",
      "HYG/TLT ratio collapsing — credit market panic",
      "VIX above 30 and accelerating higher",
      "Gold (GLD) surging on safe-haven demand",
      "All K-NN neighbors show negative forward returns",
    ],
    faq: [
      {
        question: "What is Extreme Risk Off and when does it trigger?",
        answer:
          "Extreme Risk Off is the algo's most bearish signal. It triggers when all five macro pillars unanimously indicate risk aversion: equity trend broken, credit spreads widening, volatility spiking, commodity demand collapsing, and K-NN analogs showing severe negative forward returns. It typically appears during market crashes and acute credit events.",
      },
      {
        question: "How should I protect my portfolio in Extreme Risk Off?",
        answer:
          "Move to heavy cash positions, consider long TLT (bonds) and GLD (gold) for defensive exposure, and avoid buying equity dips without confirmation. If shorting, keep sizes small because volatility is extreme in both directions. The premium briefing includes specific sector risk protocol for each session.",
      },
      {
        question: "How rare is Extreme Risk Off?",
        answer:
          "Extreme Risk Off is the rarest regime, typically appearing in fewer than 10% of sessions. It clusters during market crashes (2020 COVID, 2022 rate shock) and acute geopolitical events. While rare, the losses it warns about are asymmetric — a few bad days in this regime can erase months of gains.",
      },
      {
        question: "Does Extreme Risk Off mean I should sell everything?",
        answer:
          "Not necessarily, but it means the algo sees maximum macro headwinds. Professional traders use this signal to reduce gross exposure, tighten stops, and shift toward uncorrelated assets. The daily briefing helps you navigate the transition and flags when conditions begin normalizing.",
      },
    ],
    seoTitle: "Extreme Risk Off — Crash Protection Signal | Macro Bias Algo",
    seoDescription:
      "Extreme Risk Off is the algo's strongest bearish signal. Learn what triggers it, how to protect your portfolio, and how to trade the most dangerous macro regime.",
  },
};

export function getRegimeContent(slug: RegimeSlug): RegimeContent {
  return REGIME_CONTENT[slug];
}

export function getAllRegimeContent(): Array<{ slug: RegimeSlug; content: RegimeContent }> {
  return ALL_REGIME_SLUGS.map((slug) => ({
    slug,
    content: REGIME_CONTENT[slug],
  }));
}
