import type { BiasAsset } from "../../types";

interface AssetHeatmapProps {
  assets: BiasAsset[];
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentageFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${percentageFormatter.format(value)}%`;
}

function getTone(change: number) {
  if (change > 0.75) {
    return {
      container: "border-emerald-500/40 bg-emerald-500/10",
      badge: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30",
      changeText: "text-emerald-300",
    };
  }

  if (change > 0) {
    return {
      container: "border-emerald-500/25 bg-emerald-500/5",
      badge: "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/20",
      changeText: "text-emerald-200",
    };
  }

  if (change < -0.75) {
    return {
      container: "border-rose-500/40 bg-rose-500/10",
      badge: "bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/30",
      changeText: "text-rose-300",
    };
  }

  if (change < 0) {
    return {
      container: "border-rose-500/25 bg-rose-500/5",
      badge: "bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/20",
      changeText: "text-rose-200",
    };
  }

  return {
    container: "border-slate-700 bg-slate-900/70",
    badge: "bg-slate-800 text-slate-200 ring-1 ring-slate-700",
    changeText: "text-slate-200",
  };
}

export function AssetHeatmap({ assets }: AssetHeatmapProps) {
  return (
    <section className="rounded-[28px] border border-slate-800/80 bg-slate-950/80 p-6 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-sm sm:p-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
            Asset Heatmap
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
            Cross-asset confirmation
          </h2>
        </div>
        <p className="max-w-xl text-sm leading-6 text-slate-300">
          Equities, defensives, duration, and gold all contribute to the daily macro weather read.
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {assets.map((asset) => {
          const tone = getTone(asset.dailyChangePercent);

          return (
            <article
              key={asset.ticker}
              className={`rounded-[24px] border p-4 transition-colors ${tone.container}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
                    {asset.ticker}
                  </p>
                  <p className="mt-4 text-2xl font-semibold text-white">
                    {currencyFormatter.format(asset.currentPrice)}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 font-mono text-[11px] ${tone.badge}`}>
                  {formatSignedPercent(asset.dailyChangePercent)}
                </span>
              </div>

              <div className="mt-8 border-t border-white/10 pt-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-slate-500">
                  Daily change
                </p>
                <p className={`mt-2 text-xl font-semibold ${tone.changeText}`}>
                  {formatSignedPercent(asset.dailyChangePercent)}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}