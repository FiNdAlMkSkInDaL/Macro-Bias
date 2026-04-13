"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";

interface DataPoint {
  date: string;
  spy: number;
  strategy: number;
}

function fmtDateShort(s: string): string {
  const d = new Date(s + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtDateFull(s: string): string {
  const d = new Date(s + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value: number; dataKey: string; payload: DataPoint }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="border border-white/10 bg-zinc-950 px-3 py-2 shadow-xl">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-wider text-zinc-500">
        {fmtDateFull(row.date)}
      </p>
      <div className="mt-1.5 flex flex-col gap-1">
        <span className="flex items-center gap-2 font-[family:var(--font-data)] text-xs">
          <span className="inline-block h-px w-3 bg-white" />
          <span className="text-zinc-500">Macro Bias</span>
          <span className="ml-auto font-bold text-white">
            {(row.strategy - 100) > 0 ? "+" : ""}{(row.strategy - 100).toFixed(2)}%
          </span>
        </span>
        <span className="flex items-center gap-2 font-[family:var(--font-data)] text-xs">
          <span className="inline-block h-px w-3 bg-zinc-600" />
          <span className="text-zinc-500">S&P 500</span>
          <span className="ml-auto text-zinc-300">
            {(row.spy - 100) > 0 ? "+" : ""}{(row.spy - 100).toFixed(2)}%
          </span>
        </span>
      </div>
    </div>
  );
}

export default function PerformanceChart({ data }: { data: DataPoint[] }) {
  if (data.length === 0) return null;

  const allValues = data.flatMap((d) => [d.spy, d.strategy]);
  const min = Math.floor(Math.min(...allValues) - 0.5);
  const max = Math.ceil(Math.max(...allValues) + 0.5);

  const tickInterval = Math.max(1, Math.floor(data.length / 6));
  const xTicks = data
    .filter((_, i) => i % tickInterval === 0 || i === data.length - 1)
    .map((d) => d.date);

  return (
    <div className="h-[340px] w-full sm:h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
        >
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
            tickFormatter={fmtDateShort}
            ticks={xTicks}
            axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
            tickLine={false}
          />
          <YAxis
            domain={[min, max]}
            tick={{
              fontSize: 10,
              fill: "#52525b",
              fontFamily: "var(--font-data)",
            }}
            tickFormatter={(v: number) => `${(v - 100).toFixed(0)}%`}
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
          {/* SPY line — dim */}
          <Line
            type="monotone"
            dataKey="spy"
            stroke="#52525b"
            strokeWidth={1}
            dot={false}
            name="S&P 500"
          />
          {/* Strategy line — white */}
          <Line
            type="monotone"
            dataKey="strategy"
            stroke="#ffffff"
            strokeWidth={2}
            dot={false}
            name="Macro Bias Signal"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
