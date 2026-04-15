export const CRYPTO_TRACKED_TICKERS = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;

export const CRYPTO_ANALOG_MODEL_SETTINGS = {
  blendedReturnScale: 3.5,
  minimumHistoricalAnalogs: 20,
  nearestNeighborCount: 5,
  temporalDecayLambda: 0.0015,
  dxyMomentumLookbackSessions: 5,
  tltMomentumLookbackSessions: 5,
  btcRealizedVolWindow: 20,
} as const;
