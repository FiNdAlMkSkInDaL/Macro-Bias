import type { BiasLabel } from "@/lib/macro-bias/types";

import { BiasGauge } from "./BiasGauge";
import { StormFrontsCard, type DashboardTapeAsset } from "./StormFrontsCard";

export type { DashboardTapeAsset };

function formatStoredTradeDate(tradeDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    return tradeDate;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${tradeDate}T00:00:00Z`));
}

const moduleClassName = "min-w-0 border border-white/5 p-4 sm:p-5 md:p-6";

export function DashboardTop({
  assets,
  biasLabel,
  biasScore,
  hasScore,
  note,
  tradeDate,
}: {
  assets: DashboardTapeAsset[];
  biasLabel?: BiasLabel | null;
  biasScore: number;
  hasScore: boolean;
  note?: string | null;
  tradeDate?: string | null;
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 md:gap-6 lg:col-span-2 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
      <section className={`${moduleClassName} overflow-hidden`}>
        <div className="mx-auto w-full max-w-[17rem] min-[360px]:max-w-full md:mx-0 md:max-w-none">
          {tradeDate ? (
            <p className="mb-4 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.32em] text-zinc-500">
              Trade date {formatStoredTradeDate(tradeDate)}
            </p>
          ) : null}
          {hasScore ? (
            <BiasGauge biasScore={biasScore} />
          ) : (
            <p className="text-sm leading-6 text-zinc-400">No score is stored for this session.</p>
          )}
        </div>
      </section>

      <StormFrontsCard
        assets={assets}
        biasLabel={biasLabel}
        biasScore={biasScore}
        hasScore={hasScore}
        note={note}
      />
    </div>
  );
}
