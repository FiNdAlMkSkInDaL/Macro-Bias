import { formatScore, formatTradeDate } from "@/lib/public-proof/format";

export type ScoreMark = {
  tradeDate: string;
  score: number;
};

const NEUTRAL_BAND = 10;

function barColor(score: number, todayIsExtreme: boolean) {
  if (todayIsExtreme) {
    return "bg-white";
  }

  if (score >= NEUTRAL_BAND) {
    return "bg-green-500";
  }

  if (score <= -NEUTRAL_BAND) {
    return "bg-rose-500";
  }

  return "bg-zinc-500";
}

export function ScoreStrip({ marks, today }: { marks: ScoreMark[]; today: string }) {
  if (marks.length === 0) {
    return null;
  }

  const extremeMagnitude = marks.reduce((extreme, mark) => Math.max(extreme, Math.abs(Math.round(mark.score))), 0);

  return (
    <div
      className="relative mt-6 h-32"
      role="img"
      aria-label="Stored stock scores, one bar per trade date, drawn from zero on a -100 to +100 scale."
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/20" />
      <div className="absolute inset-0 flex items-stretch gap-1">
        {marks.map((mark) => {
          const rounded = Math.round(mark.score);
          const isToday = mark.tradeDate === today;
          const todayIsExtreme = isToday && extremeMagnitude > 0 && Math.abs(rounded) === extremeMagnitude;
          const height = (Math.abs(rounded) / 100) * 50;

          return (
            <div key={mark.tradeDate} className="relative min-w-0 flex-1" title={`${formatTradeDate(mark.tradeDate)} ${formatScore(rounded)}`}>
              <div
                className={`absolute inset-x-0 ${barColor(rounded, todayIsExtreme)} ${isToday && !todayIsExtreme ? "shadow-[0_0_0_1px_#fff]" : ""}`}
                style={{
                  height: `${height}%`,
                  ...(rounded >= 0 ? { bottom: "50%" } : { top: "50%" }),
                }}
              />
              <span className="sr-only">
                {formatTradeDate(mark.tradeDate)} {formatScore(rounded)}
                {isToday ? ", today" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
