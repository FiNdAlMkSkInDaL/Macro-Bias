import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { BiasLabel } from "@/lib/macro-bias/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TrackRecordDay {
  tradeDate: string;
  score: number;
  biasLabel: BiasLabel;
  spyClose: number;
  /** Same-day SPY % change (close[T] vs close[T-1]). Already in pct. */
  spyChangePercent: number;
  /** Forward 1-day SPY return (close[T+1] vs close[T]). Already in pct. */
  spyForward1DReturn: number | null;
  /** Forward 3-day SPY return (close[T+3] vs close[T]). Already in pct. */
  spyForward3DReturn: number | null;
  /** Did the score direction match the same-day SPY move? */
  sameDayCorrect: boolean | null;
  /** Did the score direction match the next-day SPY move? */
  forward1DCorrect: boolean | null;
  modelVersion: string;
}

export interface RegimeHitRate {
  label: BiasLabel;
  displayName: string;
  totalDays: number;
  daysWithResult: number;
  correctCalls: number;
  hitRate: number | null;
  avgSameDayReturn: number | null;
  avgForward1DReturn: number | null;
}

export interface ScoreBucket {
  label: string;
  range: [number, number];
  biasLabel: BiasLabel;
  count: number;
  daysWithResult: number;
  avgSameDayReturn: number | null;
  avgForward1DReturn: number | null;
  hitRate: number | null;
}

export interface TrackRecordData {
  days: TrackRecordDay[];
  totalDays: number;
  daysWithResult: number;
  dateRange: { from: string; to: string } | null;

  /* Headline KPIs */
  sameDayHitRate: number | null;
  forward1DHitRate: number | null;
  avgReturnBullish: number | null;
  avgReturnBearish: number | null;
  /** bullish avg – bearish avg: the total observable edge. */
  edgeSpread: number | null;

  /* Per-regime */
  regimeHitRates: RegimeHitRate[];

  /* Score quintile analysis */
  scoreBuckets: ScoreBucket[];

  /* Distribution */
  regimeDistribution: { label: BiasLabel; count: number; pct: number }[];

  /* Meta */
  latestModelVersion: string;
  overrideCount: number;
}

/* ------------------------------------------------------------------ */
/*  Static config                                                      */
/* ------------------------------------------------------------------ */

const SCORE_BUCKETS_CONFIG: {
  label: string;
  range: [number, number];
  biasLabel: BiasLabel;
}[] = [
  { label: "≥ +60", range: [60, 100], biasLabel: "EXTREME_RISK_ON" },
  { label: "+21 to +59", range: [21, 59], biasLabel: "RISK_ON" },
  { label: "−20 to +20", range: [-20, 20], biasLabel: "NEUTRAL" },
  { label: "−59 to −21", range: [-59, -21], biasLabel: "RISK_OFF" },
  { label: "≤ −60", range: [-100, -60], biasLabel: "EXTREME_RISK_OFF" },
];

