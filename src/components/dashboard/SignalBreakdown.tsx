export type SignalBreakdownPillarKey =
  | "volatility"
  | "creditAndRiskSpreads"
  | "trendAndMomentum"
  | "dealerPositioning"
  | "positioning"
  | "gammaExposure";

export interface SignalBreakdownScore {
  contribution: number;
  key: SignalBreakdownPillarKey;
  label?: string;
  signal: number;
  weight: number;
}

interface SignalBreakdownProps {
  componentScores: SignalBreakdownScore[];
}

const PILLAR_CONFIG = [
  {
    key: "volatility" as const,
    eyebrow: "Volatility Regime",
    symbol: "^VIX",
    methodology:
      "Tracks implied volatility to detect whether the tape is operating in a calm expansion regime or a stress regime before that stress fully bleeds into price behavior.",
  },
  {
    key: "creditAndRiskSpreads" as const,
    eyebrow: "Credit Stress",
    symbol: "HYG vs TLT",
    methodology:
      "Tracks High-Yield junk bonds versus Treasuries to detect hidden institutional risk-off positioning before it shows up cleanly in equities.",
  },
  {
    key: "trendAndMomentum" as const,
    eyebrow: "Trend Exhaustion",
    symbol: "SPY RSI",
    methodology:
      "Measures whether SPY trend structure and momentum are aligned or exhausted, so the model can distinguish healthy continuation from fragile extension.",
  },
  {
    key: "positioning" as const,
    eyebrow: "Market Plumbing",
    symbol: "GEX Proxy",
    methodology:
      "Tracks dealer gamma exposure proxy so the model can distinguish supportive options-market inventory from positioning that can amplify index moves.",
  },
] as const;

function getPillarLookupKeys(key: SignalBreakdownPillarKey): readonly string[] {
  if (key === "positioning" || key === "dealerPositioning" || key === "gammaExposure") {
    return ["positioning", "dealerPositioning", "gammaExposure"];
  }

  return [key];
}

function getPillarScore<T>(scoreByKey: Map<string, T>, key: SignalBreakdownPillarKey) {
  for (const lookupKey of getPillarLookupKeys(key)) {
    const score = scoreByKey.get(lookupKey);

    if (score !== undefined) {
      return score;
    }
  }

  return undefined;
}

function getDisposition(signal: number | undefined) {
  if (signal == null || Number.isNaN(signal)) {
    return {
      label: "Pending",
      tone: "text-zinc-500",
    };
  }

  if (signal > 0.15) {
    return {
      label: "Bullish",
      tone: "text-emerald-400",
    };
  }

  if (signal < -0.15) {
    return {
      label: "Bearish",
      tone: "text-rose-400",
    };
  }

  return {
    label: "Neutral",
    tone: "text-zinc-300",
  };
}

function formatContribution(contribution: number | undefined) {
  if (contribution == null || Number.isNaN(contribution)) {
    return "--";
  }

  return `${contribution > 0 ? "+" : ""}${contribution.toFixed(1)}`;
}

function formatWeight(weight: number | undefined) {
  if (weight == null || Number.isNaN(weight)) {
    return "--";
  }

  return weight.toFixed(0);
}

function buildSubscoreCopy(
  score: SignalBreakdownScore | undefined,
  disposition: ReturnType<typeof getDisposition>,
) {
  if (!score) {
    return "Waiting for the next model sync to publish this pillar's weighted contribution.";
  }

  return `Current read is ${disposition.label.toLowerCase()}, contributing ${formatContribution(score.contribution)} of ${formatWeight(score.weight)} possible points to the composite bias.`;
}

export function SignalBreakdown({ componentScores }: SignalBreakdownProps) {
  const scoreByKey = new Map<string, SignalBreakdownScore>(
    componentScores.map((score) => [score.key, score]),
  );

  return (
    <section className="border-t border-white/5 pt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            Signal Breakdown
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Methodology
          </h2>
        </div>
        <p className="max-w-lg text-sm leading-6 text-zinc-500">
          Four weighted pillars roll into the composite bias. Each line shows the current disposition and its direct sub-score contribution.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PILLAR_CONFIG.map((pillar) => {
          const score = getPillarScore(scoreByKey, pillar.key);
          const disposition = getDisposition(score?.signal);

          return (
            <article key={pillar.key} className="border-t border-white/10 pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    {pillar.eyebrow}
                  </p>
                  <h3 className="mt-2 text-base font-semibold tracking-tight text-white">
                    {pillar.symbol}
                  </h3>
                </div>

                <div className="text-right">
                  <p className={`font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] ${disposition.tone}`}>
                    {disposition.label}
                  </p>
                  <p className="mt-2 font-[family:var(--font-data)] text-lg font-semibold text-white">
                    {formatContribution(score?.contribution)}
                  </p>
                  <p className="mt-1 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
                    of {formatWeight(score?.weight)} pts
                  </p>
                </div>
              </div>

              <p className="mt-4 text-sm leading-6 text-zinc-300">
                {buildSubscoreCopy(score, disposition)}
              </p>

              <p className="mt-3 text-xs leading-5 text-zinc-500">
                {pillar.methodology}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}