/**
 * Quality metrics for next-session score evaluation.
 * Used by calibration and live eval so "better" is always the same definition.
 */

export type QualityDay = {
  /** Session return realized after the lagged score (%). */
  sessionReturnPct: number;
  position: "LONG" | "SHORT" | "CASH";
  score: number;
  reliability?: string;
  directionCorrect: boolean | null;
};

export type QualityReport = {
  sessions: number;
  directionalSessions: number;
  cashRate: number;
  hitRate: number | null;
  avgReturnLong: number | null;
  avgReturnShort: number | null;
  edgeSpread: number | null;
  /** Mean strategy session return when positioned (not cash). */
  avgStrategyWhenIn: number | null;
  /** Hit rate on A+B reliability only (if present). */
  highRelHitRate: number | null;
  highRelSessions: number;
  /** Simple objective for ranking configs (higher is better). */
  objective: number;
};

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Primary objective for calibration:
 * edgeSpread (long avg - short avg of underlying) + 0.5 * hitRate bonus
 * - small penalty for extreme cash rates (always flat is useless)
 * - bonus for high-reliability hit rate when sample exists
 */
export function scoreConfigObjective(report: QualityReport): number {
  const edge = report.edgeSpread ?? 0;
  const hit = (report.hitRate ?? 50) / 100;
  const highRel = report.highRelHitRate != null ? (report.highRelHitRate / 100) * 0.15 : 0;
  // Prefer some activity: cash rate between 15% and 70% is healthy
  const cash = report.cashRate;
  const cashPenalty =
    cash < 0.1 ? 0.15 : cash > 0.85 ? 0.25 : cash > 0.7 ? 0.05 : 0;
  // When in market, want positive avg strategy return
  const whenIn = report.avgStrategyWhenIn ?? 0;

  return edge * 2 + (hit - 0.5) * 1.5 + whenIn * 3 + highRel - cashPenalty;
}

export function computeQualityReport(days: QualityDay[]): QualityReport {
  if (days.length === 0) {
    return {
      sessions: 0,
      directionalSessions: 0,
      cashRate: 1,
      hitRate: null,
      avgReturnLong: null,
      avgReturnShort: null,
      edgeSpread: null,
      avgStrategyWhenIn: null,
      highRelHitRate: null,
      highRelSessions: 0,
      objective: -999,
    };
  }

  const longDays = days.filter((d) => d.position === "LONG");
  const shortDays = days.filter((d) => d.position === "SHORT");
  const cashDays = days.filter((d) => d.position === "CASH");
  const directional = days.filter((d) => d.position !== "CASH" && d.directionCorrect !== null);

  const avgReturnLong = avg(longDays.map((d) => d.sessionReturnPct));
  const avgReturnShort = avg(shortDays.map((d) => d.sessionReturnPct));

  const strategyWhenIn = days
    .filter((d) => d.position !== "CASH")
    .map((d) =>
      d.position === "LONG" ? d.sessionReturnPct : d.position === "SHORT" ? -d.sessionReturnPct : 0,
    );

  const highRel = days.filter(
    (d) =>
      (d.reliability === "A" || d.reliability === "B") &&
      d.position !== "CASH" &&
      d.directionCorrect !== null,
  );

  const report: QualityReport = {
    sessions: days.length,
    directionalSessions: directional.length,
    cashRate: cashDays.length / days.length,
    hitRate:
      directional.length > 0
        ? (directional.filter((d) => d.directionCorrect === true).length / directional.length) *
          100
        : null,
    avgReturnLong,
    avgReturnShort,
    edgeSpread:
      avgReturnLong !== null && avgReturnShort !== null
        ? avgReturnLong - avgReturnShort
        : null,
    avgStrategyWhenIn: avg(strategyWhenIn),
    highRelHitRate:
      highRel.length > 0
        ? (highRel.filter((d) => d.directionCorrect === true).length / highRel.length) * 100
        : null,
    highRelSessions: highRel.length,
    objective: 0,
  };

  report.objective = scoreConfigObjective(report);
  return report;
}

export function formatQualityReport(label: string, report: QualityReport): string {
  const fmt = (v: number | null, digits = 3) =>
    v === null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
  const pct = (v: number | null) => (v === null ? "n/a" : `${v.toFixed(1)}%`);

  return [
    `=== ${label} ===`,
    `sessions=${report.sessions}  directional=${report.directionalSessions}  cashRate=${(report.cashRate * 100).toFixed(1)}%`,
    `hitRate=${pct(report.hitRate)}  edge(L-S)=${fmt(report.edgeSpread)}%  avgWhenIn=${fmt(report.avgStrategyWhenIn)}%`,
    `avgLong=${fmt(report.avgReturnLong)}%  avgShort=${fmt(report.avgReturnShort)}%`,
    `highRelHit=${pct(report.highRelHitRate)} (n=${report.highRelSessions})  objective=${report.objective.toFixed(4)}`,
  ].join("\n");
}
