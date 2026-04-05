import {
  BIAS_SIGNAL_WEIGHTS,
  SIGNAL_NORMALIZATION_THRESHOLDS,
} from "./constants";
import type {
  BiasComponentKey,
  BiasComponentResult,
  BiasLabel,
  BiasPillarKey,
  DailyBiasInput,
  DailyBiasResult,
  SupplementalTickerSnapshot,
  TickerChangeSnapshot,
} from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function normalizeSignal(rawValue: number, threshold: number) {
  if (threshold <= 0) {
    throw new Error("Signal threshold must be greater than zero.");
  }

  return clamp(rawValue / threshold, -1, 1);
}

function interpolate(
  value: number,
  inputMin: number,
  inputMax: number,
  outputMin: number,
  outputMax: number,
) {
  if (inputMin === inputMax) {
    throw new Error("Interpolation input range cannot be zero.");
  }

  const normalizedValue = clamp((value - inputMin) / (inputMax - inputMin), 0, 1);

  return outputMin + normalizedValue * (outputMax - outputMin);
}

function formatSignedPercent(value: number, decimals = 2) {
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

function getBiasLabel(score: number): BiasLabel {
  if (score <= -60) {
    return "EXTREME_RISK_OFF";
  }

  if (score < -20) {
    return "RISK_OFF";
  }

  if (score <= 20) {
    return "NEUTRAL";
  }

  if (score < 60) {
    return "RISK_ON";
  }

  return "EXTREME_RISK_ON";
}

function buildComponent(
  key: BiasComponentKey,
  pillar: BiasPillarKey,
  signal: number,
  summary: string,
): BiasComponentResult {
  const weight = BIAS_SIGNAL_WEIGHTS[key];
  const roundedSignal = roundTo(signal, 4);

  return {
    pillar,
    contribution: roundTo(roundedSignal * weight),
    key,
    signal: roundedSignal,
    summary,
    weight,
  };
}

function buildMissingDataSummary(metricName: string) {
  return `${metricName} was unavailable, so this component stayed neutral at 0.`;
}

// Trend signal math:
// 1. Compute SPY distance from the 20-day SMA as (spot / sma20) - 1.
// 2. Normalize that distance over a +/-3% band.
// 3. Anything above +3% fully expresses +1; anything below -3% fully expresses -1.
function scoreSpyTrendVsSma(spot: TickerChangeSnapshot, spy20DaySma?: number) {
  if (!spy20DaySma || spy20DaySma <= 0) {
    return {
      signal: 0,
      summary: buildMissingDataSummary("SPY 20-day SMA"),
    };
  }

  const distanceFromSma = (spot.close - spy20DaySma) / spy20DaySma;
  const noiseFilteredDistance = Math.abs(distanceFromSma) < 0.0025 ? 0 : distanceFromSma;
  const signal = normalizeSignal(
    noiseFilteredDistance,
    SIGNAL_NORMALIZATION_THRESHOLDS.spyDistanceFromSma,
  );

  const relationshipCopy =
    distanceFromSma >= 0
      ? `SPY is ${formatSignedPercent(distanceFromSma * 100)} above its 20-day SMA`
      : `SPY is ${formatSignedPercent(distanceFromSma * 100)} below its 20-day SMA`;

  return {
    signal,
    summary: `${relationshipCopy}; the model normalizes the trend distance over a +/-3.00% band.`,
  };
}

// RSI is treated as a regime curve rather than a simple bullish/bearish threshold.
// The strongest positive zone is 60-70, where momentum is strong but not yet crowded.
// Above 70 the score decays because overbought conditions often mean positioning is stretched.
// Below 30 the score is strongly negative because persistent oversold readings usually reflect stress.
function scoreSpyRsiRegime(spy14DayRsi?: number) {
  if (spy14DayRsi == null || Number.isNaN(spy14DayRsi)) {
    return {
      signal: 0,
      summary: buildMissingDataSummary("SPY 14-day RSI"),
    };
  }

  const cappedRsi = clamp(spy14DayRsi, 0, 100);
  let signal = 0;
  let regimeCopy = "RSI is neutral.";

  if (cappedRsi < 30) {
    signal = interpolate(cappedRsi, 0, 30, -1, -0.85);
    regimeCopy = "RSI is deeply oversold, which the model treats as clear risk-off behavior.";
  } else if (cappedRsi < 45) {
    signal = interpolate(cappedRsi, 30, 45, -0.85, -0.15);
    regimeCopy = "RSI is below equilibrium, pointing to weak momentum.";
  } else if (cappedRsi <= 60) {
    signal = interpolate(cappedRsi, 45, 60, -0.15, 0.65);
    regimeCopy = "RSI is improving through the neutral zone, which is constructive.";
  } else if (cappedRsi <= 70) {
    signal = interpolate(cappedRsi, 60, 70, 0.65, 1);
    regimeCopy = "RSI is strong without being crowded, which is the best momentum regime.";
  } else {
    signal = interpolate(cappedRsi, 70, 85, 1, -0.35);
    regimeCopy = "RSI is overbought, so the model applies an exhaustion penalty instead of blindly rewarding it.";
  }

  return {
    signal,
    summary: `SPY 14-day RSI is ${roundTo(cappedRsi)}. ${regimeCopy}`,
  };
}

// Credit is modeled as a blended spread signal.
// Relative outperformance between HYG and TLT does most of the work because it captures
// whether investors prefer lower-quality credit or safe duration.
// A smaller absolute HYG term is included so a weak junk-bond tape cannot look healthy
// solely because Treasuries happened to be even weaker that day.
function scoreHygVsTlt(
  hyg?: SupplementalTickerSnapshot<"HYG">,
  tlt?: TickerChangeSnapshot,
) {
  if (!hyg || !tlt) {
    return {
      signal: 0,
      summary: buildMissingDataSummary("HYG or TLT pricing"),
    };
  }

  const spread = hyg.percentChange - tlt.percentChange;
  const spreadSignal = normalizeSignal(
    spread,
    SIGNAL_NORMALIZATION_THRESHOLDS.hygVsTltSpread,
  );
  const absoluteHygSignal = normalizeSignal(
    hyg.percentChange,
    SIGNAL_NORMALIZATION_THRESHOLDS.hygAbsoluteMove,
  );
  const signal = clamp(spreadSignal * 0.75 + absoluteHygSignal * 0.25, -1, 1);

  return {
    signal,
    summary:
      `HYG vs TLT spread is ${formatSignedPercent(spread)} ` +
      `(HYG ${formatSignedPercent(hyg.percentChange)} vs TLT ${formatSignedPercent(tlt.percentChange)}); ` +
      `the model blends 75% spread leadership with 25% absolute HYG tone.`,
  };
}

// Copper vs gold is the growth-vs-safety industrial complex.
// The score is dominated by copper's relative performance versus gold, then modestly adjusted
// by copper's own absolute return so severe commodity weakness cannot hide behind a gold selloff.
function scoreCperVsGld(
  cper?: SupplementalTickerSnapshot<"CPER">,
  gld?: TickerChangeSnapshot,
) {
  if (!cper || !gld) {
    return {
      signal: 0,
      summary: buildMissingDataSummary("CPER or GLD pricing"),
    };
  }

  const spread = cper.percentChange - gld.percentChange;
  const spreadSignal = normalizeSignal(
    spread,
    SIGNAL_NORMALIZATION_THRESHOLDS.cperVsGldSpread,
  );
  const absoluteCopperSignal = normalizeSignal(
    cper.percentChange,
    SIGNAL_NORMALIZATION_THRESHOLDS.cperAbsoluteMove,
  );
  const signal = clamp(spreadSignal * 0.8 + absoluteCopperSignal * 0.2, -1, 1);

  return {
    signal,
    summary:
      `CPER vs GLD spread is ${formatSignedPercent(spread)} ` +
      `(CPER ${formatSignedPercent(cper.percentChange)} vs GLD ${formatSignedPercent(gld.percentChange)}); ` +
      `the model blends 80% relative growth leadership with 20% absolute copper strength.`,
  };
}

// VIX level is the dominant volatility input.
// The curve intentionally becomes negative as soon as VIX moves above 20 because that usually
// marks a transition from calm positioning to active hedging and de-risking.
function scoreVixLevelRegime(vix?: SupplementalTickerSnapshot<"^VIX">) {
  if (!vix) {
    return {
      signal: 0,
      summary: buildMissingDataSummary("VIX level"),
    };
  }

  const vixLevel = Math.max(vix.close, 0);
  let signal = 0;
  let regimeCopy = "VIX is neutral.";

  if (vixLevel <= 12) {
    signal = 1;
    regimeCopy = "VIX is extremely compressed, which is strongly risk-on.";
  } else if (vixLevel <= 15) {
    signal = interpolate(vixLevel, 12, 15, 1, 0.6);
    regimeCopy = "VIX is calm and supportive of risk appetite.";
  } else if (vixLevel <= 20) {
    signal = interpolate(vixLevel, 15, 20, 0.6, -0.35);
    regimeCopy = "VIX is rising out of the comfort zone, so the model shifts toward caution.";
  } else if (vixLevel <= 30) {
    signal = interpolate(vixLevel, 20, 30, -0.35, -1);
    regimeCopy = "VIX is elevated above 20, which is a classic risk-off regime.";
  } else {
    signal = -1;
    regimeCopy = "VIX is in a stress regime, so the signal is fully risk-off.";
  }

  return {
    signal,
    summary: `VIX closed at ${roundTo(vixLevel)}. ${regimeCopy}`,
  };
}

// The VIX change signal is intentionally small and only fine-tunes the level regime.
// Falling volatility helps the score; a fast VIX spike subtracts points even if the level
// has not yet fully entered a crisis zone.
function scoreVixTrend(vix?: SupplementalTickerSnapshot<"^VIX">) {
  if (!vix) {
    return {
      signal: 0,
      summary: buildMissingDataSummary("VIX day-over-day change"),
    };
  }

  const signal = normalizeSignal(
    -vix.percentChange,
    SIGNAL_NORMALIZATION_THRESHOLDS.vixPercentChange,
  );

  return {
    signal,
    summary:
      `VIX moved ${formatSignedPercent(vix.percentChange)} day over day; ` +
      `the model treats falling vol as supportive and rising vol as a warning signal.`,
  };
}

// Final score math:
// 1. Every component produces a normalized signal s_i in [-1, 1].
// 2. Each signal is multiplied by its configured weight w_i.
// 3. The weighted contributions are summed and rounded.
// Because the weights sum to 100, the total score naturally fits a -100 to 100 range.
export function calculateDailyBias(expandedData: DailyBiasInput): DailyBiasResult {
  const { tickerChanges } = expandedData;
  const supplementalData = expandedData.expandedData;

  const spyTrendVsSma = scoreSpyTrendVsSma(
    tickerChanges.SPY,
    supplementalData?.spy20DaySma,
  );
  const spyRsiRegime = scoreSpyRsiRegime(supplementalData?.spy14DayRsi);
  const hygVsTltSpread = scoreHygVsTlt(supplementalData?.hyg, tickerChanges.TLT);
  const cperVsGldSpread = scoreCperVsGld(supplementalData?.cper, tickerChanges.GLD);
  const vixLevelRegime = scoreVixLevelRegime(supplementalData?.vix);
  const vixTrend = scoreVixTrend(supplementalData?.vix);

  const componentScores = [
    buildComponent(
      "spyTrendVsSma",
      "trendAndMomentum",
      spyTrendVsSma.signal,
      spyTrendVsSma.summary,
    ),
    buildComponent(
      "spyRsiRegime",
      "trendAndMomentum",
      spyRsiRegime.signal,
      spyRsiRegime.summary,
    ),
    buildComponent(
      "hygVsTltSpread",
      "creditAndRiskSpreads",
      hygVsTltSpread.signal,
      hygVsTltSpread.summary,
    ),
    buildComponent(
      "cperVsGldSpread",
      "creditAndRiskSpreads",
      cperVsGldSpread.signal,
      cperVsGldSpread.summary,
    ),
    buildComponent(
      "vixLevelRegime",
      "volatility",
      vixLevelRegime.signal,
      vixLevelRegime.summary,
    ),
    buildComponent("vixTrend", "volatility", vixTrend.signal, vixTrend.summary),
  ];

  const score = clamp(
    Math.round(
      componentScores.reduce((total, component) => total + component.contribution, 0),
    ),
    -100,
    100,
  );

  return {
    tradeDate: expandedData.tradeDate,
    score,
    label: getBiasLabel(score),
    componentScores,
    tickerChanges,
  };
}