import type { BIAS_SIGNAL_WEIGHTS, TRACKED_TICKERS } from "./constants";

export type TrackedTicker = (typeof TRACKED_TICKERS)[number];

export type BiasComponentKey = keyof typeof BIAS_SIGNAL_WEIGHTS;

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
};

export type TickerChangeMap = Record<TrackedTicker, TickerChangeSnapshot>;

export type DailyBiasInput = {
  tradeDate: string;
  tickerChanges: TickerChangeMap;
};

export type BiasComponentResult = {
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
};

export type MacroBiasScoreRow = {
  id: string;
  trade_date: string;
  score: number;
  bias_label: BiasLabel;
  component_scores: BiasComponentResult[];
  ticker_changes: TickerChangeMap;
  created_at: string;
  updated_at: string;
};