import {
  CORE_ASSET_TICKERS,
  type AssetTicker,
  type BiasData,
} from "../../types";

export type MockBiasScenario = "risk-on" | "neutral" | "risk-off";

interface ScenarioAssetSeed {
  currentPrice: number;
  dailyChangePercent: number;
}

interface ScenarioSeed {
  biasScore: number;
  assets: Record<AssetTicker, ScenarioAssetSeed>;
}

const SCENARIO_SEEDS: Record<MockBiasScenario, ScenarioSeed> = {
  "risk-on": {
    biasScore: 72,
    assets: {
      SPY: { currentPrice: 521.84, dailyChangePercent: 1.18 },
      QQQ: { currentPrice: 446.27, dailyChangePercent: 1.86 },
      XLP: { currentPrice: 78.44, dailyChangePercent: -0.41 },
      TLT: { currentPrice: 94.62, dailyChangePercent: 0.27 },
      GLD: { currentPrice: 214.9, dailyChangePercent: -0.18 },
    },
  },
  neutral: {
    biasScore: 8,
    assets: {
      SPY: { currentPrice: 517.12, dailyChangePercent: 0.12 },
      QQQ: { currentPrice: 439.54, dailyChangePercent: -0.08 },
      XLP: { currentPrice: 78.89, dailyChangePercent: 0.22 },
      TLT: { currentPrice: 95.74, dailyChangePercent: 0.11 },
      GLD: { currentPrice: 216.43, dailyChangePercent: -0.04 },
    },
  },
  "risk-off": {
    biasScore: -68,
    assets: {
      SPY: { currentPrice: 508.31, dailyChangePercent: -1.41 },
      QQQ: { currentPrice: 431.06, dailyChangePercent: -2.09 },
      XLP: { currentPrice: 79.52, dailyChangePercent: 0.63 },
      TLT: { currentPrice: 97.63, dailyChangePercent: 1.12 },
      GLD: { currentPrice: 219.77, dailyChangePercent: 0.84 },
    },
  },
};

function clampBiasScore(biasScore: number): number {
  return Math.max(-100, Math.min(100, biasScore));
}

export function generateMockBiasData(
  scenario: MockBiasScenario = "neutral",
): BiasData {
  const scenarioSeed = SCENARIO_SEEDS[scenario];

  return {
    biasScore: clampBiasScore(scenarioSeed.biasScore),
    assets: CORE_ASSET_TICKERS.map((ticker) => ({
      ticker,
      currentPrice: scenarioSeed.assets[ticker].currentPrice,
      dailyChangePercent: scenarioSeed.assets[ticker].dailyChangePercent,
    })),
  };
}

export const MOCK_BIAS_STATES: Record<MockBiasScenario, BiasData> = {
  "risk-on": generateMockBiasData("risk-on"),
  neutral: generateMockBiasData("neutral"),
  "risk-off": generateMockBiasData("risk-off"),
};