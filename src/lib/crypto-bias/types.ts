import type {
  CRYPTO_ANALOG_MODEL_SETTINGS,
  CRYPTO_TRACKED_TICKERS,
} from "./constants";

export type CryptoTrackedTicker = (typeof CRYPTO_TRACKED_TICKERS)[number];

export type CryptoSupplementalTicker = "GLD" | "DX-Y.NYB" | "TLT";

export type CryptoAnalogFeatureKey =
  | "btcRsi"
  | "ethBtcRatio"
  | "btcGldRatio"
  | "dxyMomentum"
  | "btcRealizedVol"
  | "tltMomentum";

export type BiasLabel =
  | "EXTREME_RISK_OFF"
  | "RISK_OFF"
  | "NEUTRAL"
  | "RISK_ON"
  | "EXTREME_RISK_ON";

export type CryptoDailyPriceInsert = {
  ticker: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjusted_close: number;
  volume: number;
  source: string;
};

export type CryptoTickerChangeSnapshot = {
  ticker: CryptoTrackedTicker;
  tradeDate: string;
  close: number;
  previousClose: number;
  percentChange: number;
};

export type CryptoTickerChangeMap = Record<CryptoTrackedTicker, CryptoTickerChangeSnapshot>;

export type CryptoAnalogStateVector = Record<CryptoAnalogFeatureKey, number>;

export type CryptoHistoricalAnalogVector = {
  tradeDate: string;
  vector: CryptoAnalogStateVector;
  btcForward1DayReturn: number;
  btcForward3DayReturn: number;
};

export type CryptoHistoricalAnalogMatch = {
  distance: number;
  btcForward1DayReturn: number;
  btcForward3DayReturn: number;
  tradeDate: string;
};

export type CryptoExpandedDailyBiasData = {
  btc14DayRsi?: number;
  ethBtcRatio?: number;
  btcGldRatio?: number;
  dxyMomentum?: number;
  btcRealizedVol?: number;
  tltMomentum?: number;
  historicalAnalogVectors?: CryptoHistoricalAnalogVector[];
};

export type CryptoDailyBiasInput = {
  tradeDate: string;
  expandedData?: CryptoExpandedDailyBiasData;
  tickerChanges: CryptoTickerChangeMap;
};

export type CryptoBiasComponentResult = {
  analogDates?: string[];
  analogMatches?: CryptoHistoricalAnalogMatch[];
  averageForward1DayReturn?: number;
  averageForward3DayReturn?: number;
  bearishHitRate1Day?: number;
  bearishHitRate3Day?: number;
  pillar?: string;
  key: string;
  weight: number;
  signal: number;
  contribution: number;
  summary: string;
};

export type CryptoDailyBiasResult = {
  tradeDate: string;
  score: number;
  label: BiasLabel;
  componentScores: CryptoBiasComponentResult[];
  tickerChanges: CryptoTickerChangeMap;
};

export type CryptoBiasScoreRow = {
  id: string;
  trade_date: string;
  score: number;
  bias_label: BiasLabel;
  component_scores: CryptoBiasComponentResult[];
  ticker_changes: CryptoTickerChangeMap;
  engine_inputs: Record<string, unknown> | null;
  technical_indicators: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};
