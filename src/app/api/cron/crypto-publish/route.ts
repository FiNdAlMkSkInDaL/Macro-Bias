import { timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { TwitterApi } from "twitter-api-v2";

import {
  generateCryptoDailyBriefing,
  persistCryptoBriefing,
} from "@/lib/crypto-briefing/crypto-brief-generator";
import { upsertCryptoMarketData } from "@/lib/crypto-market-data/upsert-crypto-market-data";
import { latestCompletedCryptoTradeDate } from "@/lib/crypto-market-data/crypto-session";
import { claimCryptoPublication, finishCryptoPublication, sendCryptoEmailOnce, type CryptoPublicationClaim } from "@/lib/crypto-briefing/crypto-delivery";
import {
  isSubscriptionActive,
  type SubscriptionStatus,
} from "@/lib/billing/subscription";
import { filterSubscribedEmailRecipients } from '@/lib/marketing/email-preferences';
import {
  formatAddressList,
  isUnverifiedTestSender,
  partitionRecipients,
} from '@/lib/marketing/recipient-policy';
import { partitionUnlockedSubscribers } from "@/lib/referral/premium-unlock";
import { verifyPendingReferrals } from "@/lib/referral/verify-referrals";
import { getAppUrl, getRequiredServerEnv } from "@/lib/server-env";
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
const DELIVERY_BUDGET_MS = 270_000;
const REFERRAL_TAIL_BUDGET_MS = 285_000;
const CRYPTO_DATABASE_TIMEOUT_MS = 5_000;

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

function ensureCryptoRuntimeBudget(deadlineAt: number) {
  if (Date.now() >= deadlineAt) throw new Error("Crypto publication runtime budget exhausted; delivery can resume safely.");
}

function createCryptoAdminClient(deadlineAt: number) {
  // Scope network bounds to this crypto job without changing shared admin/auth behavior.
  return createClient(getRequiredServerEnv("NEXT_PUBLIC_SUPABASE_URL"), getRequiredServerEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: async (input, init) => {
      ensureCryptoRuntimeBudget(deadlineAt);
      const timeout = AbortSignal.timeout(Math.ceil(Math.min(CRYPTO_DATABASE_TIMEOUT_MS, deadlineAt - Date.now())));
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      return fetch(input, { ...init, signal });
    } },
  });
}

