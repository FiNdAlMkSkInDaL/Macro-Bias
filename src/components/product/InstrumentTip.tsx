export function InstrumentTip({
  align,
  date,
  lines,
}: {
  align: "start" | "center" | "end";
  date: string;
  lines: string[];
}) {
  const position =
    align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2";

  return (
    <div className={`pointer-events-none absolute bottom-full z-20 mb-2 w-max border border-white/15 bg-black px-3 py-2 ${position}`}>
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.28em] text-zinc-500">{date}</p>
      {lines.map((line) => (
        <p key={line} className="mt-1 font-[family:var(--font-data)] text-sm text-white">
          {line}
        </p>
      ))}
    </div>
  );
}

export function tipAlign(index: number, count: number): "start" | "center" | "end" {
  if (index <= 1) {
    return "start";
  }

  if (index >= count - 2) {
    return "end";
  }

  return "center";
}
