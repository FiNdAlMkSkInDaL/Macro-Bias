export type {
  PositionPermission,
  ReliabilityGrade,
  StrategyRules,
  TradableSignal,
} from "./types";

export {
  CRYPTO_STRATEGY_RULES,
  STOCKS_STRATEGY_RULES,
  allowsDirectionalPermission,
  buildTradableSignal,
  clamp,
  distanceQualityFromMean,
  inverseDistanceWeight,
  positionFromScore,
  positionFromSignal,
  reliabilityFromMetrics,
  roundTo,
  weightedMean,
} from "./strategy";

export type {
  AssetSessionDay,
  BuildPaperLedgerOptions,
  PaperLedgerDay,
  PaperLedgerSummary,
  PaperPosition,
  PublishedScoreDay,
} from "./paper-ledger";

export {
  buildPaperLedger,
  cryptoPaperLedgerOptions,
  stocksPaperLedgerOptions,
} from "./paper-ledger";

export {
  DEFAULT_PERCENTILE_OPTIONS,
  latestRollingPercentile,
  rollingPercentileRank,
  rollingPercentileSeries,
  stationarizeLevelFeatures,
} from "./rolling-percentile";

export type { PercentileOptions } from "./rolling-percentile";

export type {
  GradedSession,
  LiveScoreEvaluation,
  PublishedScoreForEval,
  ReliabilityBucketStats,
  SessionReturnForEval,
} from "./live-score-evaluation";

export { evaluatePublishedScores } from "./live-score-evaluation";

export {
  extractTradableSignal,
  formatPermissionLine,
  formatSignalReason,
  formatSignalSocialLine,
  isTradableSignal,
} from "./format-tradable-signal";

export {
  computeQualityReport,
  formatQualityReport,
  scoreConfigObjective,
} from "./quality-metrics";

export type { QualityDay, QualityReport } from "./quality-metrics";

export {
  shouldVetoDirectionalLean,
  trendSignFromCloseVsSma,
} from "./trend-veto";
