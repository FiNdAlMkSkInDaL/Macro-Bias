"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PaperTradingEquityCurvePoint } from "@/lib/paper-trading/get-paper-trading-dashboard-data";

function formatShortDate(date: string) {
  const parsedDate = new Date(`${date}T00:00:00Z`);
  return parsedDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatFullDate(date: string) {
  const parsedDate = new Date(`${date}T00:00:00Z`);
  return parsedDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: PaperTradingEquityCurvePoint; value: number }[];
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const row = payload[0].payload;
  const totalReturnLabel = `${row.totalReturnPct > 0 ? "+" : ""}${row.totalReturnPct.toFixed(2)}%`;

  return (
    <div className="border border-white/10 bg-zinc-950 px-3 py-2 shadow-xl">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-wider text-zinc-500">
        {formatFullDate(row.date)}
      </p>
      <div className="mt-1.5 flex flex-col gap-1">
        <span className="flex items-center gap-2 font-[family:var(--font-data)] text-xs">
          <span className="inline-block h-px w-3 bg-white" />
          <span className="text-zinc-500">Paper Agent</span>
          <span className="ml-auto font-bold text-white">{totalReturnLabel}</span>
        </span>
        <span className="font-[family:var(--font-data)] text-xs text-zinc-300">
          Equity {formatCurrency(row.totalEquity)}
        </span>
      </div>
    </div>
  );
}

export default function AgentEquityChart({
  data,
}: {
  data: PaperTradingEquityCurvePoint[];
}) {
  if (data.length === 0) {
    return null;
  }

  const values = data.map((point) => point.equityIndex);
  let min = Math.floor(Math.min(...values) - 0.5);
  let max = Math.ceil(Math.max(...values) + 0.5);

  if (min === max) {
    min -= 1;
    max += 1;
  }

  const tickInterval = Math.max(1, Math.floor(data.length / 4));
  const xTicks = data
    .filter((_, index) => index % tickInterval === 0 || index === data.length - 1)
    .map((point) => point.date);

  return (
    <div className="h-[340px] w-full sm:h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.04)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{
              fontSize: 10,
              fill: "#52525b",
              fontFamily: "var(--font-data)",
            }}
            tickFormatter={formatShortDate}
            ticks={xTicks}
            axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
            tickLine={false}
            angle={0}
          />
          <YAxis
            domain={[min, max]}
            width={48}
            tick={{
              fontSize: 10,
              fill: "#52525b",
              fontFamily: "var(--font-data)",
            }}
            tickFormatter={(value: number) => `${(value - 100).toFixed(0)}%`}
            axisLine={false}
            tickLine={false}
          />
          <ReferenceLine
            y={100}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="4 4"
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: "rgba(255,255,255,0.08)" }}
          />
          <Line
            type="monotone"
            dataKey="equityIndex"
            stroke="#ffffff"
            strokeWidth={2}
            dot={false}
            name="Paper Agent"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
