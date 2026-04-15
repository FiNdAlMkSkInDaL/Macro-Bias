import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());

  const { upsertCryptoMarketData } = await import(
    "../lib/crypto-market-data/upsert-crypto-market-data"
  );
  const result = await upsertCryptoMarketData();

  console.log(
    JSON.stringify(
      {
        tradeDate: result.tradeDate,
        score: result.score,
        label: result.label,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error("Daily crypto bias sync failed.");
  console.error(error);
  process.exit(1);
});
