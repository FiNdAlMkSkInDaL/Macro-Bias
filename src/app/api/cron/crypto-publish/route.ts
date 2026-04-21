import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { TwitterApi } from "twitter-api-v2";

import {
  generateCryptoDailyBriefing,
  persistCryptoBriefing,
} from "@/lib/crypto-briefing/crypto-brief-generator";
import { upsertCryptoMarketData } from "@/lib/crypto-market-data/upsert-crypto-market-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  isSubscriptionActive,
  type SubscriptionStatus,
} from "@/lib/billing/subscription";
import { filterSubscribedEmailRecipients } from '@/lib/marketing/email-preferences';
import { partitionUnlockedSubscribers } from "@/lib/referral/premium-unlock";
import { verifyPendingReferrals } from "@/lib/referral/verify-referrals";
import { getAppUrl } from "@/lib/server-env";
import { isBlueskyConfigured, publishToBluesky } from "@/lib/social/bluesky";
import { sanitizeForSocial } from "@/lib/social/sanitize";
import { isTelegramConfigured, publishToTelegram } from "@/lib/social/telegram";
import { formatForThreads } from "@/lib/social/threads-format";
import { isThreadsConfigured, publishToThreads } from "@/lib/social/threads";
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
      const inner = escapeHtml(trimmed.slice(2)).replace(/\*\*(.*?)\*\*/g, "<strong style='color:#f1f5f9;-webkit-text-fill-color:#f1f5f9;'>$1</strong>");
      return `<li style="margin-bottom:10px;color:#cbd5e1;-webkit-text-fill-color:#cbd5e1;font-size:15px;line-height:1.7;">${inner}</li>`;
    }
    const para = escapeHtml(trimmed).replace(/\*\*(.*?)\*\*/g, "<strong style='color:#f1f5f9;-webkit-text-fill-color:#f1f5f9;'>$1</strong>");
    return `<p style="margin:0 0 12px;color:#cbd5e1;-webkit-text-fill-color:#cbd5e1;font-size:15px;line-height:1.7;">${para}</p>`;
  });

  const hasBullets = lines.some((l) => l.trim().startsWith("- "));
  const body = hasBullets
    ? `<ul style="margin:0;padding-left:20px;">${rendered.filter(Boolean).join("")}</ul>`
    : rendered.filter(Boolean).join("");

  return `
<div style="margin-top:${marginTop}px;${marginTop > 0 ? 'padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);' : ''}">
  <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:${titleColor};-webkit-text-fill-color:${titleColor};">
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
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    html, body { background-color: #09090b !important; color: #e4e4e7 !important; }
    body, table, td, div, p, a, span, li { -webkit-text-size-adjust: 100% !important; }
    @media (prefers-color-scheme: dark) {
      html, body { background-color: #09090b !important; color: #e4e4e7 !important; }
    }
    @media (prefers-color-scheme: light) {
      html, body { background-color: #09090b !important; color: #e4e4e7 !important; }
    }
    [data-ogsc] body { background-color: #09090b !important; color: #e4e4e7 !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#09090b;color:#e4e4e7;-webkit-text-fill-color:#e4e4e7;font-family:ui-sans-serif,system-ui,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="border:1px solid rgba(255,255,255,0.08);background:#18181b;padding:24px 20px;margin-bottom:4px;">
      <p style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#52525b;-webkit-text-fill-color:#52525b;">
        Daily Crypto Bias
      </p>
      <p style="margin:0;font-size:28px;font-weight:700;color:${scoreColor};-webkit-text-fill-color:${scoreColor};letter-spacing:-0.02em;">
        ${escapeHtml(labelText)}
        <span style="font-size:20px;margin-left:8px;">(${escapeHtml(signedScore)})</span>
      </p>
    </div>

    <!-- Body -->
    <div style="border:1px solid rgba(255,255,255,0.08);background:#18181b;padding:24px 20px;margin-bottom:4px;">
      ${sectionHtml}
    </div>

    <!-- Footer -->
    <div style="padding:20px 0;text-align:center;">
      <p style="margin:0 0 8px;font-size:11px;color:#3f3f46;-webkit-text-fill-color:#3f3f46;">
        <a href="https://macro-bias.com/crypto/dashboard" style="color:#7dd3fc;-webkit-text-fill-color:#7dd3fc;text-decoration:none;">macro-bias.com/crypto</a>
      </p>
      <p style="margin:0;font-size:10px;color:#3f3f46;-webkit-text-fill-color:#3f3f46;">
        You're receiving this because you opted into Crypto Briefings.
      </p>
      <p style="margin:8px 0 0;font-size:10px;color:#3f3f46;-webkit-text-fill-color:#3f3f46;">
        <a href="{{UNSUBSCRIBE_URL}}" style="color:#52525b;-webkit-text-fill-color:#52525b;text-decoration:underline;">Unsubscribe</a>
      </p>
    </div>

  </div>
</body>
</html>`;
}

