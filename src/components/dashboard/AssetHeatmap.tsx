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
      badge: "text-emerald-400",
      changeText: "text-emerald-400",
    };
  }

  if (change > 0) {
    return {
      badge: "text-emerald-400",
      changeText: "text-emerald-400",
    };
  }

  if (change < -0.75) {
    return {
      badge: "text-rose-400",
      changeText: "text-rose-400",
    };
  }

  if (change < 0) {
    return {
      badge: "text-rose-400",
      changeText: "text-rose-400",
    };
  }

  return {
    badge: "text-zinc-300",
    changeText: "text-white",
  };
}

export function AssetHeatmap({ assets }: AssetHeatmapProps) {
  return (
    <section className="space-y-6 sm:space-y-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            Asset Heatmap
          </p>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Cross-asset confirmation
          </h2>
        </div>
        <p className="max-w-xl text-base leading-7 text-zinc-300">
          Equities, defensives, duration, and gold all contribute to the daily macro weather read.
        </p>
      </div>

      <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {assets.map((asset) => {
          const tone = getTone(asset.dailyChangePercent);

          return (
            <article key={asset.ticker} className="border-t border-white/10 pt-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                    {asset.ticker}
                  </p>
                  <p className="mt-5 text-xl sm:text-2xl font-semibold tracking-tight text-white">
                    {currencyFormatter.format(asset.currentPrice)}
                  </p>
                </div>
                <span className={`font-[family:var(--font-data)] text-[11px] ${tone.badge}`}>
                  {formatSignedPercent(asset.dailyChangePercent)}
                </span>
              </div>

              <div className="mt-8">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Daily change
                </p>
                <p className={`mt-3 text-xl font-semibold ${tone.changeText}`}>
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