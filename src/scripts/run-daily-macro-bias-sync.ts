import { upsertDailyMarketData } from "../lib/market-data/upsert-daily-market-data";

async function main() {
  const result = await upsertDailyMarketData();

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
  console.error("Daily macro bias sync failed.");
  console.error(error);
  process.exit(1);
});