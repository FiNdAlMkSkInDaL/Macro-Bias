import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/server-env";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

type BriefingFeedRow = {
  briefing_date: string;
  trade_date: string;
  quant_score: number;
  bias_label: string;
  is_override_active: boolean;
  brief_content: string;
  generated_at: string;
};

function formatLabel(label: string) {
  return label.replace(/_/g, " ");
}

function formatScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function getFreeTierSnippet(briefContent: string) {
  const lines = briefContent.split("\n");
  const alphaIndex = lines.findIndex((l) => {
    const clean = l.replace(/\*\*/g, "").trim();
    return clean.startsWith("BOTTOM LINE") || clean.startsWith("THE ALPHA PROTOCOL");
  });
  if (alphaIndex === -1) return briefContent.slice(0, 300);
  return lines
    .slice(alphaIndex, alphaIndex + 6)
    .join("\n")
    .trim()
    .slice(0, 500);
}

export async function GET() {
  const appUrl = getAppUrl().replace(/\/$/, "");
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("daily_market_briefings")
    .select(
      "briefing_date, trade_date, quant_score, bias_label, is_override_active, brief_content, generated_at",
    )
    .order("briefing_date", { ascending: false })
    .limit(50);

  if (error) {
    return Response.json({ error: "Failed to load briefings" }, { status: 500 });
  }

  const rows = (data as BriefingFeedRow[] | null) ?? [];

  const seen = new Set<string>();
  const briefings = rows.filter((r) => {
    if (seen.has(r.briefing_date)) return false;
    seen.add(r.briefing_date);
    return true;
  });

  const items = briefings.map((b) => {
    const label = formatLabel(b.bias_label);
    const score = formatScore(b.quant_score);
    const snippet = getFreeTierSnippet(b.brief_content);
    const override = b.is_override_active ? " [MACRO OVERRIDE ACTIVE]" : "";

    return {
      id: `${appUrl}/briefings/${b.briefing_date}`,
      url: `${appUrl}/briefings/${b.briefing_date}`,
      title: `${label} (${score}) — ${b.briefing_date}`,
      content_text: `${snippet}${override}`,
      date_published: new Date(b.generated_at).toISOString(),
      tags: ["Macro Regime", label],
    };
  });

  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: "Macro Bias — Daily Regime Briefings",
    home_page_url: appUrl,
    feed_url: `${appUrl}/feed.json`,
    description:
      "Daily macro regime scoring and briefings for day traders. Algorithmic bias signals across SPY, TLT, GLD, USO, and HYG.",
    icon: `${appUrl}/icon.png`,
    favicon: `${appUrl}/favicon.ico`,
    language: "en-US",
    items,
  };

  return Response.json(feed, {
    headers: {
      "Content-Type": "application/feed+json; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
    },
  });
}
