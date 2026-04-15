import { loadEnvConfig } from "@next/env";

import {
  CRYPTO_BRIEFING_SECTION_HEADERS,
} from "../src/lib/crypto-briefing/crypto-briefing-config";
import {
  generateCryptoDailyBriefing,
} from "../src/lib/crypto-briefing/crypto-brief-generator";
import type { CryptoDailyBiasResult, BiasLabel } from "../src/lib/crypto-bias/types";

if (process.env.NODE_ENV === "production") {
  throw new Error("scripts/test-crypto-regimes.ts must not run in production.");
}

loadEnvConfig(process.cwd());

/* ------------------------------------------------------------------ */
/*  Scenario definitions                                               */
/* ------------------------------------------------------------------ */

type Scenario = {
  name: string;
  biasResult: CryptoDailyBiasResult;
};

const SCENARIOS: Scenario[] = [
  {
    name: "Extreme Risk On",
    biasResult: {
      tradeDate: "2025-04-15",
      score: 72,
      label: "EXTREME_RISK_ON",
      componentScores: [
        {
          key: "knn_analog",
          weight: 1,
          signal: 0.72,
          contribution: 72,
          summary: "K-NN analogs show strong bullish alignment. BTC RSI elevated, ETH/BTC ratio healthy.",
          pillar: "trendAndMomentum",
          analogDates: ["2021-02-08", "2020-10-21", "2024-03-05"],
          averageForward1DayReturn: 2.1,
          averageForward3DayReturn: 4.8,
        },
      ],
      tickerChanges: {
        "BTC-USD": { ticker: "BTC-USD", tradeDate: "2025-04-15", close: 92500, previousClose: 89000, percentChange: 3.93 },
        "ETH-USD": { ticker: "ETH-USD", tradeDate: "2025-04-15", close: 3800, previousClose: 3650, percentChange: 4.11 },
        "SOL-USD": { ticker: "SOL-USD", tradeDate: "2025-04-15", close: 185, previousClose: 174, percentChange: 6.32 },
      },
    },
  },
  {
    name: "Extreme Risk Off",
    biasResult: {
      tradeDate: "2025-04-15",
      score: -68,
      label: "EXTREME_RISK_OFF",
      componentScores: [
        {
          key: "knn_analog",
          weight: 1,
          signal: -0.68,
          contribution: -68,
          summary: "K-NN analogs show bearish pattern. BTC realized vol spiking, ETH/BTC ratio collapsing.",
          pillar: "volatility",
          analogDates: ["2022-06-13", "2022-11-08", "2020-03-12"],
          averageForward1DayReturn: -3.5,
          averageForward3DayReturn: -7.2,
        },
      ],
      tickerChanges: {
        "BTC-USD": { ticker: "BTC-USD", tradeDate: "2025-04-15", close: 58000, previousClose: 63000, percentChange: -7.94 },
        "ETH-USD": { ticker: "ETH-USD", tradeDate: "2025-04-15", close: 2100, previousClose: 2400, percentChange: -12.5 },
        "SOL-USD": { ticker: "SOL-USD", tradeDate: "2025-04-15", close: 95, previousClose: 115, percentChange: -17.39 },
      },
    },
  },
  {
    name: "Neutral",
    biasResult: {
      tradeDate: "2025-04-15",
      score: 5,
      label: "NEUTRAL",
      componentScores: [
        {
          key: "knn_analog",
          weight: 1,
          signal: 0.05,
          contribution: 5,
          summary: "Mixed signals. BTC chopping in range, DXY and TLT giving conflicting reads.",
          pillar: "macroCorrelation",
          analogDates: ["2023-08-14", "2024-01-05", "2023-04-20"],
          averageForward1DayReturn: 0.2,
          averageForward3DayReturn: -0.1,
        },
      ],
      tickerChanges: {
        "BTC-USD": { ticker: "BTC-USD", tradeDate: "2025-04-15", close: 67500, previousClose: 67200, percentChange: 0.45 },
        "ETH-USD": { ticker: "ETH-USD", tradeDate: "2025-04-15", close: 3100, previousClose: 3080, percentChange: 0.65 },
        "SOL-USD": { ticker: "SOL-USD", tradeDate: "2025-04-15", close: 148, previousClose: 146, percentChange: 1.37 },
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

function validateBriefing(copy: string, scenario: Scenario): string[] {
  const issues: string[] = [];
  const headers = Object.values(CRYPTO_BRIEFING_SECTION_HEADERS);

  for (const h of headers) {
    if (!copy.includes(h)) {
      issues.push(`Missing section header: ${h}`);
    }
  }

  if (copy.length < 200) {
    issues.push(`Briefing too short (${copy.length} chars).`);
  }

  if (/\bdelve\b/i.test(copy) || /\btapestry\b/i.test(copy) || /\blandscape\b/i.test(copy)) {
    issues.push("Contains banned AI fluff word.");
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/*  Runner                                                             */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("=== Crypto Regime Test Suite ===\n");

  let passed = 0;
  let failed = 0;

  for (const scenario of SCENARIOS) {
    console.log(`--- Scenario: ${scenario.name} (score=${scenario.biasResult.score}) ---`);

    try {
      const result = await generateCryptoDailyBriefing(scenario.biasResult);

      console.log(`  Generated by: ${result.generatedBy}`);
      console.log(`  Override: ${result.isOverrideActive}`);
      console.log(`  Warnings: ${result.warnings.length > 0 ? result.warnings.join("; ") : "none"}`);

      const issues = validateBriefing(result.newsletterCopy, scenario);

      if (issues.length > 0) {
        console.log(`  ISSUES:`);
        for (const issue of issues) {
          console.log(`    - ${issue}`);
        }
        failed += 1;
      } else {
        console.log(`  PASS`);
        passed += 1;
      }

      console.log(`\n  --- Preview (first 300 chars) ---`);
      console.log(`  ${result.newsletterCopy.slice(0, 300).replace(/\n/g, "\n  ")}`);
      console.log("");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  FAIL: ${msg}`);
      failed += 1;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Test script failed.");
  console.error(error);
  process.exit(1);
});
