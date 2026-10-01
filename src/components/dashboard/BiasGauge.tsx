'use client';

import { useEffect, useState } from "react";

import { regimeForScore, tapeLineForScore } from "./gauge-copy";

interface BiasGaugeProps {
  animate?: boolean;
  biasScore: number;
  showRead?: boolean;
}

const MIN_SCORE = -100;
const MAX_SCORE = 100;

function clampBiasScore(biasScore: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, biasScore));
}

function getGaugeTone(biasScore: number) {
  if (biasScore > 30) {
    return {
      label: "text-emerald-400",
      score: "text-emerald-400",
    };
  }

  if (biasScore < -30) {
    return {
      label: "text-rose-400",
      score: "text-rose-400",
    };
  }

  return {
    label: "text-zinc-300",
    score: "text-white",
  };
}

function getScalePosition(biasScore: number): number {
  return ((clampBiasScore(biasScore) - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100;
}

function formatScore(biasScore: number): string {
  const roundedScore = Math.round(biasScore);

  return `${roundedScore > 0 ? "+" : ""}${roundedScore}`;
}

export function BiasGauge({ animate = false, biasScore, showRead = true }: BiasGaugeProps) {
  const normalizedScore = clampBiasScore(biasScore);
  const [displayScore, setDisplayScore] = useState(animate ? 0 : normalizedScore);
  const regime = regimeForScore(showRead ? normalizedScore : displayScore);
  const tone = getGaugeTone(showRead ? normalizedScore : displayScore);
  const indicatorPosition = getScalePosition(animate ? displayScore : normalizedScore);

  useEffect(() => {
    if (!animate) {
      setDisplayScore(normalizedScore);
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      setDisplayScore(normalizedScore);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const duration = 900;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setDisplayScore(normalizedScore * eased);

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    setDisplayScore(0);
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [animate, normalizedScore]);

  return (
    <section className="space-y-4">
      {showRead ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              Bias Gauge
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
              <p className={`font-[family:var(--font-data)] text-5xl font-semibold leading-none sm:text-6xl ${tone.score}`}>
                {formatScore(normalizedScore)}
              </p>
              <span className={`font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] ${tone.label}`}>
                {regime}
              </span>
            </div>
          </div>

          <p className="max-w-md text-sm leading-6 text-zinc-400">{tapeLineForScore(normalizedScore)}</p>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="relative w-full pt-3">
          <div
            className="relative h-1.5 w-full overflow-hidden rounded-full"
            style={{
              background:
                "linear-gradient(90deg, #f43f5e 0%, #71717a 50%, #22c55e 100%)",
            }}
          >
            <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/60" />
          </div>

          <div
            className="pointer-events-none absolute -top-1 h-8 -translate-x-1/2"
            style={{ left: `${indicatorPosition}%` }}
          >
            <div className="relative h-full w-px bg-white">
              <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-l border-t border-white bg-zinc-950" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
          <span>-100</span>
          <span>0</span>
          <span>+100</span>
        </div>
      </div>
    </section>
  );
}
