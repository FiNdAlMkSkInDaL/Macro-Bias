import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  generateCryptoDailyBriefing,
  persistCryptoBriefing,
} from "@/lib/crypto-briefing/crypto-brief-generator";
import { upsertCryptoMarketData } from "@/lib/crypto-market-data/upsert-crypto-market-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  BiasLabel,
  CryptoBiasScoreRow,
  CryptoDailyBiasResult,
} from "@/lib/crypto-bias/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const revalidate = 0;

const MAX_HISTORY_ROWS = 60;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOptionalServerEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

function safeCompare(left: string, right: string) {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

function getProvidedCronSecret(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-cron-secret")?.trim() ?? null;
}

function isAuthorizedCronRequest(request: NextRequest) {
  const expected =
    getOptionalServerEnv("CRON_SECRET") ??
    getOptionalServerEnv("PUBLISH_CRON_SECRET");

  if (!expected) {
    throw new Error("Missing CRON_SECRET.");
  }

  const provided = getProvidedCronSecret(request);
  return Boolean(provided && safeCompare(provided, expected));
}

const VALID_BIAS_LABELS = new Set<BiasLabel>([
  "EXTREME_RISK_OFF",
  "RISK_OFF",
  "NEUTRAL",
  "RISK_ON",
  "EXTREME_RISK_ON",
]);

function isValidSnapshot(row: CryptoBiasScoreRow): boolean {
  return (
    VALID_BIAS_LABELS.has(row.bias_label) &&
    typeof row.score === "number" &&
    Number.isFinite(row.score)
  );
}

/* ------------------------------------------------------------------ */
/*  Supabase queries                                                   */
/* ------------------------------------------------------------------ */

async function getRecentCryptoSnapshots(): Promise<CryptoBiasScoreRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("crypto_bias_scores")
    .select(
      "id, trade_date, score, bias_label, component_scores, ticker_changes, engine_inputs, technical_indicators, created_at, updated_at",
    )
    .order("trade_date", { ascending: false })
    .limit(MAX_HISTORY_ROWS);

  if (error) throw error;
  return (data as CryptoBiasScoreRow[] | null) ?? [];
}

