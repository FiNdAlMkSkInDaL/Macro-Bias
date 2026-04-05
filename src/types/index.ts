export const CORE_ASSET_TICKERS = ["SPY", "QQQ", "XLP", "TLT", "GLD"] as const;

export type AssetTicker = (typeof CORE_ASSET_TICKERS)[number];

export interface BiasAsset {
  ticker: AssetTicker;
  currentPrice: number;
  dailyChangePercent: number;
}

export interface BiasData {
  biasScore: number;
  assets: BiasAsset[];
}