/** Shared tradable-signal types for stocks and crypto regime models. */

export type PositionPermission = "LONG" | "SHORT" | "FLAT" | "NO_TRADE";

export type ReliabilityGrade = "A" | "B" | "C" | "D" | "F";

export type TradableSignal = {
  /** Directional permission for the next session. */
  position: PositionPermission;
  /** Suggested risk size in [0, 1]. Zero when FLAT or NO_TRADE. */
  size: number;
  /** Analog-quality grade. F means do not trade on this signal. */
  reliability: ReliabilityGrade;
  /** Fraction of K neighbors whose blended forward return shares the score sign. */
  neighborAgreement: number;
  /** Mean decayed distance under the market's configured distance metric. */
  meanNeighborDistance: number;
  /** Distance quality in (0, 1], higher = tighter cluster. */
  distanceQuality: number;
  /** True when the model refuses a directional trade. */
  noTrade: boolean;
  /** Short plain-English reason for the permission. */
  reason: string;
  /** Daily reading and independently processed trade decision. Older rows may lack this context. */
  scoreContext?: {
    rawScore: number;
    tradeScore?: number;
    semantics?: 'daily_reading_v1';
    sourceTradeDate?: string;
    suppressedBy: Array<'low_variation' | 'monday' | 'overnight_conflict'>;
    filters?: Array<{ code: 'low_variation' | 'large_move_fade' | 'overnight_amplifier' | 'overnight_conflict' | 'monday_source'; before: number; after: number }>;
    vix?: { indexLevel: number; percentile: number; thresholdIndexPoints: number; neighborCount: number };
  };
};

export type StrategyRules = {
  /** |score| must exceed this to leave FLAT (default 20). */
  scoreThreshold: number;
  /** Friction in basis points applied on each position change in backtests. */
  frictionBps: number;
  /** Mean neighbor distance above this forces NO_TRADE. */
  maxMeanNeighborDistance: number;
  /** Neighbor agreement below this forces NO_TRADE when |score| is non-trivial. */
  minNeighborAgreement: number;
};
