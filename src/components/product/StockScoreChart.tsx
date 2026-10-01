import { formatScore, formatTradeDate } from "@/lib/public-proof/format";

import type { ScoreMark } from "./ScoreStrip";

const WIDTH = 240;
const HEIGHT = 96;

function chartPoint(index: number, score: number, count: number) {
  const x = count === 1 ? WIDTH / 2 : (index / (count - 1)) * WIDTH;
  const clamped = Math.max(-100, Math.min(100, Math.round(score)));
  const y = ((100 - clamped) / 200) * HEIGHT;

  return { x, y, score: clamped };
}

export function StockScoreChart({ marks }: { marks: ScoreMark[] }) {
  if (marks.length === 0) {
    return null;
  }

  const points = marks.map((mark, index) => chartPoint(index, mark.score, marks.length));
  const path = points.map((point) => `${point.x},${point.y}`).join(" ");
  const latest = points[points.length - 1];

  return (
    <figure className="min-w-0">
      <figcaption>
        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
          Stock score
        </p>
        <p className="mt-1 text-xs text-zinc-500">−100 to +100. Not a price.</p>
      </figcaption>
      <div className="mt-3 flex items-stretch gap-2">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-24 min-w-0 flex-1"
          role="img"
          aria-label={`Stock score path for ${marks.length} stored sessions. Latest ${formatScore(latest.score)} on ${formatTradeDate(marks[marks.length - 1].tradeDate)}. Not a price.`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="homepage-stock-score-scale" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" />
              <stop offset="50%" stopColor="#71717a" />
              <stop offset="100%" stopColor="#f43f5e" />
            </linearGradient>
          </defs>
          <rect width={WIDTH} height={HEIGHT} fill="url(#homepage-stock-score-scale)" opacity="0.45" />
          <line x1="0" y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
          <polyline fill="none" stroke="#ffffff" strokeWidth="1.75" points={path} />
          <circle cx={latest.x} cy={latest.y} r="2.5" fill="#ffffff" />
        </svg>
        <div className="flex h-24 flex-col justify-between font-[family:var(--font-data)] text-[10px] text-zinc-500">
          <span>+100</span>
          <span>0</span>
          <span>−100</span>
        </div>
      </div>
    </figure>
  );
}
