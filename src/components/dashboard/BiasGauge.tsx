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
      badge: "text-emerald-400",
      accent: "#22c55e",
      score: "text-emerald-400",
      summary:
        "Cross-asset participation is favoring growth and broad risk appetite.",
    };
  }

  if (biasScore < -30) {
    return {
      badge: "text-rose-400",
      accent: "#f43f5e",
      score: "text-rose-400",
      summary:
        "Defensive leadership is taking over as traders rotate away from cyclicals.",
    };
  }

  return {
    badge: "text-zinc-300",
    accent: "#a1a1aa",
    score: "text-white",
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
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            Bias Gauge
          </p>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Macro pressure reading
          </h2>
        </div>
        <span className={`font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] ${tone.badge}`}>
          {regime}
        </span>
      </div>

      <div>
        <svg
          viewBox="0 0 240 145"
          className="w-full max-w-2xl"
          role="img"
          aria-label={`Macro bias gauge showing a ${formatScore(normalizedScore)} reading`}
        >
          <path d={describeArc(-100, -30, RADIUS)} fill="none" stroke="#f43f5e" strokeWidth="14" strokeLinecap="round" />
          <path d={describeArc(-30, 30, RADIUS)} fill="none" stroke="#71717a" strokeWidth="14" strokeLinecap="round" />
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
                  stroke="#3f3f46"
                  strokeWidth="2"
                />
                <text
                  x={labelPoint.x}
                  y={labelPoint.y}
                  fill="#71717a"
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
          <circle cx={CENTER_X} cy={CENTER_Y} r="10" fill="#09090b" stroke={tone.accent} strokeWidth="4" />
          <circle cx={CENTER_X} cy={CENTER_Y} r="4" fill={tone.accent} />
        </svg>
      </div>

      <div className="grid gap-8 border-t border-white/10 pt-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-end">
        <div>
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
            Bias Score
          </p>
          <p className={`mt-3 font-[family:var(--font-data)] text-5xl font-semibold ${tone.score}`}>
            {formatScore(normalizedScore)}
          </p>
        </div>
        <p className="max-w-xl text-base leading-7 text-zinc-300">
          {tone.summary}
        </p>
      </div>
    </section>
  );
}