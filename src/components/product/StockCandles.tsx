'use client';

import { useState } from "react";

import { formatTradeDate } from "@/lib/public-proof/format";
import type { StoredCandle } from "@/lib/public-proof/load-public-proof";

import { InstrumentTip, tipAlign } from "./InstrumentTip";

const WIDTH = 320;
const HEIGHT = 148;
const PAD = 8;

function formatPrint(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function StockCandles({
  candles,
  notice,
}: {
  candles: StoredCandle[];
  notice: string | null;
}) {
  const [activeDate, setActiveDate] = useState<string | null>(null);

  if (candles.length === 0) {
    return (
      <div>
        <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">SPY</p>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          {notice ?? "No stored equity series. The score bars are the chart."}
        </p>
      </div>
    );
  }

  const minLow = Math.min(...candles.map((candle) => candle.low));
  const maxHigh = Math.max(...candles.map((candle) => candle.high));
  const span = maxHigh - minLow;
  const slot = WIDTH / candles.length;

  function y(price: number) {
    if (span === 0) {
      return HEIGHT / 2;
    }

    return PAD + ((maxHigh - price) / span) * (HEIGHT - PAD * 2);
  }

  return (
    <div>
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">SPY</p>
      <p className="mt-1 text-xs text-zinc-500">Stored daily bars</p>
      <div className="relative mt-4 h-40">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-full w-full"
          role="img"
          aria-label="SPY stored daily bars"
          preserveAspectRatio="none"
        >
          {candles.map((candle, index) => {
            const center = (index + 0.5) * slot;
            const bodyWidth = Math.max(2, slot * 0.55);
            const openY = y(candle.open);
            const closeY = y(candle.close);
            const top = Math.min(openY, closeY);
            const bodyHeight = Math.max(span === 0 ? 1 : 0.8, Math.abs(openY - closeY));
            const filled = candle.close < candle.open;

            return (
              <g key={candle.tradeDate}>
                <line
                  x1={center}
                  x2={center}
                  y1={y(candle.high)}
                  y2={y(candle.low)}
                  stroke="#ffffff"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={center - bodyWidth / 2}
                  y={top}
                  width={bodyWidth}
                  height={bodyHeight}
                  fill={filled ? "#ffffff" : "none"}
                  stroke="#ffffff"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
        <div className="absolute inset-0 flex">
          {candles.map((candle, index) => {
            const active = activeDate === candle.tradeDate;

            return (
              <button
                key={candle.tradeDate}
                type="button"
                className="relative min-w-0 flex-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white"
                aria-label={`${formatTradeDate(candle.tradeDate)} low ${formatPrint(candle.low)} high ${formatPrint(candle.high)}`}
                onMouseEnter={() => setActiveDate(candle.tradeDate)}
                onMouseLeave={() => setActiveDate((current) => (current === candle.tradeDate ? null : current))}
                onFocus={() => setActiveDate(candle.tradeDate)}
                onBlur={() => setActiveDate((current) => (current === candle.tradeDate ? null : current))}
              >
                {active ? (
                  <InstrumentTip
                    align={tipAlign(index, candles.length)}
                    date={formatTradeDate(candle.tradeDate)}
                    lines={[`${formatPrint(candle.low)} low to ${formatPrint(candle.high)} high`]}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
