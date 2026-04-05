interface BiasGaugeProps {
  biasScore: number;
}

const MIN_SCORE = -100;
const MAX_SCORE = 100;
const ZERO_MARK_POSITION = 50;
const NEGATIVE_THRESHOLD_POSITION = 35;
const POSITIVE_THRESHOLD_POSITION = 65;

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
    <section className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[164px_minmax(0,1fr)] lg:items-end">
        <div>
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            Bias Gauge
          </p>
          <div className="mt-3 flex items-end gap-3">
            <p className={`font-[family:var(--font-data)] text-6xl font-semibold leading-none ${tone.score}`}>
              {formatScore(normalizedScore)}
            </p>
            <span className={`pb-1 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] ${tone.label}`}>
              {regime}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm leading-6 text-zinc-400">{tone.summary}</p>

          <div className="relative pt-4">
            <div className="relative h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="grid h-full grid-cols-3">
                <div className="bg-rose-500/85" />
                <div className="bg-zinc-500" />
                <div className="bg-emerald-500/85" />
              </div>

              <div
                className="absolute inset-y-0 w-px bg-black/70"
                style={{ left: `${ZERO_MARK_POSITION}%` }}
              />
              <div
                className="absolute inset-y-0 w-px bg-black/35"
                style={{ left: `${NEGATIVE_THRESHOLD_POSITION}%` }}
              />
              <div
                className="absolute inset-y-0 w-px bg-black/35"
                style={{ left: `${POSITIVE_THRESHOLD_POSITION}%` }}
              />
            </div>

            <div
              className="pointer-events-none absolute -top-1 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${indicatorPosition}%` }}
            >
              <div className="h-0 w-0 border-x-[5px] border-x-transparent border-b-[7px] border-b-white" />
              <div className="h-7 w-px bg-white" />
            </div>
          </div>

          <div className="flex items-center justify-between font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
            <span>-100</span>
            <span>0</span>
            <span>+100</span>
          </div>
        </div>
      </div>
    </section>
  );
}