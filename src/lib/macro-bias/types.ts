import type {
  ANALOG_MODEL_SETTINGS,
  BIAS_PILLAR_WEIGHTS,
  BIAS_SIGNAL_WEIGHTS,
  TRACKED_TICKERS,
} from "./constants";
import type { TradableSignal } from "../signal";

export type TrackedTicker = (typeof TRACKED_TICKERS)[number];

export type BiasPillarKey = keyof typeof BIAS_PILLAR_WEIGHTS;
export type BiasComponentKey = keyof typeof BIAS_SIGNAL_WEIGHTS;

export type SupplementalTicker = "HYG" | "CPER" | "^VIX" | "USO";

/**
 * Feature keys for the analog state vector.
 * vixMomentum is the honest name for −(VIX 5-session % change).
 * It is NOT dealer gamma exposure.
 */
export type AnalogFeatureKey =
  | "spyRsi"
  | "vixMomentum"
  | "hygTltRatio"
  | "cperGldRatio"
  | "usoMomentum"
  | "vixLevel";

export type BiasLabel =
  | "EXTREME_RISK_OFF"
  | "RISK_OFF"
  | "NEUTRAL"
  | "RISK_ON"
  | "EXTREME_RISK_ON";

export type DailyPriceInsert = {
  ticker: TrackedTicker;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
  source: string;
};

export type TickerChangeSnapshot = {
  ticker: TrackedTicker;
  tradeDate: string;
  close: number;
  previousClose: number;
  percentChange: number;
  /** Session open when available (v12+ overnight veto). */
  open?: number;
};

export type TickerChangeMap = Record<TrackedTicker, TickerChangeSnapshot>;

export type SupplementalTickerSnapshot<TTicker extends SupplementalTicker = SupplementalTicker> = {
  ticker: TTicker;
  tradeDate: string;
  close: number;
  previousClose: number;
  percentChange: number;
};

export type AnalogStateVector = Record<AnalogFeatureKey, number>;

export type HistoricalAnalogVector = {
  tradeDate: string;
  vector: AnalogStateVector;
  spyForward1DayReturn: number;
  spyForward3DayReturn: number;
};

export type HistoricalAnalogMatch = {
  distance: number;
  spyForward1DayReturn: number;
  spyForward3DayReturn: number;
  tradeDate: string;
  weight?: number;
};

export type ExpandedDailyBiasData = {
  cper?: SupplementalTickerSnapshot<"CPER">;
  /** Honest name: −(VIX 5-session % change). Legacy alias: gammaExposure. */
  vixMomentum?: number;
  /** @deprecated Use vixMomentum. Kept for reading older engine_inputs payloads. */
  gammaExposure?: number;
  hyg?: SupplementalTickerSnapshot<"HYG">;
  historicalAnalogVectors?: HistoricalAnalogVector[];
  spy14DayRsi?: number;
  spy20DaySma?: number;
  uso?: SupplementalTickerSnapshot<"USO">;
  uso5DayMomentum?: number;
  vix?: SupplementalTickerSnapshot<"^VIX">;
  /**
   * Model v6+: walk-forward percentile ranks (0–100) for level features.
   * When present, calculateDailyBias uses these instead of raw closes/ratios.
   */
  hygTltRatioPercentile?: number;
  cperGldRatioPercentile?: number;
  vixLevelPercentile?: number;
};

export type DailyBiasInput = {
  tradeDate: string;
  expandedData?: ExpandedDailyBiasData;
  tickerChanges: TickerChangeMap;
};

export type BiasComponentResult = {
  analogDates?: string[];
  analogMatches?: HistoricalAnalogMatch[];
  averageForward1DayReturn?: number;
  averageForward3DayReturn?: number;
  bearishHitRate1Day?: number;
  bearishHitRate3Day?: number;
  pillar?: BiasPillarKey;
  key: BiasComponentKey;
  weight: number;
  signal: number;
  contribution: number;
  summary: string;
};

export type DailyBiasResult = {
  tradeDate: string;
  score: number;
  label: BiasLabel;
  componentScores: BiasComponentResult[];
  tickerChanges: TickerChangeMap;
  /** Model v5 tradable permission layer. */
  signal: TradableSignal;
  /** Inverse-distance-weighted blended forward expectancy used for the score. */
  blendedForwardReturn: number;
  modelVersion: string;
};

export type MacroBiasScoreRow = {
  id: string;
  trade_date: string;
  score: number;
  bias_label: BiasLabel;
  component_scores: BiasComponentResult[];
  ticker_changes: TickerChangeMap;
  engine_inputs: Record<string, unknown> | null;
  technical_indicators: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

// Silence unused-type import warnings when constants are type-only elsewhere.
export type _AnalogModelSettings = typeof ANALOG_MODEL_SETTINGS;
