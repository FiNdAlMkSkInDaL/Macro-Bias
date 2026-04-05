import {
  BIAS_SIGNAL_WEIGHTS,
  SIGNAL_NORMALIZATION_THRESHOLDS,
} from "./constants";
import type {
  BiasComponentKey,
  BiasComponentResult,
  BiasLabel,
  DailyBiasInput,
  DailyBiasResult,
} from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeSignal(rawValue: number, threshold: number) {
  if (threshold <= 0) {
    throw new Error("Signal threshold must be greater than zero.");
  }

  return clamp(rawValue / threshold, -1, 1);
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
  signal: number,
  positiveSummary: string,
  negativeSummary: string,
): BiasComponentResult {
  const weight = BIAS_SIGNAL_WEIGHTS[key];
  const roundedSignal = Number(signal.toFixed(4));

  return {
    key,
    weight,
    signal: roundedSignal,
    contribution: Number((roundedSignal * weight).toFixed(2)),
    summary: roundedSignal >= 0 ? positiveSummary : negativeSummary,
  };
}

// This scoring function intentionally stays simple and explainable.
// Every component tracks one intuitive macro relationship:
// 1. QQQ leading SPY = growth appetite
// 2. SPY direction = broad equity tone
// 3. QQQ vs XLP = offensive vs defensive rotation
// 4. SPY vs TLT/GLD = capital moving toward or away from safety
export function calculateDailyBias(data: DailyBiasInput): DailyBiasResult {
  const { SPY, QQQ, XLP, TLT, GLD } = data.tickerChanges;

  const safeHavenAverage = (TLT.percentChange + GLD.percentChange) / 2;

  const growthLeadership = buildComponent(
    "growthLeadership",
    normalizeSignal(
      QQQ.percentChange - SPY.percentChange,
      SIGNAL_NORMALIZATION_THRESHOLDS.growthLeadership,
    ),
    "QQQ is leading SPY, which supports a risk-on read.",
    "SPY is holding up better than QQQ, which weakens growth leadership.",
  );

  const equityDirection = buildComponent(
    "equityDirection",
    normalizeSignal(SPY.percentChange, SIGNAL_NORMALIZATION_THRESHOLDS.equityDirection),
    "SPY is up on the day, which supports a constructive equity backdrop.",
    "SPY is down on the day, which leans risk-off.",
  );

  const defensiveRotation = buildComponent(
    "defensiveRotation",
    normalizeSignal(
      QQQ.percentChange - XLP.percentChange,
      SIGNAL_NORMALIZATION_THRESHOLDS.defensiveRotation,
    ),
    "QQQ is outperforming XLP, showing offensive participation.",
    "XLP is outperforming QQQ, showing defensive rotation.",
  );

  const flightToSafety = buildComponent(
    "flightToSafety",
    normalizeSignal(
      SPY.percentChange - safeHavenAverage,
      SIGNAL_NORMALIZATION_THRESHOLDS.flightToSafety,
    ),
    "Equities are outperforming Treasuries and gold, which supports risk appetite.",
    "Treasuries and gold are outperforming equities, which signals a flight to safety.",
  );

  const componentScores = [
    growthLeadership,
    equityDirection,
    defensiveRotation,
    flightToSafety,
  ];

  const score = clamp(
    Math.round(
      componentScores.reduce((total, component) => total + component.contribution, 0),
    ),
    -100,
    100,
  );

  return {
    tradeDate: data.tradeDate,
    score,
    label: getBiasLabel(score),
    componentScores,
    tickerChanges: data.tickerChanges,
  };
}