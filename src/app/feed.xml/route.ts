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
  news_summary: string;
  generated_at: string;
};

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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
  const snippet = lines
    .slice(alphaIndex, alphaIndex + 6)
    .join("\n")
    .trim();
  return snippet.slice(0, 500);
}

export async function GET() {
  const appUrl = getAppUrl().replace(/\/$/, "");
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("daily_market_briefings")
    .select(
      "briefing_date, trade_date, quant_score, bias_label, is_override_active, brief_content, news_summary, generated_at",
    )
    .order("briefing_date", { ascending: false })
    .limit(50);

  if (error) {
    return new Response("<rss><channel><title>Error</title></channel></rss>", {
      status: 500,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }

  const rows = (data as BriefingFeedRow[] | null) ?? [];

  // Deduplicate by briefing_date
  const seen = new Set<string>();
  const briefings = rows.filter((r) => {
    if (seen.has(r.briefing_date)) return false;
    seen.add(r.briefing_date);
    return true;
  });

  const lastBuildDate = briefings[0]
    ? new Date(briefings[0].generated_at).toUTCString()
    : new Date().toUTCString();

  const items = briefings.map((b) => {
    const label = formatLabel(b.bias_label);
    const score = formatScore(b.quant_score);
    const title = `${label} (${score}) — ${b.briefing_date}`;
    const link = `${appUrl}/briefings/${b.briefing_date}`;
    const snippet = getFreeTierSnippet(b.brief_content);
    const override = b.is_override_active ? " [MACRO OVERRIDE ACTIVE]" : "";
    const description = `${snippet}${override}`;
    const pubDate = new Date(b.generated_at).toUTCString();

    return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(description)}</description>
      <category>Macro Regime</category>
      <category>${escapeXml(label)}</category>
    </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Macro Bias — Daily Regime Briefings</title>
    <link>${escapeXml(appUrl)}</link>
    <description>Daily macro regime scoring and briefings for day traders. Algorithmic bias signals across SPY, TLT, GLD, USO, and HYG.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${escapeXml(appUrl)}/feed.xml" rel="self" type="application/rss+xml" />
    <image>
      <url>${escapeXml(appUrl)}/icon.png</url>
      <title>Macro Bias</title>
      <link>${escapeXml(appUrl)}</link>
    </image>
${items.join("\n")}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
    },
  });
}