const ALL_REGIMES: { label: BiasLabel; displayName: string }[] = [
  { label: "EXTREME_RISK_ON", displayName: "Extreme Risk On" },
  { label: "RISK_ON", displayName: "Risk On" },
  { label: "NEUTRAL", displayName: "Neutral" },
  { label: "RISK_OFF", displayName: "Risk Off" },
  { label: "EXTREME_RISK_OFF", displayName: "Extreme Risk Off" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function directionCorrect(score: number, returnPct: number): boolean | null {
  if (score === 0) return null;
  if (score > 0) return returnPct >= 0;
  return returnPct <= 0;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function pctChange(from: number, to: number): number {
  return Number((((to - from) / from) * 100).toFixed(4));
}

/* ------------------------------------------------------------------ */
/*  Raw row types for Supabase query results                           */
/* ------------------------------------------------------------------ */

type ScoreRow = {
  trade_date: string;
  score: number;
  bias_label: string;
  ticker_changes: Record<
    string,
    { close: number; previousClose: number; percentChange: number }
  >;
  model_version: string;
};

type SpyPriceRow = {
  trade_date: string;
  close: number;
};

/* ------------------------------------------------------------------ */
/*  Main fetcher (React cache-wrapped for de-dup in a single render)   */
/* ------------------------------------------------------------------ */

export const getTrackRecordData = cache(
  async (): Promise<TrackRecordData> => {
    const sb = createSupabaseAdminClient();

    const [scoresRes, spyRes, overrideRes] = await Promise.all([
      sb
        .from("macro_bias_scores")
        .select("trade_date, score, bias_label, ticker_changes, model_version")
        .order("trade_date", { ascending: true }),
      sb
        .from("etf_daily_prices")
        .select("trade_date, close")
        .eq("ticker", "SPY")
        .order("trade_date", { ascending: true }),
      sb
        .from("daily_market_briefings")
        .select("id", { count: "exact", head: true })
        .eq("is_override_active", true),
    ]);

    const scores = (scoresRes.data ?? []) as ScoreRow[];
    const spyPrices = (spyRes.data ?? []) as SpyPriceRow[];
    const overrideCount = overrideRes.count ?? 0;

    if (scores.length === 0) {
      return emptyTrackRecord(overrideCount);
    }

    /* ---- Build SPY date→index map for fast T+n lookup ----------- */

    const spyDateIndex = new Map<string, number>();
    spyPrices.forEach((row, i) => spyDateIndex.set(row.trade_date, i));

    /* ---- Build day-level data ----------------------------------- */

    const days: TrackRecordDay[] = scores.map((row) => {
      const spy = row.ticker_changes?.SPY;
      const spyClose = spy?.close ?? 0;
      const spyChangePercent = spy?.percentChange ?? 0;

      let spyForward1DReturn: number | null = null;
      let spyForward3DReturn: number | null = null;

      const idx = spyDateIndex.get(row.trade_date);
      if (idx !== undefined && spyClose > 0) {
        const next1 = spyPrices[idx + 1];
        if (next1) spyForward1DReturn = pctChange(spyClose, next1.close);
        const next3 = spyPrices[idx + 3];
        if (next3) spyForward3DReturn = pctChange(spyClose, next3.close);
      }

      return {
        tradeDate: row.trade_date,
        score: row.score,
        biasLabel: row.bias_label as BiasLabel,
        spyClose,
        spyChangePercent,
        spyForward1DReturn,
        spyForward3DReturn,
        sameDayCorrect: directionCorrect(row.score, spyChangePercent),
        forward1DCorrect:
          spyForward1DReturn !== null
            ? directionCorrect(row.score, spyForward1DReturn)
            : null,
        modelVersion: row.model_version,
      };
    });

    /* ---- Aggregate: same-day hit rate --------------------------- */

    const withSameDay = days.filter((d) => d.score !== 0);
    const sameDayCorrectCount = withSameDay.filter(
      (d) => d.sameDayCorrect === true,
    ).length;

    /* ---- Aggregate: forward 1D hit rate ------------------------- */

    const with1D = days.filter(
      (d) => d.score !== 0 && d.spyForward1DReturn !== null,
    );
    const fwd1DCorrectCount = with1D.filter(
      (d) => d.forward1DCorrect === true,
    ).length;

    /* ---- Aggregate: bullish vs bearish avg same-day return ------ */

    const bullishDays = days.filter((d) => d.score > 0);
    const bearishDays = days.filter((d) => d.score < 0);
    const avgReturnBullish = avg(bullishDays.map((d) => d.spyChangePercent));
    const avgReturnBearish = avg(bearishDays.map((d) => d.spyChangePercent));

    /* ---- Per-regime hit rates ----------------------------------- */

    const regimeHitRates: RegimeHitRate[] = ALL_REGIMES.map(
      ({ label, displayName }) => {
        const inRegime = days.filter((d) => d.biasLabel === label);
        const nonNeutral = inRegime.filter((d) => d.score !== 0);
        const correct = nonNeutral.filter(
          (d) => d.sameDayCorrect === true,
        ).length;
        return {
          label,
          displayName,
          totalDays: inRegime.length,
          daysWithResult: nonNeutral.length,
          correctCalls: correct,
          hitRate:
            nonNeutral.length > 0
              ? (correct / nonNeutral.length) * 100
              : null,
          avgSameDayReturn: avg(inRegime.map((d) => d.spyChangePercent)),
          avgForward1DReturn: avg(
            inRegime
              .filter((d) => d.spyForward1DReturn !== null)
              .map((d) => d.spyForward1DReturn!),
          ),
        };
      },
    );

    /* ---- Score quintile buckets --------------------------------- */

    const scoreBuckets: ScoreBucket[] = SCORE_BUCKETS_CONFIG.map(
      ({ label, range, biasLabel }) => {
        const [min, max] = range;
        const inBucket = days.filter(
          (d) => d.score >= min && d.score <= max,
        );
        const nonNeutral = inBucket.filter((d) => d.score !== 0);
        const correct = nonNeutral.filter(
          (d) => d.sameDayCorrect === true,
        ).length;
        return {
          label,
          range,
          biasLabel,
          count: inBucket.length,
          daysWithResult: nonNeutral.length,
          avgSameDayReturn: avg(inBucket.map((d) => d.spyChangePercent)),
          avgForward1DReturn: avg(
            inBucket
              .filter((d) => d.spyForward1DReturn !== null)
              .map((d) => d.spyForward1DReturn!),
          ),
          hitRate:
            nonNeutral.length > 0
              ? (correct / nonNeutral.length) * 100
              : null,
        };
      },
    );

    /* ---- Regime distribution ------------------------------------ */

    const regimeDistribution = ALL_REGIMES.map(({ label }) => {
      const count = days.filter((d) => d.biasLabel === label).length;
      return {
        label,
        count,
        pct: days.length > 0 ? (count / days.length) * 100 : 0,
      };
    });

    /* ---- Assemble ------------------------------------------------ */

    return {
      days: [...days].reverse(), // newest first
      totalDays: days.length,
      daysWithResult: withSameDay.length,
      dateRange: {
        from: scores[0].trade_date,
        to: scores[scores.length - 1].trade_date,
      },
      sameDayHitRate:
        withSameDay.length > 0
          ? (sameDayCorrectCount / withSameDay.length) * 100
          : null,
      forward1DHitRate:
        with1D.length > 0 ? (fwd1DCorrectCount / with1D.length) * 100 : null,
      avgReturnBullish,
      avgReturnBearish,
      edgeSpread:
        avgReturnBullish !== null && avgReturnBearish !== null
          ? avgReturnBullish - avgReturnBearish
          : null,
      regimeHitRates,
      scoreBuckets,
      regimeDistribution,
      latestModelVersion:
        scores[scores.length - 1].model_version ?? "unknown",
      overrideCount,
    };
  },
);

/* ------------------------------------------------------------------ */
/*  Empty fallback                                                     */
/* ------------------------------------------------------------------ */

function emptyTrackRecord(overrideCount: number): TrackRecordData {
  return {
    days: [],
    totalDays: 0,
    daysWithResult: 0,
    dateRange: null,
    sameDayHitRate: null,
    forward1DHitRate: null,
    avgReturnBullish: null,
    avgReturnBearish: null,
    edgeSpread: null,
    regimeHitRates: ALL_REGIMES.map(({ label, displayName }) => ({
      label,
      displayName,
      totalDays: 0,
      daysWithResult: 0,
      correctCalls: 0,
      hitRate: null,
      avgSameDayReturn: null,
      avgForward1DReturn: null,
    })),
    scoreBuckets: SCORE_BUCKETS_CONFIG.map(({ label, range, biasLabel }) => ({
      label,
      range,
      biasLabel,
      count: 0,
      daysWithResult: 0,
      avgSameDayReturn: null,
      avgForward1DReturn: null,
      hitRate: null,
    })),
    regimeDistribution: ALL_REGIMES.map(({ label }) => ({
      label,
      count: 0,
      pct: 0,
    })),
    latestModelVersion: "unknown",
    overrideCount,
  };
}