async function getRecentCryptoSnapshots(deadlineAt: number): Promise<CryptoBiasScoreRow[]> {
  const supabase = createCryptoAdminClient(deadlineAt);
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

async function getCryptoBriefingForDate(tradeDate: string, deadlineAt: number) {
  const supabase = createCryptoAdminClient(deadlineAt);
  const { data, error } = await supabase
    .from("crypto_daily_briefings")
    .select("id, brief_content, score, bias_label, is_override_active, created_at")
    .eq("trade_date", tradeDate)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to check existing crypto briefing: ${error.message}`);
  return data;
}

function snapshotToBiasResult(row: CryptoBiasScoreRow): CryptoDailyBiasResult {
  const engine = (row.engine_inputs ?? {}) as Record<string, unknown>;
  const storedSignal = engine.tradableSignal as CryptoDailyBiasResult["signal"] | undefined;

  return {
    tradeDate: row.trade_date,
    score: row.score,
    label: row.bias_label,
    componentScores: row.component_scores ?? [],
    tickerChanges: row.ticker_changes ?? ({} as CryptoDailyBiasResult["tickerChanges"]),
    signal: storedSignal ?? {
      position: "FLAT",
      size: 0,
      reliability: "C",
      neighborAgreement: 0,
      meanNeighborDistance: 0,
      distanceQuality: 0,
      noTrade: false,
      reason: "Legacy score without tradable signal metadata.",
    },
    blendedForwardReturn:
      typeof engine.blendedForwardReturn === "number" ? engine.blendedForwardReturn : 0,
    modelVersion:
      typeof engine.modelVersion === "string" ? engine.modelVersion : "crypto-model-legacy",
  };
}

/* ------------------------------------------------------------------ */
/*  Email HTML builder                                                 */
/* ------------------------------------------------------------------ */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseCryptoEmailSections(copy: string): Array<{ title: string; content: string }> {
  const HEADERS = ["REGIME STATUS", "MARKET MAP", "RISK FRAME", "MODEL CONTEXT"];
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

function buildCryptoBriefingEmailHtml(
  newsletterCopy: string,
  score: number,
  label: BiasLabel,
): string {
  const signedScore = score > 0 ? `+${score}` : `${score}`;
  const labelText = label.replace(/_/g, " ");
  const scoreColor =
    label === "EXTREME_RISK_ON" || label === "RISK_ON" ? "#4ade80"
    : label === "EXTREME_RISK_OFF" || label === "RISK_OFF" ? "#fb923c"
    : "#fbbf24";

  const sections = parseCryptoEmailSections(newsletterCopy);
  const sectionHtml = sections.map((s, i) => {
    const colors: Record<string, string> = {
      "REGIME STATUS": "#7dd3fc",
      "MARKET MAP": "#a78bfa",
      "RISK FRAME": "#fb923c",
      "MODEL CONTEXT": "#6ee7b7",
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
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#64748b;-webkit-text-fill-color:#64748b;">Base Score</p>
      <p style="margin:0;font-size:28px;font-weight:700;color:${scoreColor};-webkit-text-fill-color:${scoreColor};letter-spacing:-0.02em;">
        ${escapeHtml(labelText)} <span style="font-size:20px;margin-left:8px;">(${escapeHtml(signedScore)})</span>
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

function buildFreeTierCryptoBriefingEmailHtml(
  newsletterCopy: string,
  score: number,
  label: BiasLabel,
): string {
  const signedScore = score > 0 ? `+${score}` : `${score}`;
  const labelText = label.replace(/_/g, " ");
  const referralPageUrl = escapeHtml(new URL("/refer", getAppUrl()).toString());
  const scoreColor =
    label === "EXTREME_RISK_ON" || label === "RISK_ON" ? "#4ade80"
    : label === "EXTREME_RISK_OFF" || label === "RISK_OFF" ? "#fb923c"
    : "#fbbf24";

  const sections = parseCryptoEmailSections(newsletterCopy);
  const regimeStatus = sections.find((s) => s.title === "REGIME STATUS");
  const marketMap = sections.find((s) => s.title === "MARKET MAP");

  const regimeStatusHtml = regimeStatus
    ? renderCryptoSectionHtml("REGIME STATUS", regimeStatus.content, "#7dd3fc", 0)
    : "";

  let marketPreviewHtml = "";
  if (marketMap) {
    const lines = marketMap.content.split("\n").filter((l) => l.trim());
    const firstLine = lines[0] ?? "";
    if (firstLine) {
      marketPreviewHtml = renderCryptoSectionHtml("MARKET MAP", firstLine, "#a78bfa", 28);
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
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#64748b;-webkit-text-fill-color:#64748b;">Base Score</p>
      <p style="margin:0;font-size:28px;font-weight:700;color:${scoreColor};-webkit-text-fill-color:${scoreColor};letter-spacing:-0.02em;">
        ${escapeHtml(labelText)} <span style="font-size:20px;margin-left:8px;">(${escapeHtml(signedScore)})</span>
      </p>
    </div>

    <!-- Body -->
    <div style="border:1px solid rgba(255,255,255,0.08);background:#18181b;padding:24px 20px;margin-bottom:4px;">
      ${regimeStatusHtml}
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

function buildCryptoBriefingEmailText(
  newsletterCopy: string,
  score: number,
  label: BiasLabel,
  tier: "free" | "premium",
): string {
  const signedScore = score > 0 ? `+${score}` : `${score}`;
  const sections = parseCryptoEmailSections(newsletterCopy);
  const visibleSections = tier === "premium"
    ? sections
    : sections.filter((section) => section.title === "REGIME STATUS" || section.title === "MARKET MAP")
      .map((section) => section.title === "MARKET MAP"
        ? { ...section, content: section.content.split("\n").find((line) => line.trim()) ?? "" }
        : section);
  return [
    "Daily Crypto Bias",
    `Base Score: ${label.replace(/_/g, " ")} (${signedScore})`,
    ...visibleSections.map((section) => `${section.title}\n${section.content.replace(/\*\*([^*]+)\*\*/g, "$1")}`),
    ...(tier === "free" ? [
      "Unlock the full crypto briefing with market breakdown, risk check, and model notes.",
      `START 7-DAY FREE TRIAL: ${new URL("/api/checkout?plan=monthly", getAppUrl()).toString()}`,
      "Refer & Earn: Invite 3 traders and unlock 7 days of Premium free. Hit 7 referrals for a free month. Hit 15 for a free annual plan.",
      `Get your referral link & rewards → ${new URL("/refer", getAppUrl()).toString()}`,
    ] : []),
    `macro-bias.com/crypto: ${new URL("/crypto/dashboard", getAppUrl()).toString()}`,
    "You're receiving this because you opted into Crypto Briefings.",
    "Unsubscribe: {{UNSUBSCRIBE_URL}}",
  ].join("\n\n");
}

const SOCIAL_PUBLISHING_ENABLED = false;
const DEFAULT_CRYPTO_FROM_ADDRESS = "Macro Bias <briefing@macro-bias.com>";
const CRYPTO_PREMIUM_RECIPIENT_PAGE_SIZE = 1000;

type BriefingRecipientRow = {
  email: string | null;
  subscription_status: SubscriptionStatus;
};

function getCryptoFromAddress() {
  return getOptionalServerEnv("RESEND_FROM_ADDRESS") ?? DEFAULT_CRYPTO_FROM_ADDRESS;
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
  tradeDate: string,
  deadlineAt: number,
) {
  ensureCryptoRuntimeBudget(deadlineAt);
  const resendApiKey = getOptionalServerEnv("RESEND_API_KEY");
  if (!resendApiKey) {
    const message = "RESEND_API_KEY is not configured, so the crypto email was not sent.";
    console.log(`[crypto-publish] ${message}`);
    return { premiumSent: 0, freeSent: 0, skipped: true, failure: message };
  }

  const supabase = createCryptoAdminClient(deadlineAt);

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
    return {
      premiumSent: 0,
      freeSent: 0,
      skipped: true,
      failure: `Failed to load crypto subscribers: ${freeError.message}`,
    };
  }

  const freeEmails = (subscribers ?? [])
    .map((r: { email: string | null }) => r.email?.trim())
    .filter((e): e is string => Boolean(e))
    .filter((e) => !premiumEmails.has(e.toLowerCase()));

  const freePartition = partitionRecipients(freeEmails);
  const premiumPartition = partitionRecipients(deliverablePremiumEmails);
  const rejectedAddresses = [...freePartition.rejected, ...premiumPartition.rejected].map(
    (entry) => entry.email,
  );

  if (rejectedAddresses.length > 0) {
    console.warn(`[crypto-publish] Resend rejects: ${formatAddressList(rejectedAddresses)}`);
    await supabase.from("free_subscribers").update({ status: "inactive" }).in("email", rejectedAddresses);
  }

  const { unlockedEmails, regularFreeEmails } = await partitionUnlockedSubscribers(
    supabase,
    freePartition.deliverable,
  );
  const premiumList = [...premiumPartition.deliverable, ...unlockedEmails];
  const freeList = regularFreeEmails;

  if (premiumList.length === 0 && freeList.length === 0) {
    const message = rejectedAddresses.length
      ? `Crypto email was not sent. Resend rejects: ${formatAddressList(rejectedAddresses)}.`
      : "Crypto email was not sent. No recipients are on the list.";
    console.warn(`[crypto-publish] ${message}`);
    return { premiumSent: 0, freeSent: 0, skipped: false, failure: message };
  }

  const { Resend } = await import("resend");
  const resend = new Resend(resendApiKey);

  const signedLabel = score > 0 ? `+${score}` : `${score}`;
  const subject = `Crypto Bias: ${label.replace(/_/g, " ")} (${signedLabel}) — ${tradeDate} UTC`;
  const dateContext = `Based on the completed ${tradeDate} UTC daily candle. Bitcoin trades every day.`;
  const premiumHtml = buildCryptoBriefingEmailHtml(newsletterCopy, score, label).replace('<!-- Footer -->', `<p style="color:#94a3b8;font-size:12px;line-height:1.6;">${escapeHtml(dateContext)}</p><!-- Footer -->`);
  const freeHtml = buildFreeTierCryptoBriefingEmailHtml(newsletterCopy, score, label).replace('<!-- Footer -->', `<p style="color:#94a3b8;font-size:12px;line-height:1.6;">${escapeHtml(dateContext)}</p><!-- Footer -->`);
  const premiumText = `${dateContext}\n\n${buildCryptoBriefingEmailText(newsletterCopy, score, label, "premium")}`;
  const freeText = `${dateContext}\n\n${buildCryptoBriefingEmailText(newsletterCopy, score, label, "free")}`;
  const fromAddress = getCryptoFromAddress();
  const deliverableAddresses = [...premiumList, ...freeList];

  if (isUnverifiedTestSender(fromAddress)) {
    const message = `Resend is still on the shared test sender (${fromAddress}). A verified sending domain is required before real customers. The crypto batch was not sent. Addresses not sent: ${formatAddressList(deliverableAddresses)}.`;
    console.warn(`[crypto-publish] ${message}`);
    return { premiumSent: 0, freeSent: 0, skipped: false, failure: message };
  }

  async function sendCryptoBatches(recipients: string[], html: string, text: string) {
    let sent = 0;
    let alreadyAccepted = 0;
    for (const email of [...new Set(recipients.map(value => value.trim().toLowerCase()))]) {
      if (Date.now() >= deadlineAt) {
        return { sent, alreadyAccepted, failure: "Crypto delivery runtime budget exhausted; remaining recipients can resume safely." };
      }
      try {
        const unsubUrl = buildUnsubscribeUrl(email);
        const result = await sendCryptoEmailOnce({ tradeDate, recipient: email, resend, deadlineAt, payload: {
          from: fromAddress, to: [email], subject,
          html: html.replaceAll("{{UNSUBSCRIBE_URL}}", escapeHtml(unsubUrl)),
          text: text.replaceAll("{{UNSUBSCRIBE_URL}}", unsubUrl),
          headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        } });
        if (result.status === "accepted") sent += 1;
        else if (result.status === "already_accepted") alreadyAccepted += 1;
        else {
          const failure = `Crypto email delivery is ${result.status}; a durable receipt is required before completion.`;
          return { sent, alreadyAccepted, failure };
        }
      } catch {
        return { sent, alreadyAccepted, failure: "Crypto delivery claim or provider request failed; retry preserves the stored payload." };
      }
    }
    return { sent, alreadyAccepted, failure: null };
  }

  const premiumRecipients = premiumList;
  const premiumDispatch = premiumRecipients.length
    ? await sendCryptoBatches(premiumRecipients, premiumHtml, premiumText)
    : { sent: 0, alreadyAccepted: 0, failure: null };
  if (premiumDispatch.failure) {
    return { premiumSent: premiumDispatch.sent, freeSent: 0, alreadyAccepted: premiumDispatch.alreadyAccepted, skipped: false, failure: premiumDispatch.failure };
  }

  const freeRecipients = freeList;
  const freeDispatch = freeRecipients.length
    ? await sendCryptoBatches(freeRecipients, freeHtml, freeText)
    : { sent: 0, alreadyAccepted: 0, failure: null };

  if (!freeDispatch.failure) {
    console.log(
      `[crypto-publish] Emailed ${premiumDispatch.sent} premium and ${freeDispatch.sent} free crypto subscribers.`,
    );
  }

  return {
    premiumSent: premiumDispatch.sent,
    freeSent: freeDispatch.sent,
    alreadyAccepted: premiumDispatch.alreadyAccepted + freeDispatch.alreadyAccepted,
    skipped: false,
    failure: freeDispatch.failure,
  };
}

/* ------------------------------------------------------------------ */
/*  Social posting (X + Bluesky)                                       */
/* ------------------------------------------------------------------ */

function buildCryptoXText(
  score: number,
  label: BiasLabel,
  newsletterCopy: string,
  permissionLine?: string | null,
): string {
  const signedScore = score > 0 ? `+${score}` : `${score}`;
  const labelText = label.replace(/_/g, " ");

  // Extract the BOTTOM LINE from the newsletter copy for a concise summary
  const bottomLineMatch = newsletterCopy.match(/REGIME STATUS[:\s]*\n?([\s\S]*?)(?=\n\s*(?:MARKET MAP|RISK FRAME|MODEL CONTEXT)|$)/i);
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
    permissionLine
      ? `Crypto Bias: ${permissionLine}`
      : `Daily Crypto Bias: ${signedScore} (${labelText})`,
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
  permissionLine?: string | null,
): Promise<{ xPosted: boolean; blueskyPosted: boolean; telegramPosted: boolean; threadsPosted: boolean }> {
  if (!SOCIAL_PUBLISHING_ENABLED) {
    return { xPosted: false, blueskyPosted: false, telegramPosted: false, threadsPosted: false };
  }

  const xText = buildCryptoXText(score, label, newsletterCopy, permissionLine);
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
  let publicationClaim: CryptoPublicationClaim | null = null;
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const runStartedAt = Date.now();
    const deliveryDeadlineAt = runStartedAt + DELIVERY_BUDGET_MS;
    if (getOptionalServerEnv("SHADOW_RUN_EMAIL")) {
      throw new Error("Shadow email routing must be disabled before running the crypto service.");
    }
    const skipEmail = request.nextUrl.searchParams.get("skipEmail") === "true";
    const expectedTradeDate = latestCompletedCryptoTradeDate();
    const warnings: string[] = [];
    publicationClaim = await claimCryptoPublication(expectedTradeDate, deliveryDeadlineAt);
    if (publicationClaim.completed) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Crypto publication and delivery already completed.", tradeDate: expectedTradeDate });
    }
    if (!publicationClaim.claimed) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Crypto publication is already running.", tradeDate: expectedTradeDate }, { status: 202 });
    }

    /* Step 1: Upsert crypto market data */
    try {
      console.log("[crypto-publish] Starting upsertCryptoMarketData()");
      const result = await upsertCryptoMarketData();
      console.log(`[crypto-publish] Finished upsertCryptoMarketData() — trade date ${result.tradeDate}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.warn(`[crypto-publish] upsertCryptoMarketData() failed: ${msg}`);
      warnings.push(`Market data sync failed: ${msg}`);
    }

    /* Step 2: Get latest snapshot */
    ensureCryptoRuntimeBudget(deliveryDeadlineAt);
    const snapshots = await getRecentCryptoSnapshots(deliveryDeadlineAt);
    const latestSnapshot = snapshots.find(row => row.trade_date === expectedTradeDate && isValidSnapshot(row));
    if (!latestSnapshot) throw new Error(`No valid stored crypto score for completed UTC day ${expectedTradeDate}.`);
    const biasResult = snapshotToBiasResult(latestSnapshot);
    const { data: completedPrice, error: completedPriceError } = await createCryptoAdminClient(deliveryDeadlineAt)
      .from("etf_daily_prices").select("trade_date").eq("ticker", "BTC-USD").eq("trade_date", expectedTradeDate).maybeSingle();
    if (completedPriceError || completedPrice?.trade_date !== expectedTradeDate) {
      throw new Error(`The completed BTC candle for ${expectedTradeDate} is unavailable; publication was withheld.`);
    }
    let storedBriefing = await getCryptoBriefingForDate(expectedTradeDate, deliveryDeadlineAt);

    /* Step 3: Generate and persist briefing */
    let briefingGeneratedBy = "stored";
    if (!storedBriefing) {
      ensureCryptoRuntimeBudget(deliveryDeadlineAt);
      const generated = await generateCryptoDailyBriefing(biasResult);
      briefingGeneratedBy = generated.generatedBy;
      warnings.push(...generated.warnings);
      console.log(
        `[crypto-publish] Generated briefing via ${generated.generatedBy}, override=${generated.isOverrideActive}`,
      );

      ensureCryptoRuntimeBudget(deliveryDeadlineAt);
      await persistCryptoBriefing(
        latestSnapshot.trade_date,
        latestSnapshot.score,
        latestSnapshot.bias_label,
        generated.newsletterCopy,
        generated.isOverrideActive,
      );
      storedBriefing = await getCryptoBriefingForDate(expectedTradeDate, deliveryDeadlineAt);
      console.log(`[crypto-publish] Persisted crypto briefing for ${latestSnapshot.trade_date}`);
    }
    if (!storedBriefing?.brief_content || storedBriefing.score !== latestSnapshot.score || storedBriefing.bias_label !== latestSnapshot.bias_label) {
      throw new Error("The persisted crypto briefing does not match its stored score; delivery was withheld.");
    }

    const { formatSignalSocialLine } = await import(
      "../../../../lib/signal/format-tradable-signal"
    );
    const permissionLine = formatSignalSocialLine(
      biasResult.signal,
      latestSnapshot.score,
    );

    /* Step 4: Email dispatch, only after a stored score exists for the latest session. */
    let emailResult: { premiumSent: number; freeSent: number; skipped: boolean; failure?: string | null; alreadyAccepted?: number } = {
      premiumSent: 0,
      freeSent: 0,
      skipped: true,
      failure: null,
    };
    let emailBlockedReason: string | null = null;
    if (!skipEmail) {
      const scoreCheck = createCryptoAdminClient(deliveryDeadlineAt);
      const { data: latestPrice, error: priceError } = await scoreCheck
        .from("etf_daily_prices")
        .select("trade_date")
        .eq("ticker", "BTC-USD")
        .lte("trade_date", expectedTradeDate)
        .order("trade_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (priceError) {
        emailBlockedReason = `Email skipped: could not read the latest BTC session (${priceError.message}).`;
      } else if (!latestPrice?.trade_date || latestSnapshot.trade_date !== latestPrice.trade_date) {
        emailBlockedReason = `Email skipped: no stored crypto score for ${latestPrice?.trade_date ?? "the latest trade date"}.`;
      }
    }

    if (skipEmail) {
      warnings.push("Email skipped: skipEmail param set.");
    } else if (emailBlockedReason) {
      warnings.push(emailBlockedReason);
    } else {
      emailResult = await dispatchCryptoBriefingEmails(
        storedBriefing.brief_content,
        latestSnapshot.score,
        latestSnapshot.bias_label,
        expectedTradeDate,
        deliveryDeadlineAt,
      );
      if (emailResult.failure) {
        warnings.push(emailResult.failure);
      }
    }

    /* Step 5: Social posting (X + Bluesky + Telegram) */
    let socialResult = { xPosted: false, blueskyPosted: false, telegramPosted: false, threadsPosted: false };
    try {
      socialResult = await publishCryptoToSocial(
        latestSnapshot.score,
        latestSnapshot.bias_label,
        storedBriefing.brief_content,
        permissionLine,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      warnings.push(`Social posting failed: ${msg}`);
    }

    const cryptoEmailsSent = emailResult.premiumSent + emailResult.freeSent;
    const emailFailed =
      !skipEmail &&
      Boolean(emailBlockedReason || emailResult.failure || cryptoEmailsSent + (emailResult.alreadyAccepted ?? 0) === 0);
    await finishCryptoPublication(publicationClaim, emailFailed ? "failed" : skipEmail ? "published" : "completed", {
      tradeDate: expectedTradeDate, publishedAt: storedBriefing.created_at,
      premiumAccepted: emailResult.premiumSent, freeAccepted: emailResult.freeSent,
      alreadyAccepted: emailResult.alreadyAccepted ?? 0, emailSkipped: skipEmail,
    });

    // Ancillary rewards run only after mail completion is durable. Their shared
    // Stripe/Resend/analytics dependencies retain their existing network behavior.
    if (!skipEmail && !emailFailed && !emailResult.skipped) {
      const referralDeadlineAt = runStartedAt + REFERRAL_TAIL_BUDGET_MS;
      if (Date.now() >= referralDeadlineAt) {
        warnings.push("Referral verification deferred: crypto runtime budget exhausted.");
      } else {
        try { await verifyPendingReferrals(createCryptoAdminClient(referralDeadlineAt)); }
        catch { warnings.push("Referral verification did not complete; pending referrals can retry later."); }
      }
    }

    return NextResponse.json({
      ok: !emailFailed,
      emailSent: !skipEmail && !emailBlockedReason && cryptoEmailsSent > 0 && !emailResult.failure,
      tradeDate: latestSnapshot.trade_date,
      score: latestSnapshot.score,
      biasLabel: latestSnapshot.bias_label,
      briefingGeneratedBy,
      overrideActive: storedBriefing.is_override_active,
      publishedAt: storedBriefing.created_at,
      candleDate: expectedTradeDate,
      deliveryStatus: emailFailed ? "failed" : skipEmail ? "skipped" : "provider_accepted",
      alreadyAccepted: emailResult.alreadyAccepted ?? 0,
      premiumEmailsSent: emailResult.premiumSent,
      freeEmailsSent: emailResult.freeSent,
      xPosted: socialResult.xPosted,
      blueskyPosted: socialResult.blueskyPosted,
      telegramPosted: socialResult.telegramPosted,
      threadsPosted: socialResult.threadsPosted,
      warnings,
    }, { status: emailFailed ? 500 : 200 });
  } catch (error) {
    if (publicationClaim?.claimed) {
      try { await finishCryptoPublication(publicationClaim, "failed", { failure: "Publication did not complete." }); } catch { /* Fail closed: lease/recipient receipts remain durable. */ }
    }
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
