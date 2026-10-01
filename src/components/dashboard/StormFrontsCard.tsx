import type { BiasLabel } from "@/lib/macro-bias/types";

import { STORM_FRONTS_COPY, regimeForScore, type RegimeName } from "./gauge-copy";

export type DashboardTapeAsset = {
  ticker: string;
  dailyChangePercent: number;
};

function forecastCopy(biasLabel: BiasLabel | null | undefined, regime: RegimeName): string {
  switch (biasLabel) {
    case "RISK_ON":
    case "EXTREME_RISK_ON":
      return STORM_FRONTS_COPY.riskOn;
    case "RISK_OFF":
    case "EXTREME_RISK_OFF":
      return STORM_FRONTS_COPY.riskOff;
    case "NEUTRAL":
      return STORM_FRONTS_COPY.neutral;
    default:
      if (regime === "Risk-On") {
        return STORM_FRONTS_COPY.riskOn;
      }

      if (regime === "Risk-Off") {
        return STORM_FRONTS_COPY.riskOff;
      }

      return STORM_FRONTS_COPY.neutral;
  }
}

function formatMove(value: number | null): string {
  if (value === null) {
    return "Pending";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function StormFrontsCard({
  assets,
  biasLabel,
  biasScore,
  hasScore,
  note,
}: {
  assets: DashboardTapeAsset[];
  biasLabel?: BiasLabel | null;
  biasScore: number;
  hasScore: boolean;
  note?: string | null;
}) {
  const regime = regimeForScore(biasScore);
  const sortedAssets = [...assets].sort(
    (leftAsset, rightAsset) => leftAsset.dailyChangePercent - rightAsset.dailyChangePercent,
  );
  const weakestAsset = sortedAssets[0] ?? null;
  const strongestAsset = sortedAssets[sortedAssets.length - 1] ?? null;
  const advancingAssets = assets.filter((asset) => asset.dailyChangePercent > 0).length;
  const breadthSummary = assets.length > 0 ? `${advancingAssets}/${assets.length} advancing` : "Waiting for market data";
  const strongestMoveTone =
    strongestAsset && strongestAsset.dailyChangePercent > 0 ? "text-emerald-400" : "text-zinc-300";
  const weakestMoveTone = weakestAsset && weakestAsset.dailyChangePercent < 0 ? "text-rose-400" : "text-zinc-300";

  return (
    <section className="min-w-0 border border-white/5 p-4 sm:p-5 md:p-6">
      <div>
        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
          Storm Fronts
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
          {hasScore ? `${regime} backdrop` : "Session not stored"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-zinc-400">{note ?? forecastCopy(biasLabel, regime)}</p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="border-t border-white/5 pt-3">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
            Strongest
          </p>
          <p className="mt-2 text-sm font-medium text-white">{strongestAsset?.ticker ?? "--"}</p>
          <p className={`mt-1 font-[family:var(--font-data)] text-sm ${strongestMoveTone}`}>
            {formatMove(strongestAsset?.dailyChangePercent ?? null)}
          </p>
        </div>

        <div className="border-t border-white/5 pt-3">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
            Weakest
          </p>
          <p className="mt-2 text-sm font-medium text-white">{weakestAsset?.ticker ?? "--"}</p>
          <p className={`mt-1 font-[family:var(--font-data)] text-sm ${weakestMoveTone}`}>
            {formatMove(weakestAsset?.dailyChangePercent ?? null)}
          </p>
        </div>

        <div className="border-t border-white/5 pt-3">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
            Breadth
          </p>
          <p className="mt-2 text-sm font-medium text-white">{breadthSummary}</p>
          <p className="mt-1 font-[family:var(--font-data)] text-sm text-zinc-400">{assets.length} core ETFs</p>
        </div>
      </div>
    </section>
  );
}
