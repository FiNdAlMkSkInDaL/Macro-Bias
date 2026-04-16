import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const slugs = [
  "backtest-vs-reality",
  "best-setup-worst-loss",
  "conviction-needs-history",
  "cut-winners-hold-losers",
  "discretion-breaks-under-pressure",
  "gut-feeling-costs",
  "history-beats-emotion",
  "intuition-is-not-edge",
  "news-already-priced",
  "systems-break-in-volatility",
  "crypto-gut-feeling-costs-more",
  "btc-regime-scoring-drawdowns",
  "crypto-90-second-morning-routine",
  "crypto-traders-need-macro-model",
  "backtested-41576-vs-btc",
];

async function main() {
  const now = new Date().toISOString();
  const rows = slugs.map((slug) => ({ slug, published_at: now }));

  const { data, error } = await supabase
    .from("published_marketing_posts")
    .upsert(rows, { onConflict: "slug" })
    .select("slug");

  if (error) {
    console.error("ERROR:", error.message);
    process.exit(1);
  }

  console.log(
    `Published ${data.length} posts:`,
    data.map((r: { slug: string }) => r.slug).join(", "),
  );
}

main();
