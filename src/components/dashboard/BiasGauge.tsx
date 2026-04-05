interface BiasGaugeProps {
  biasScore: number;
}

const MIN_SCORE = -100;
const MAX_SCORE = 100;

function clampBiasScore(biasScore: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, biasScore));
}

function getBiasRegime(biasScore: number): "Risk-On" | "Neutral" | "Risk-Off" {
  if (biasScore > 30) {
    return "Risk-On";
  }

  if (biasScore < -30) {
    return "Risk-Off";
  }

  return "Neutral";
}

function getGaugeTone(biasScore: number) {
  if (biasScore > 30) {
    return {
      label: "text-emerald-400",
      score: "text-emerald-400",
      summary:
        "Cross-asset participation is favoring growth and broad risk appetite.",
    };
  }

  if (biasScore < -30) {
    return {
      label: "text-rose-400",
      score: "text-rose-400",
      summary:
        "Defensive leadership is taking over as traders rotate away from cyclicals.",
    };
  }

  return {
    label: "text-zinc-300",
    score: "text-white",
    summary:
      "The tape is mixed, with no clean macro confirmation from the core rotation basket.",
  };
}

function getScalePosition(biasScore: number): number {
  return ((clampBiasScore(biasScore) - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100;
}

function formatScore(biasScore: number): string {
  const roundedScore = Math.round(biasScore);

  return `${roundedScore > 0 ? "+" : ""}${roundedScore}`;
}

export function BiasGauge({ biasScore }: BiasGaugeProps) {
  const normalizedScore = clampBiasScore(biasScore);
  const regime = getBiasRegime(normalizedScore);
  const tone = getGaugeTone(normalizedScore);
  const indicatorPosition = getScalePosition(normalizedScore);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            Bias Gauge
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
            <p className={`font-[family:var(--font-data)] text-5xl font-semibold leading-none sm:text-6xl ${tone.score}`}>
              {formatScore(normalizedScore)}
            </p>
            <span className={`font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] ${tone.label}`}>
              {regime}
            </span>
          </div>
        </div>

        <p className="max-w-md text-sm leading-6 text-zinc-400">{tone.summary}</p>
      </div>

      <div className="space-y-2">
        <div className="relative w-full pt-3">
          <div
            className="relative h-1.5 w-full overflow-hidden rounded-full"
            style={{
              background:
                "linear-gradient(90deg, #f43f5e 0%, #71717a 50%, #22c55e 100%)",
            }}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/60" />
          </div>

          <div
            className="pointer-events-none absolute -top-1 h-8 -translate-x-1/2"
            style={{ left: `${indicatorPosition}%` }}
          >
            <div className="relative h-full w-px bg-white">
              <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-l border-t border-white bg-zinc-950" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
          <span>-100</span>
          <span>0</span>
          <span>+100</span>
        </div>
      </div>
    </section>
  );
}