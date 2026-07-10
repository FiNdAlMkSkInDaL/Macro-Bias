import type { TradableSignal } from "./types";

/** Plain-English permission line for emails, briefings, and social. */
export function formatPermissionLine(signal: TradableSignal | null | undefined, score: number): string {
  if (!signal) {
    if (score > 20) return "Permission: LONG (legacy score, full unit assumed)";
    if (score < -20) return "Permission: SHORT (legacy score, full unit assumed)";
    return "Permission: FLAT (legacy score in neutral zone)";
  }

  const sizePct = Math.round(signal.size * 100);
  if (signal.position === "NO_TRADE") {
    return `Permission: NO_TRADE · Reliability ${signal.reliability} · Size 0%`;
  }

  if (signal.position === "FLAT") {
    return `Permission: FLAT · Reliability ${signal.reliability} · Size 0%`;
  }

  return `Permission: ${signal.position} · Reliability ${signal.reliability} · Size ${sizePct}%`;
}

export function formatSignalReason(signal: TradableSignal | null | undefined): string | null {
  if (!signal?.reason) return null;
  return signal.reason;
}

/** Compact social-friendly one-liner. */
export function formatSignalSocialLine(signal: TradableSignal | null | undefined, score: number): string {
  if (!signal) {
    return `Score ${score > 0 ? "+" : ""}${score}`;
  }

  if (signal.position === "NO_TRADE") {
    return `NO_TRADE (rel ${signal.reliability}) · score ${score > 0 ? "+" : ""}${score}`;
  }

  if (signal.position === "FLAT") {
    return `FLAT (rel ${signal.reliability}) · score ${score > 0 ? "+" : ""}${score}`;
  }

  return `${signal.position} ${Math.round(signal.size * 100)}% (rel ${signal.reliability}) · score ${score > 0 ? "+" : ""}${score}`;
}

export function isTradableSignal(value: unknown): value is TradableSignal {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.position === "string" &&
    typeof v.size === "number" &&
    typeof v.reliability === "string" &&
    typeof v.noTrade === "boolean"
  );
}

export function extractTradableSignal(engineInputs: unknown): TradableSignal | null {
  if (typeof engineInputs !== "object" || engineInputs === null) return null;
  const raw = (engineInputs as Record<string, unknown>).tradableSignal;
  return isTradableSignal(raw) ? raw : null;
}
