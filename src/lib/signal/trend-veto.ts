/**
 * Hard ensemble veto: analog permission must not fight a clear trend/vol state.
 * Returns true if the directional lean should be cancelled (force FLAT/NO_TRADE).
 */

export type TrendVetoInput = {
  /** Proposed position from analog score. */
  position: "LONG" | "SHORT" | "FLAT" | "NO_TRADE";
  /**
   * Trend state: +1 above slow trend, -1 below, 0 mixed.
   * For stocks: SPY close vs SMA20. For crypto: BTC vs SMA20.
   */
  trendSign: -1 | 0 | 1;
  /**
   * VIX or realized-vol percentile 0–100 (higher = more stress).
   * Optional; when missing, only trend is used.
   */
  volPercentile?: number | null;
  /** Stress threshold for vol percentile (default 75). */
  volStressThreshold?: number;
};

/**
 * LONG needs non-negative trend (not clearly broken).
 * SHORT needs non-positive trend (not clearly rising).
 * Elevated vol does not alone veto, but LONG into vol stress + downtrend is vetoed harder
 * (already covered by trend). Vol stress + LONG with flat trend → veto.
 */
export function shouldVetoDirectionalLean(input: TrendVetoInput): boolean {
  const { position, trendSign } = input;
  if (position !== "LONG" && position !== "SHORT") {
    return false;
  }

  const vol = input.volPercentile;
  const stress = input.volStressThreshold ?? 75;
  const volStressed = vol != null && Number.isFinite(vol) && vol >= stress;

  if (position === "LONG") {
    if (trendSign < 0) return true;
    if (trendSign === 0 && volStressed) return true;
    return false;
  }

  // SHORT
  if (trendSign > 0) return true;
  if (trendSign === 0 && volStressed) return true;
  return false;
}

export function trendSignFromCloseVsSma(close: number, sma: number | null | undefined): -1 | 0 | 1 {
  if (sma == null || !Number.isFinite(sma) || sma <= 0 || !Number.isFinite(close)) {
    return 0;
  }
  const pct = ((close - sma) / sma) * 100;
  if (pct >= 0.35) return 1;
  if (pct <= -0.35) return -1;
  return 0;
}
