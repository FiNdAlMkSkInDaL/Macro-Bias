export type RegimeName = "Risk-On" | "Neutral" | "Risk-Off";

const TAPE_LINE = {
  neutral: "The tape is mixed, with no clean macro confirmation from the core rotation basket.",
  riskOff: "Defensive leadership is taking over as traders rotate away from cyclicals.",
  riskOn: "Cross-asset participation is favoring growth and broad risk appetite.",
} as const;

export const STORM_FRONTS_COPY = {
  neutral:
    "Capital is rotating without committing. Breakouts are statistically likely to fail in this environment. Keep size small, tighten stops, and play the ranges.",
  riskOff:
    "Capital is actively seeking shelter. Structural distribution is driving the tape. Prioritize capital preservation, size down, and look to fade intraday bounces.",
  riskOn:
    "Risk assets are catching structural bids. The underlying tape is heavily accumulated. Look for relative strength, buy the dips, and extend your profit targets.",
} as const;

export function regimeForScore(biasScore: number): RegimeName {
  if (biasScore > 30) {
    return "Risk-On";
  }

  if (biasScore < -30) {
    return "Risk-Off";
  }

  return "Neutral";
}

export function tapeLineForScore(biasScore: number): string {
  const regime = regimeForScore(biasScore);

  if (regime === "Risk-On") {
    return TAPE_LINE.riskOn;
  }

  if (regime === "Risk-Off") {
    return TAPE_LINE.riskOff;
  }

  return TAPE_LINE.neutral;
}
