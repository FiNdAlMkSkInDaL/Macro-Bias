interface BiasGaugeProps {
  biasScore: number;
}

const MIN_SCORE = -100;
const MAX_SCORE = 100;
const CENTER_X = 120;
const CENTER_Y = 120;
const RADIUS = 88;

const scaleMarks = [-100, -30, 0, 30, 100] as const;

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
      badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
      accent: "#22c55e",
      score: "text-emerald-300",
      summary:
        "Cross-asset participation is favoring growth and broad risk appetite.",
    };
  }

  if (biasScore < -30) {
    return {
      badge: "border-rose-500/30 bg-rose-500/10 text-rose-200",
      accent: "#f43f5e",
      score: "text-rose-300",
      summary:
        "Defensive leadership is taking over as traders rotate away from cyclicals.",
    };
  }

  return {
    badge: "border-slate-600 bg-slate-800/80 text-slate-200",
    accent: "#94a3b8",
    score: "text-slate-200",
    summary:
      "The tape is mixed, with no clean macro confirmation from the core rotation basket.",
  };
}

function scoreToAngle(biasScore: number): number {
  const normalizedScore = (clampBiasScore(biasScore) - MIN_SCORE) / (MAX_SCORE - MIN_SCORE);
  return 180 - normalizedScore * 180;
}

function polarToCartesian(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;

  return {
    x: CENTER_X + radius * Math.cos(radians),
    y: CENTER_Y - radius * Math.sin(radians),
  };
}

function describeArc(startScore: number, endScore: number, radius: number): string {
  const start = polarToCartesian(scoreToAngle(startScore), radius);
  const end = polarToCartesian(scoreToAngle(endScore), radius);

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`;
}

function formatScore(biasScore: number): string {
  const roundedScore = Math.round(biasScore);

  return `${roundedScore > 0 ? "+" : ""}${roundedScore}`;
}

function formatMark(mark: number): string {
  return `${mark > 0 ? "+" : ""}${mark}`;
}

export function BiasGauge({ biasScore }: BiasGaugeProps) {
  const normalizedScore = clampBiasScore(biasScore);
  const regime = getBiasRegime(normalizedScore);
  const tone = getGaugeTone(normalizedScore);
  const needlePoint = polarToCartesian(scoreToAngle(normalizedScore), RADIUS - 24);

  return (
    <section className="rounded-[28px] border border-slate-800/80 bg-slate-950/80 p-6 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-sm sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
            Bias Gauge
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
            Macro pressure reading
          </h2>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.28em] ${tone.badge}`}
        >
          {regime}
        </span>
      </div>

      <div className="mt-8">
        <svg
          viewBox="0 0 240 145"
          className="w-full"
          role="img"
          aria-label={`Macro bias gauge showing a ${formatScore(normalizedScore)} reading`}
        >
          <path d={describeArc(-100, -30, RADIUS)} fill="none" stroke="#f43f5e" strokeWidth="14" strokeLinecap="round" />
          <path d={describeArc(-30, 30, RADIUS)} fill="none" stroke="#94a3b8" strokeWidth="14" strokeLinecap="round" />
          <path d={describeArc(30, 100, RADIUS)} fill="none" stroke="#22c55e" strokeWidth="14" strokeLinecap="round" />

          {scaleMarks.map((mark) => {
            const outerTick = polarToCartesian(scoreToAngle(mark), RADIUS + 10);
            const innerTick = polarToCartesian(scoreToAngle(mark), RADIUS - 4);
            const labelPoint = polarToCartesian(scoreToAngle(mark), RADIUS + 26);

            return (
              <g key={mark}>
                <line
                  x1={innerTick.x}
                  y1={innerTick.y}
                  x2={outerTick.x}
                  y2={outerTick.y}
                  stroke="#475569"
                  strokeWidth="2"
                />
                <text
                  x={labelPoint.x}
                  y={labelPoint.y}
                  fill="#94a3b8"
                  fontSize="10"
                  textAnchor={mark === -100 ? "start" : mark === 100 ? "end" : "middle"}
                >
                  {formatMark(mark)}
                </text>
              </g>
            );
          })}

          <line
            x1={CENTER_X}
            y1={CENTER_Y}
            x2={needlePoint.x}
            y2={needlePoint.y}
            stroke={tone.accent}
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle cx={CENTER_X} cy={CENTER_Y} r="10" fill="#0f172a" stroke={tone.accent} strokeWidth="4" />
          <circle cx={CENTER_X} cy={CENTER_Y} r="4" fill={tone.accent} />
        </svg>
      </div>

      <div className="mt-4 flex flex-col gap-4 border-t border-slate-800 pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">
            Bias Score
          </p>
          <p className={`mt-2 font-mono text-5xl font-semibold ${tone.score}`}>
            {formatScore(normalizedScore)}
          </p>
        </div>
        <p className="max-w-md text-sm leading-6 text-slate-300">
          {tone.summary}
        </p>
      </div>
    </section>
  );
}