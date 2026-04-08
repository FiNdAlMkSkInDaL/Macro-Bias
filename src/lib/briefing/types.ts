import type { HistoricalAnalogsPayload } from "@/lib/market-data/derive-historical-analogs";
import type { BiasLabel } from "@/lib/macro-bias/types";

export type StoredBiasSnapshot = {
  trade_date: string;
  score: number;
  bias_label: BiasLabel;
  component_scores: unknown;
  model_version: string | null;
  engine_inputs: unknown;
  technical_indicators: unknown;
};

export type HistoricalAnalogSnapshot = Pick<
  StoredBiasSnapshot,
  "trade_date" | "score" | "bias_label"
>;

export type SnapshotSummary = Pick<StoredBiasSnapshot, "trade_date" | "score" | "bias_label">;

export type DailyBriefingAnalogMatch = {
  tradeDate: string;
  nextSessionDate: string;
  score: number | null;
  biasLabel: string | null;
  matchConfidence: number;
  intradayNet: number | null;
  overnightGap: number | null;
  sessionRange: number | null;
};

export type DailyBriefingNewsStatus = "available" | "unavailable";

export type DailyBriefingNewsResult = {
  disclaimer: string | null;
  headlines: string[];
  status: DailyBriefingNewsStatus;
  summary: string;
};

export type DailyBriefingQuantContext = {
  analogReference: string | null;
  analogs: DailyBriefingAnalogMatch[];
  historicalAnalogs: HistoricalAnalogsPayload | null;
  label: BiasLabel;
  score: number;
  tradeDate: string;
};

export type DailyBriefingGenerationMethod = "anthropic" | "fallback";

export type DailyBriefingResult = {
  generatedBy: DailyBriefingGenerationMethod;
  isOverrideActive: boolean;
  model: string;
  news: DailyBriefingNewsResult;
  newsletterCopy: string;
  quant: DailyBriefingQuantContext;
  warnings: string[];
};

export type PersistDailyBriefingInput = {
  briefing: DailyBriefingResult;
  briefingDate: string;
};