import { formatScore, formatTradeDate } from "@/lib/public-proof/format";

export type ScoreMark = {
  tradeDate: string;
  score: number;
};

export function scoreMoveLine(prior: ScoreMark, today: ScoreMark) {
  const priorScore = Math.round(prior.score);
  const todayScore = Math.round(today.score);
  const direction = todayScore > priorScore ? "Heated" : todayScore < priorScore ? "Cooled" : "Unchanged";

  return `Yesterday ${formatScore(priorScore)}. Today ${formatScore(todayScore)}. ${direction}.`;
}

export function ScoreStrip({ marks, today }: { marks: ScoreMark[]; today: string }) {
  if (marks.length === 0) {
    return null;
  }

  return (
    <div
      className="relative mt-6 flex h-14 items-center gap-1"
      role="img"
      aria-label="Stored stock scores, one mark per trade date. Today is highlighted."
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/10" />
      {marks.map((mark) => {
        const rounded = Math.round(mark.score);
        const magnitude = Math.min(1, Math.abs(rounded) / 100);
        const isToday = mark.tradeDate === today;
        const height = Math.max(isToday ? 12 : 4, Math.round(magnitude * 24));

        return (
          <span key={mark.tradeDate} className="relative flex h-full min-w-0 flex-1 items-center justify-center">
            <span
              className={`block w-full max-w-2 ${isToday ? "bg-white" : "bg-zinc-600"}`}
              style={{
                height,
                transform: rounded >= 0 ? `translateY(-${height / 2}px)` : `translateY(${height / 2}px)`,
              }}
              title={`${formatTradeDate(mark.tradeDate)} ${formatScore(rounded)}`}
            >
              <span className="sr-only">
                {formatTradeDate(mark.tradeDate)} {formatScore(rounded)}
                {isToday ? ", today" : ""}
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