function buildFreeTierCryptoBriefingEmailHtml(newsletterCopy: string, score: number, label: BiasLabel): string {
  const signedScore = score > 0 ? `+${score}` : `${score}`;
  const labelText = label.replace(/_/g, " ");
  const referralPageUrl = escapeHtml(new URL("/refer", getAppUrl()).toString());
  const scoreColor =
    label === "EXTREME_RISK_ON" || label === "RISK_ON" ? "#4ade80"
    : label === "EXTREME_RISK_OFF" || label === "RISK_OFF" ? "#fb923c"
    : "#fbbf24";

  const sections = parseCryptoEmailSections(newsletterCopy);
  const bottomLine = sections.find((s) => s.title === "BOTTOM LINE");
  const marketBreakdown = sections.find((s) => s.title === "MARKET BREAKDOWN");

  // Render bottom line section
  const bottomLineHtml = bottomLine
    ? renderCryptoSectionHtml("BOTTOM LINE", bottomLine.content, "#7dd3fc", 0)
    : "";

  // Render first bullet/paragraph of market breakdown
  let marketPreviewHtml = "";
  if (marketBreakdown) {
    const lines = marketBreakdown.content.split("\n").filter((l) => l.trim());
    const firstLine = lines[0] ?? "";
    if (firstLine) {
      marketPreviewHtml = renderCryptoSectionHtml("MARKET BREAKDOWN", firstLine, "#a78bfa", 28);
    }
  }

  const upgradeUrl = escapeHtml(new URL("/api/checkout?plan=monthly", getAppUrl()).toString());

  const paywallHtml = `
<div style="margin-top:28px;border:1px solid #38bdf8;border-radius:12px;padding:24px;background:linear-gradient(135deg, rgba(56,189,248,0.12) 0%, rgba(9,9,11,0.96) 60%);">
  <p style="margin:0;color:#7dd3fc;-webkit-text-fill-color:#7dd3fc;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;">Premium Access Required</p>
  <p style="margin:12px 0 0;color:#f8fafc;-webkit-text-fill-color:#f8fafc;font-size:18px;font-weight:700;">Unlock the full crypto briefing with market breakdown, risk check, and model notes.</p>
  <a href="${upgradeUrl}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#0ea5e9;color:#fff;-webkit-text-fill-color:#fff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;border-radius:8px;">START 7-DAY FREE TRIAL</a>
</div>`;
  const referralWidgetHtml = `
<div style="margin-top:24px;padding:16px 20px;border:1px solid rgba(56,189,248,0.2);border-radius:8px;background:rgba(56,189,248,0.04);text-align:center;">
  <p style="margin:0;color:#7dd3fc;-webkit-text-fill-color:#7dd3fc;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">Refer &amp; Earn</p>
  <p style="margin:6px 0 0;color:#e2e8f0;-webkit-text-fill-color:#e2e8f0;font-size:14px;line-height:1.6;">Invite 3 traders and unlock 7 days of Premium free. Hit 7 referrals for a free month. Hit 15 for a free annual plan.</p>
  <a href="${referralPageUrl}" style="display:inline-block;margin-top:10px;color:#38bdf8;-webkit-text-fill-color:#38bdf8;font-size:12px;font-weight:600;text-decoration:underline;">Get your referral link & rewards &rarr;</a>
</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    html, body { background-color: #09090b !important; color: #e4e4e7 !important; }
    body, table, td, div, p, a, span, li { -webkit-text-size-adjust: 100% !important; }
    @media (prefers-color-scheme: dark) {
      html, body { background-color: #09090b !important; color: #e4e4e7 !important; }
    }
    @media (prefers-color-scheme: light) {
      html, body { background-color: #09090b !important; color: #e4e4e7 !important; }
    }
    [data-ogsc] body { background-color: #09090b !important; color: #e4e4e7 !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#09090b;color:#e4e4e7;-webkit-text-fill-color:#e4e4e7;font-family:ui-sans-serif,system-ui,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="border:1px solid rgba(255,255,255,0.08);background:#18181b;padding:24px 20px;margin-bottom:4px;">
      <p style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#52525b;-webkit-text-fill-color:#52525b;">
        Daily Crypto Bias
      </p>
      <p style="margin:0;font-size:28px;font-weight:700;color:${scoreColor};-webkit-text-fill-color:${scoreColor};letter-spacing:-0.02em;">
        ${escapeHtml(labelText)}
        <span style="font-size:20px;margin-left:8px;">(${escapeHtml(signedScore)})</span>
      </p>
    </div>

    <!-- Body -->
    <div style="border:1px solid rgba(255,255,255,0.08);background:#18181b;padding:24px 20px;margin-bottom:4px;">
      ${bottomLineHtml}
      ${marketPreviewHtml}
      ${paywallHtml}
    </div>

    ${referralWidgetHtml}

    <!-- Footer -->
    <div style="padding:20px 0;text-align:center;">
      <p style="margin:0 0 8px;font-size:11px;color:#3f3f46;-webkit-text-fill-color:#3f3f46;">
        <a href="https://macro-bias.com/crypto/dashboard" style="color:#7dd3fc;-webkit-text-fill-color:#7dd3fc;text-decoration:none;">macro-bias.com/crypto</a>
      </p>
      <p style="margin:0;font-size:10px;color:#3f3f46;-webkit-text-fill-color:#3f3f46;">
        You're receiving this because you opted into Crypto Briefings.
      </p>
      <p style="margin:8px 0 0;font-size:10px;color:#3f3f46;-webkit-text-fill-color:#3f3f46;">
        <a href="{{UNSUBSCRIBE_URL}}" style="color:#52525b;-webkit-text-fill-color:#52525b;text-decoration:underline;">Unsubscribe</a>
      </p>
    </div>

  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Email dispatch to crypto subscribers (tiered)                      */
/* ------------------------------------------------------------------ */

const CRYPTO_EMAIL_BATCH_SIZE = 100;
const DEFAULT_CRYPTO_FROM_ADDRESS = "Macro Bias <briefing@macro-bias.com>";
const CRYPTO_PREMIUM_RECIPIENT_PAGE_SIZE = 1000;

type BriefingRecipientRow = {
  email: string | null;
  subscription_status: SubscriptionStatus;
};

function getCryptoFromAddress() {
  return getOptionalServerEnv("RESEND_FROM_ADDRESS") ?? DEFAULT_CRYPTO_FROM_ADDRESS;
}

function getShadowRunRecipient() {
  const configuredRecipient = process.env.SHADOW_RUN_EMAIL?.trim();
  return configuredRecipient || null;
}

function applyShadowRunOverride(emails: string[]) {
  const shadow = getShadowRunRecipient();
  if (!shadow) return emails;
  const normalized = shadow.toLowerCase();
  const match = emails.find((e) => e.toLowerCase() === normalized);
  console.log(`[crypto-publish] Shadow run override: forcing delivery to ${match ?? shadow}`);
  return [match ?? shadow];
}

function buildUnsubscribeUrl(email: string) {
  const url = new URL("/api/subscribe/unsubscribe", getAppUrl());
  url.searchParams.set("email", email);
  return url.toString();
}

async function dispatchCryptoBriefingEmails(
  newsletterCopy: string,
  score: number,
  label: BiasLabel,
) {
  const resendApiKey = getOptionalServerEnv("RESEND_API_KEY");
  if (!resendApiKey) {
    console.log("[crypto-publish] No RESEND_API_KEY configured; skipping email.");
    return { premiumSent: 0, freeSent: 0, skipped: true };
  }

  const supabase = createSupabaseAdminClient();

  /* --- Load premium recipients from users table --- */
  const premiumEmails = new Map<string, string>();
  for (let offset = 0; ; offset += CRYPTO_PREMIUM_RECIPIENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("users")
      .select("email, subscription_status")
      .in("subscription_status", ["active", "trialing"])
      .not("email", "is", null)
      .order("email", { ascending: true })
      .range(offset, offset + CRYPTO_PREMIUM_RECIPIENT_PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to load premium recipients: ${error.message}`);
    const rows = (data as BriefingRecipientRow[] | null) ?? [];

    for (const row of rows) {
      if (typeof row.email !== "string") continue;
      const email = row.email.trim();
      if (!email) continue;
      if (isSubscriptionActive(row.subscription_status ?? "inactive")) {
        premiumEmails.set(email.toLowerCase(), email);
      }
    }

    if (rows.length < CRYPTO_PREMIUM_RECIPIENT_PAGE_SIZE) break;
  }

  const {
    deliverableEmails: deliverablePremiumEmails,
    unsubscribedEmails: unsubscribedPremiumEmails,
  } = await filterSubscribedEmailRecipients(supabase, [...premiumEmails.values()]);

  if (unsubscribedPremiumEmails.length > 0) {
    console.log(
      `[crypto-publish] Suppressed ${unsubscribedPremiumEmails.length} unsubscribed premium recipients.`,
    );
  }

  /* --- Load free crypto-opted-in subscribers, excluding premium --- */
  const { data: subscribers, error: freeError } = await supabase
    .from("free_subscribers")
    .select("email")
    .eq("status", "active")
    .eq("crypto_opted_in", true);

  if (freeError) {
    console.warn(`[crypto-publish] Failed to load crypto subscribers: ${freeError.message}`);
    return { premiumSent: 0, freeSent: 0, skipped: true };
  }

  const freeEmails = (subscribers ?? [])
    .map((r: { email: string | null }) => r.email?.trim())
    .filter((e): e is string => Boolean(e))
    .filter((e) => !premiumEmails.has(e.toLowerCase()));

  const { unlockedEmails, regularFreeEmails } = await partitionUnlockedSubscribers(
    supabase,
    freeEmails,
  );

  const premiumList = [...deliverablePremiumEmails, ...unlockedEmails];

  if (premiumList.length === 0 && regularFreeEmails.length === 0) {
    console.log("[crypto-publish] No crypto recipients found.");
    return { premiumSent: 0, freeSent: 0, skipped: false };
  }

  const { Resend } = await import("resend");
  const resend = new Resend(resendApiKey);

  const signedLabel = score > 0 ? `+${score}` : `${score}`;
  const subject = `Crypto Bias: ${label.replace(/_/g, " ")} (${signedLabel})`;
  const premiumHtml = buildCryptoBriefingEmailHtml(newsletterCopy, score, label);
  const freeHtml = buildFreeTierCryptoBriefingEmailHtml(newsletterCopy, score, label);
  const fromAddress = getCryptoFromAddress();

  let premiumSent = 0;
  let freeSent = 0;

  /* --- Dispatch premium emails --- */
  const premiumRecipients = applyShadowRunOverride(premiumList);
  if (premiumRecipients.length > 0) {
    for (let i = 0; i < premiumRecipients.length; i += CRYPTO_EMAIL_BATCH_SIZE) {
      const batch = premiumRecipients.slice(i, i + CRYPTO_EMAIL_BATCH_SIZE);
      try {
        const response = await resend.batch.send(
          batch.map((email) => {
            const unsubUrl = buildUnsubscribeUrl(email);
            return {
              from: fromAddress,
              to: [email],
              subject,
              html: premiumHtml.replaceAll("{{UNSUBSCRIBE_URL}}", escapeHtml(unsubUrl)),
              headers: {
                "List-Unsubscribe": `<${unsubUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            };
          }),
        );
        if (response.error) {
          console.warn(`[crypto-publish] Premium batch send failed: ${response.error.message}`);
        } else {
          premiumSent += batch.length;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        console.warn(`[crypto-publish] Premium batch email failed: ${msg}`);
      }
    }
    console.log(`[crypto-publish] Sent ${premiumSent} premium crypto emails.`);
  }

  /* --- Dispatch free emails --- */
  const freeRecipients = applyShadowRunOverride(regularFreeEmails);
  if (freeRecipients.length > 0) {
    for (let i = 0; i < freeRecipients.length; i += CRYPTO_EMAIL_BATCH_SIZE) {
      const batch = freeRecipients.slice(i, i + CRYPTO_EMAIL_BATCH_SIZE);
      try {
        const response = await resend.batch.send(
          batch.map((email) => {
            const unsubUrl = buildUnsubscribeUrl(email);
            return {
              from: fromAddress,
              to: [email],
              subject,
              html: freeHtml.replaceAll("{{UNSUBSCRIBE_URL}}", escapeHtml(unsubUrl)),
              headers: {
                "List-Unsubscribe": `<${unsubUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            };
          }),
        );
        if (response.error) {
          console.warn(`[crypto-publish] Free batch send failed: ${response.error.message}`);
        } else {
          freeSent += batch.length;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        console.warn(`[crypto-publish] Free batch email failed: ${msg}`);
      }
    }
    console.log(`[crypto-publish] Sent ${freeSent} free crypto emails.`);
  }

  console.log(`[crypto-publish] Emailed ${premiumSent} premium/unlocked + ${freeSent} free crypto subscribers.`);
  return { premiumSent, freeSent, skipped: false };
}

/* ------------------------------------------------------------------ */
/*  Social posting (X + Bluesky)                                       */
/* ------------------------------------------------------------------ */

function buildCryptoXText(score: number, label: BiasLabel, newsletterCopy: string): string {
  const signedScore = score > 0 ? `+${score}` : `${score}`;
  const labelText = label.replace(/_/g, " ");

  // Extract the BOTTOM LINE from the newsletter copy for a concise summary
  const bottomLineMatch = newsletterCopy.match(/BOTTOM LINE[:\s]*\n?([\s\S]*?)(?=\n\s*(?:MARKET BREAKDOWN|RISK CHECK|MODEL NOTES)|$)/i);
  let summaryLine = "";
  if (bottomLineMatch) {
    // Take first sentence of the bottom line
    const rawBottomLine = bottomLineMatch[1].trim();
    const firstSentence = rawBottomLine.split(/\.\s/)[0];
    if (firstSentence && firstSentence.length <= 120) {
      summaryLine = sanitizeForSocial(firstSentence.endsWith(".") ? firstSentence : `${firstSentence}.`);
    }
  }

  const lines = [
    `Daily Crypto Bias: ${signedScore} (${labelText})`,
    summaryLine || null,
    `Free daily crypto briefing: https://www.macro-bias.com/emails?utm_source=x&utm_campaign=crypto`,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n\n");
}

type XCredentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

function getXCredentials(): XCredentials | null {
  const apiKey = getOptionalServerEnv("X_API_KEY");
  const apiSecret = getOptionalServerEnv("X_API_SECRET");
  const accessToken = getOptionalServerEnv("X_ACCESS_TOKEN");
  const accessSecret = getOptionalServerEnv("X_ACCESS_SECRET");
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}

async function publishCryptoToSocial(
  score: number,
  label: BiasLabel,
  newsletterCopy: string,
): Promise<{ xPosted: boolean; blueskyPosted: boolean; telegramPosted: boolean; threadsPosted: boolean }> {
  const xText = buildCryptoXText(score, label, newsletterCopy);
  let xPosted = false;
  let blueskyPosted = false;
  let telegramPosted = false;
  let threadsPosted = false;

  // Post to X
  const xCreds = getXCredentials();
  if (xCreds) {
    try {
      const client = new TwitterApi({
        appKey: xCreds.apiKey,
        appSecret: xCreds.apiSecret,
        accessToken: xCreds.accessToken,
        accessSecret: xCreds.accessSecret,
      });
      await client.v2.tweet(xText);
      xPosted = true;
      console.log("[crypto-publish] Posted to X.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.warn(`[crypto-publish] X post failed: ${msg}`);
    }
  }

  // Post to Bluesky
  if (isBlueskyConfigured()) {
    try {
      await publishToBluesky(xText);
      blueskyPosted = true;
      console.log("[crypto-publish] Posted to Bluesky.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.warn(`[crypto-publish] Bluesky post failed: ${msg}`);
    }
  }

  // Post to Telegram
  if (isTelegramConfigured()) {
    try {
      await publishToTelegram(xText);
      telegramPosted = true;
      console.log("[crypto-publish] Posted to Telegram.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.warn(`[crypto-publish] Telegram post failed: ${msg}`);
    }
  }

  // Post to Threads
  if (isThreadsConfigured()) {
    try {
      await publishToThreads(formatForThreads(xText));
      threadsPosted = true;
      console.log("[crypto-publish] Posted to Threads.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.warn(`[crypto-publish] Threads post failed: ${msg}`);
    }
  }

  return { xPosted, blueskyPosted, telegramPosted, threadsPosted };
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
    let emailResult = { premiumSent: 0, freeSent: 0, skipped: true };
    if (!skipEmail) {
      emailResult = await dispatchCryptoBriefingEmails(
        briefingResult.newsletterCopy,
        latestSnapshot.score,
        latestSnapshot.bias_label,
      );
      if (!emailResult.skipped) {
        await verifyPendingReferrals(createSupabaseAdminClient());
      }
    } else {
      warnings.push("Email skipped: skipEmail param set.");
    }

    /* Step 5: Social posting (X + Bluesky + Telegram) */
    let socialResult = { xPosted: false, blueskyPosted: false, telegramPosted: false, threadsPosted: false };
    try {
      socialResult = await publishCryptoToSocial(
        latestSnapshot.score,
        latestSnapshot.bias_label,
        briefingResult.newsletterCopy,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      warnings.push(`Social posting failed: ${msg}`);
    }

    return NextResponse.json({
      ok: true,
      tradeDate: latestSnapshot.trade_date,
      score: latestSnapshot.score,
      biasLabel: latestSnapshot.bias_label,
      briefingGeneratedBy: briefingResult.generatedBy,
      overrideActive: briefingResult.isOverrideActive,
      premiumEmailsSent: emailResult.premiumSent,
      freeEmailsSent: emailResult.freeSent,
      xPosted: socialResult.xPosted,
      blueskyPosted: socialResult.blueskyPosted,
      telegramPosted: socialResult.telegramPosted,
      threadsPosted: socialResult.threadsPosted,
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
