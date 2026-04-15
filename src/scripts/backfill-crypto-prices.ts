/**
 * One-time script to backfill full crypto price history into etf_daily_prices.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-crypto-prices.ts
 *
 * This is safe to re-run — all upserts use ON CONFLICT DO UPDATE.
 */
import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());

  const { upsertCryptoMarketData } = await import(
    "../lib/crypto-market-data/upsert-crypto-market-data"
  );

  console.log("[backfill-crypto-prices] Starting full-history backfill...");
  const result = await upsertCryptoMarketData({ writeFullHistory: true });
  console.log(
    `[backfill-crypto-prices] Done. Trade date: ${result.tradeDate}, score: ${result.score}, label: ${result.label}`,
  );
}

main().catch((err) => {
  console.error("[backfill-crypto-prices] Fatal error:", err);
  process.exit(1);
});