async function hasCryptoBriefingForDate(tradeDate: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("crypto_daily_briefings")
    .select("id")
    .eq("trade_date", tradeDate)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to check existing crypto briefing: ${error.message}`);
  return Boolean(data);
}

function snapshotToBiasResult(row: CryptoBiasScoreRow): CryptoDailyBiasResult {
  return {
    tradeDate: row.trade_date,
    score: row.score,
    label: row.bias_label,
    componentScores: row.component_scores ?? [],
    tickerChanges: row.ticker_changes ?? ({} as CryptoDailyBiasResult["tickerChanges"]),
  };
}

/* ------------------------------------------------------------------ */
/*  Email HTML builder                                                 */
/* ------------------------------------------------------------------ */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseCryptoEmailSections(copy: string): Array<{ title: string; content: string }> {
  const HEADERS = ["BOTTOM LINE", "MARKET BREAKDOWN", "RISK CHECK", "MODEL NOTES"];
  const lines = copy.split("\n");
  const sections: Array<{ title: string; content: string }> = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim().replace(/\*\*/g, "");
    const matched = HEADERS.find(
      (h) => trimmed.startsWith(h + ":") || trimmed === h,
    );
    if (matched) {
      if (current) sections.push({ title: current.title, content: current.lines.join("\n").trim() });
      const rest = trimmed.slice(matched.length).replace(/^:?\s*/, "");
      current = { title: matched, lines: rest ? [rest] : [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ title: current.title, content: current.lines.join("\n").trim() });
  return sections;
}

function renderCryptoSectionHtml(title: string, content: string, titleColor: string, marginTop: number): string {
  const lines = content.split("\n");
  const rendered = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    // Bullet list items
    if (trimmed.startsWith("- ")) {
      const inner = escapeHtml(trimmed.slice(2)).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      return `<li style="margin-bottom:6px;color:#cbd5e1;">${inner}</li>`;
    }
    const para = escapeHtml(trimmed).replace(/\*\*(.*?)\*\*/g, "<strong style='color:#f1f5f9;'>$1</strong>");
    return `<p style="margin:0 0 10px;color:#cbd5e1;font-size:14px;line-height:1.7;">${para}</p>`;
  });

  const hasBullets = lines.some((l) => l.trim().startsWith("- "));
  const body = hasBullets
    ? `<ul style="margin:0;padding-left:20px;">${rendered.filter(Boolean).join("")}</ul>`
    : rendered.filter(Boolean).join("");

  return `
<div style="margin-top:${marginTop}px;">
  <p style="margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:${titleColor};">
    ${escapeHtml(title)}
  </p>
  ${body}
</div>`;
}

function buildCryptoBriefingEmailHtml(newsletterCopy: string, score: number, label: BiasLabel): string {
  const signedScore = score > 0 ? `+${score}` : `${score}`;
  const labelText = label.replace(/_/g, " ");
  const scoreColor =
    label === "EXTREME_RISK_ON" || label === "RISK_ON" ? "#4ade80"
    : label === "EXTREME_RISK_OFF" || label === "RISK_OFF" ? "#fb923c"
    : "#fbbf24";

  const sections = parseCryptoEmailSections(newsletterCopy);
  const sectionHtml = sections.map((s, i) => {
    const colors: Record<string, string> = {
      "BOTTOM LINE": "#7dd3fc",
      "MARKET BREAKDOWN": "#a78bfa",
      "RISK CHECK": "#fb923c",
      "MODEL NOTES": "#6ee7b7",
    };
    return renderCryptoSectionHtml(s.title, s.content, colors[s.title] ?? "#94a3b8", i === 0 ? 0 : 28);
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#09090b;font-family:ui-sans-serif,system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="border:1px solid rgba(255,255,255,0.08);background:#18181b;padding:28px 32px;margin-bottom:4px;">
      <p style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#52525b;">
        [ Crypto Regime Briefing ]
      </p>
      <p style="margin:0;font-size:28px;font-weight:700;color:${scoreColor};letter-spacing:-0.02em;">
        ${escapeHtml(labelText)}
        <span style="font-size:20px;margin-left:8px;">(${escapeHtml(signedScore)})</span>
      </p>
    </div>

    <!-- Body -->
    <div style="border:1px solid rgba(255,255,255,0.08);background:#18181b;padding:28px 32px;margin-bottom:4px;">
      ${sectionHtml}
    </div>

    <!-- Footer -->
    <div style="padding:20px 0;text-align:center;">
      <p style="margin:0 0 8px;font-size:11px;color:#3f3f46;">
        <a href="https://macro-bias.com/crypto" style="color:#7dd3fc;text-decoration:none;">macro-bias.com/crypto</a>
      </p>
      <p style="margin:0;font-size:10px;color:#3f3f46;">
        You're receiving this because you opted into Crypto Briefings.
      </p>
    </div>

  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Email dispatch to crypto-opted-in subscribers                      */
/* ------------------------------------------------------------------ */

async function dispatchCryptoBriefingEmails(
  newsletterCopy: string,
  score: number,
  label: BiasLabel,
) {
  const resendApiKey = getOptionalServerEnv("RESEND_API_KEY");
  if (!resendApiKey) {
    console.log("[crypto-publish] No RESEND_API_KEY configured; skipping email.");
    return { sent: 0, skipped: true };
  }

  const supabase = createSupabaseAdminClient();
  const { data: subscribers, error } = await supabase
    .from("free_subscribers")
    .select("email")
    .eq("status", "active")
    .eq("crypto_opted_in", true);

  if (error) {
    console.warn(`[crypto-publish] Failed to load crypto subscribers: ${error.message}`);
    return { sent: 0, skipped: true };
  }

  const emails = (subscribers ?? [])
    .map((r: { email: string | null }) => r.email?.trim())
    .filter((e): e is string => Boolean(e));

  if (emails.length === 0) {
    console.log("[crypto-publish] No crypto-opted-in subscribers found.");
    return { sent: 0, skipped: false };
  }

  const { Resend } = await import("resend");
  const resend = new Resend(resendApiKey);

  const signedLabel = score > 0 ? `+${score}` : `${score}`;
  const subject = `[CRYPTO] ${label.replace(/_/g, " ")} (${signedLabel}) — Daily Crypto Bias`;
  const html = buildCryptoBriefingEmailHtml(newsletterCopy, score, label);

  const BATCH_SIZE = 50;
  let totalSent = 0;

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    try {
      await resend.emails.send({
        from: getOptionalServerEnv("RESEND_FROM_EMAIL") ?? "crypto@macrobias.io",
        to: batch,
        subject,
        html,
      });
      totalSent += batch.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.warn(`[crypto-publish] Batch email failed: ${msg}`);
    }
  }

  console.log(`[crypto-publish] Emailed ${totalSent} crypto subscribers.`);
  return { sent: totalSent, skipped: false };
}

/* ------------------------------------------------------------------ */
/*  Route handler                                                      */
/* ------------------------------------------------------------------ */

async function handleCryptoPublish(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const skipEmail = request.nextUrl.searchParams.get("skipEmail") === "true";
    const todayDate = new Date().toISOString().slice(0, 10);
    const warnings: string[] = [];

    /* Step 1: Upsert crypto market data */
    let upsertSucceeded = false;
    try {
      console.log("[crypto-publish] Starting upsertCryptoMarketData()");
      const result = await upsertCryptoMarketData();
      console.log(`[crypto-publish] Finished upsertCryptoMarketData() — trade date ${result.tradeDate}`);
      upsertSucceeded = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.warn(`[crypto-publish] upsertCryptoMarketData() failed: ${msg}`);
      warnings.push(`Market data sync failed: ${msg}`);
    }

    /* Step 2: Get latest snapshot */
    const snapshots = await getRecentCryptoSnapshots();
    if (snapshots.length === 0) {
      return NextResponse.json(
        {
          error: upsertSucceeded
            ? "No crypto bias snapshots available."
            : "Crypto market data sync failed and no cached snapshots.",
        },
        { status: 404 },
      );
    }

    let latestIdx = 0;
    while (latestIdx < snapshots.length && !isValidSnapshot(snapshots[latestIdx])) {
      latestIdx += 1;
    }
    if (latestIdx >= snapshots.length) {
      return NextResponse.json({ error: "No valid crypto bias snapshots found." }, { status: 404 });
    }

    const latestSnapshot = snapshots[latestIdx];
    const biasResult = snapshotToBiasResult(latestSnapshot);
    const briefingAlreadyExists = await hasCryptoBriefingForDate(latestSnapshot.trade_date);

    /* Step 3: Generate and persist briefing */
    let briefingResult;
    if (briefingAlreadyExists) {
      warnings.push("Re-publish: crypto briefing was already persisted.");
      briefingResult = await generateCryptoDailyBriefing(biasResult);
    } else {
      briefingResult = await generateCryptoDailyBriefing(biasResult);
      console.log(
        `[crypto-publish] Generated briefing via ${briefingResult.generatedBy}, override=${briefingResult.isOverrideActive}`,
      );

      await persistCryptoBriefing(
        latestSnapshot.trade_date,
        latestSnapshot.score,
        latestSnapshot.bias_label,
        briefingResult.newsletterCopy,
        briefingResult.isOverrideActive,
      );
      console.log(`[crypto-publish] Persisted crypto briefing for ${latestSnapshot.trade_date}`);
    }

    /* Step 4: Email dispatch */
    let emailResult = { sent: 0, skipped: true };
    if (!skipEmail) {
      emailResult = await dispatchCryptoBriefingEmails(
        briefingResult.newsletterCopy,
        latestSnapshot.score,
        latestSnapshot.bias_label,
      );
    } else {
      warnings.push("Email skipped: skipEmail param set.");
    }

    return NextResponse.json({
      ok: true,
      tradeDate: latestSnapshot.trade_date,
      score: latestSnapshot.score,
      biasLabel: latestSnapshot.bias_label,
      briefingGeneratedBy: briefingResult.generatedBy,
      overrideActive: briefingResult.isOverrideActive,
      emailsSent: emailResult.sent,
      warnings: [...warnings, ...briefingResult.warnings],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run crypto publish cron.";
    console.error(`[crypto-publish] Fatal: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleCryptoPublish(request);
}

export async function POST(request: NextRequest) {
  return handleCryptoPublish(request);
}
