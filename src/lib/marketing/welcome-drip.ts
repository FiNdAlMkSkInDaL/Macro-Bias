import "server-only";

import { Resend } from "resend";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppUrl, getRequiredServerEnv } from "@/lib/server-env";

const DEFAULT_FROM_ADDRESS = "Macro Bias <briefing@macro-bias.com>";
const EMAIL_BATCH_SIZE = 100;
const MORNING_DISPATCH_HOUR_UTC = 13;
const MORNING_DISPATCH_MINUTE_UTC = 5;
const WELCOME_DRIP_STEPS = [
  {
    ctaHref: "/track-record",
    ctaLabel: "See the track record",
    dayOffset: 0,
    eyebrow: "[ Welcome 01 ]",
    hook: "Most traders check the news, scan Twitter, and start clicking buttons. By then the market has already decided what kind of day it is. You just didn't know.",
    microChallenge: "Before your next session, check the daily bias score first. Then ask yourself: does my plan match the environment, or am I fighting it?",
    order: 1,
    secondaryHref: "/briefings",
    secondaryLabel: "Read a real briefing",
    subject: "Your daily market read starts tomorrow",
    summary:
      "You are on the list. Every morning before the bell, you will get one email with the market's directional bias, what is driving it, and what to watch for.",
    title: "Welcome to Macro Bias.",
    bullets: [
      "Backtested since 2020: +295% strategy return vs +116% for SPY buy-and-hold.",
      "One daily call: Risk-On, Neutral, or Risk-Off.",
      "90 seconds to read. Before you place a single trade.",
    ],
    paragraphs: [
      "This is not a hype newsletter. There are no hot stock picks, no urgent alerts, no breathless calls to action. Just a clear daily read on what the market is actually doing across stocks, bonds, commodities, and volatility.",
      "Start with the track record to see how the model has performed. Then read a couple of archived briefings to see the format. You will know in 10 minutes if this is useful to you.",
    ],
  },
  {
    ctaHref: "/briefings",
    ctaLabel: "See the workflow",
    dayOffset: 1,
    eyebrow: "[ Welcome 02 ]",
    hook: "The best traders are boring before the open. They already know the plan. The rest are scrambling to figure out what kind of day it is while the move is already happening.",
    microChallenge: "Tomorrow morning, try this: read the bias score before opening any charts. Decide if it is a day to push or a day to protect. Then see how the session plays out.",
    order: 2,
    secondaryHref: "/pricing",
    secondaryLabel: "See Premium features",
    subject: "The 90-second morning routine that changes how you trade",
    summary:
      "Here is the simplest way to use Macro Bias: read the score before the open, decide if the day favors offense or defense, and lock your plan before emotion gets involved.",
    title: "How to actually use this.",
    bullets: [
      "Step 1: Check the daily bias. Is it Risk-On, Neutral, or Risk-Off?",
      "Step 2: Read the sector breakdown. Where is the pressure, where are the leaders?",
      "Step 3: Size your trades to match the environment, not your gut.",
    ],
    paragraphs: [
      "Think of the daily briefing as a weather report for the market. You would not plan a beach day without checking the forecast. Same idea here. On strong days, it tells you to lean in. On rough days, it tells you to sit tight or go small.",
      "That one shift, matching your aggression to the environment, tends to improve consistency faster than any new indicator or signal service.",
      "One more thing: every subscriber gets a unique referral link. Three verified referrals unlock 7 days of Premium, 7 unlock a free month, and 15 unlock a free annual plan. Check your referral status at macro-bias.com/refer.",
    ],
  },
  {
    ctaHref: "/regime",
    ctaLabel: "See how it works",
    dayOffset: 3,
    eyebrow: "[ Welcome 03 ]",
    hook: "Most traders think they need better entries. What they actually need is to stop sizing up on the worst possible days.",
    microChallenge: "Look at your last 10 losses. How many happened on days when the broader market was already under pressure? The answer is usually more than you think.",
    order: 3,
    secondaryHref: "/track-record",
    secondaryLabel: "Check the results",
    subject: "The mistake that costs most traders the most money",
    summary:
      "Most traders do not blow up because they picked the wrong stock. They blow up because they traded too aggressively on a day that was working against them. Macro Bias was built to fix that.",
    title: "Why market conditions matter more than your setup.",
    bullets: [
      "A great setup in a bad environment still loses money more often than you would expect.",
      "A decent setup in a good environment is surprisingly forgiving.",
      "The difference between the two is what the model measures every day.",
    ],
    paragraphs: [
      "The model watches how stocks, bonds, commodities, and volatility are behaving relative to each other. When those relationships start shifting, it usually shows up in the data before it shows up on your chart or in the headlines.",
      "You do not need to predict the future. You just need to know whether today's conditions favor the kind of trade you want to take. That alone can save you from a lot of avoidable losses.",
    ],
  },
  {
    ctaHref: "/pricing",
    ctaLabel: "Start your 7-day free trial",
    dayOffset: 7,
    eyebrow: "[ Welcome 04 ]",
    hook: "If the free daily score has been useful, the full briefing gives you everything behind it: the sector breakdown, the risk levels, and the historical patterns that drive the call.",
    microChallenge: "Try Premium for a week. At the end, ask yourself one question: did I take fewer bad trades? If yes, it is worth it. If not, cancel and keep the free list.",
    order: 4,
    secondaryHref: "/dashboard",
    secondaryLabel: "Preview the dashboard",
    subject: "See what is behind the daily score",
    summary:
      "The free list gives you the headline: Risk-On, Neutral, or Risk-Off. Premium gives you everything behind it, so you can understand why the call is what it is and plan accordingly.",
    title: "The full picture, not just the headline.",
    bullets: [
      "Full daily briefing with sector breakdown and risk context.",
      "Historical pattern matching: what happened on days like today.",
      "Live dashboard with the model's real-time readings.",
    ],
    paragraphs: [
      "If the free score already helped you skip a bad trade or hold a winner longer, the full briefing gives you the context to do that more consistently. You will see which sectors are leading, where risk is building, and how today compares to similar sessions going back years.",
      "It is $25/month or $190/year, with a 7-day free trial. Keep it only if it makes your trading better. No contracts, cancel anytime.",
    ],
  },
] as const;

type WelcomeDripStep = (typeof WELCOME_DRIP_STEPS)[number];

type MutableWelcomeDripStep = {
  ctaHref: string;
  ctaLabel: string;
  dayOffset: number;
  eyebrow: string;
  hook: string;
  microChallenge: string;
  order: number;
  secondaryHref: string;
  secondaryLabel: string;
  subject: string;
  summary: string;
  title: string;
  bullets: string[];
  paragraphs: string[];
};

type PendingDeliveryRow = {
  email: string;
  id: string;
  scheduled_for: string;
  sequence_day: number;
  sequence_order: number;
  status: "scheduled" | "sent" | "failed" | "cancelled";
};

type SubscriberStatusRow = {
  email: string;
  status: string;
};

type DispatchPendingWelcomeDripEmailsOptions = {
  email?: string;
  limit?: number;
};

type DispatchPendingWelcomeDripEmailsResult = {
  deliveredCount: number;
  failedCount: number;
  pendingCount: number;
  shadowMode: boolean;
};

function getConfiguredFromAddress() {
  const configuredFromAddress = process.env.RESEND_FROM_ADDRESS?.trim();
  return configuredFromAddress || DEFAULT_FROM_ADDRESS;
}

function getShadowRunRecipient() {
  const configuredRecipient = process.env.SHADOW_RUN_EMAIL?.trim();
  return configuredRecipient || null;
}

function chunkValues<T>(values: readonly T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildUnsubscribeUrl(email: string) {
  const url = new URL("/api/subscribe/unsubscribe", getAppUrl());
  url.searchParams.set("email", email);
  return url.toString();
}

function buildWelcomeDripOpenUrl(deliveryId: string) {
  const url = new URL("/api/marketing/welcome-drip/open", getAppUrl());
  url.searchParams.set("delivery", deliveryId);
  return url.toString();
}

function buildWelcomeDripClickUrl(
  deliveryId: string,
  href: string,
  linkType: "primary" | "secondary",
) {
  const url = new URL("/api/marketing/welcome-drip/click", getAppUrl());
  url.searchParams.set("delivery", deliveryId);
  url.searchParams.set("target", href);
  url.searchParams.set("linkType", linkType);
  return url.toString();
}

function getWelcomeStep(sequenceOrder: number) {
  return WELCOME_DRIP_STEPS.find((step) => step.order === sequenceOrder) ?? null;
}

function buildScheduledFor(enrolledAt: Date, dayOffset: number) {
  if (dayOffset === 0) {
    return enrolledAt.toISOString();
  }

  return new Date(
    Date.UTC(
      enrolledAt.getUTCFullYear(),
      enrolledAt.getUTCMonth(),
      enrolledAt.getUTCDate() + dayOffset,
      MORNING_DISPATCH_HOUR_UTC,
      MORNING_DISPATCH_MINUTE_UTC,
      0,
      0,
    ),
  ).toISOString();
}

function renderButton(href: string, label: string, isPrimary: boolean) {
  return `<a href="${escapeHtml(href)}" style="display: inline-block; margin-right: 12px; margin-bottom: 12px; padding: 12px 18px; border: 1px solid ${isPrimary ? "#ffffff" : "#27272a"}; background: ${isPrimary ? "#ffffff" : "#09090b"}; color: ${isPrimary ? "#09090b" : "#f4f4f5"}; text-decoration: none; font-size: 13px; font-weight: 600;">${escapeHtml(label)}</a>`;
}

async function getSubscriberPreferences(email: string): Promise<{ stocks_opted_in: boolean; crypto_opted_in: boolean }> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("free_subscribers")
    .select("stocks_opted_in, crypto_opted_in")
    .eq("email", email)
    .maybeSingle();

  if (error || !data) {
    return { stocks_opted_in: true, crypto_opted_in: false };
  }

  return {
    stocks_opted_in: data.stocks_opted_in ?? true,
    crypto_opted_in: data.crypto_opted_in ?? false,
  };
}

function personalizeWelcomeStep1(step: WelcomeDripStep, prefs: { stocks_opted_in: boolean; crypto_opted_in: boolean }): MutableWelcomeDripStep {
  const mutable: MutableWelcomeDripStep = {
    ctaHref: step.ctaHref,
    ctaLabel: step.ctaLabel,
    dayOffset: step.dayOffset,
    eyebrow: step.eyebrow,
    hook: step.hook,
    microChallenge: step.microChallenge,
    order: step.order,
    secondaryHref: step.secondaryHref,
    secondaryLabel: step.secondaryLabel,
    subject: step.subject,
    summary: step.summary,
    title: step.title,
    bullets: [...step.bullets],
    paragraphs: [...step.paragraphs],
  };

  if (prefs.stocks_opted_in && prefs.crypto_opted_in) {
    mutable.summary =
      "You are on the list. Every morning before the bell, you will get the market's directional bias for stocks — and a separate crypto briefing too.";
    mutable.bullets = [
      ...mutable.bullets,
      "Plus: daily crypto regime scoring for BTC — same discipline, tuned for crypto volatility.",
    ];
  } else if (prefs.crypto_opted_in && !prefs.stocks_opted_in) {
    mutable.summary =
      "You are on the list. Every morning you will get the crypto market's directional bias, what is driving it, and what to watch for.";
    mutable.ctaHref = "/crypto/track-record";
    mutable.ctaLabel = "See the crypto track record";
    mutable.secondaryHref = "/crypto/briefings";
    mutable.secondaryLabel = "Read a crypto briefing";
    mutable.bullets = [
      "Backtested since 2020: +41,576% long-only strategy return vs +941% BTC buy-and-hold.",
      "One daily call: Risk-On, Neutral, or Risk-Off — tuned for crypto volatility.",
      "90 seconds to read. Before you place a single trade.",
    ];
    mutable.paragraphs = [
      "This is not a hype newsletter. There are no hot coin picks, no urgent alerts, no breathless calls to action. Just a clear daily read on what the crypto market is actually doing across BTC, ETH, and key on-chain metrics.",
      "Start with the track record to see how the model has performed. Then read a couple of archived briefings to see the format. You will know in 10 minutes if this is useful to you.",
    ];
  }
  // stocks_opted_in && !crypto_opted_in → no changes (current behavior)

  return mutable;
}

function createWelcomeDripEmailContent(
  step: WelcomeDripStep | MutableWelcomeDripStep,
  recipientEmail: string,
  deliveryId: string,
) {
  const unsubscribeUrl = buildUnsubscribeUrl(recipientEmail);
  const primaryHref = new URL(step.ctaHref, getAppUrl()).toString();
  const secondaryHref = step.secondaryHref ? new URL(step.secondaryHref, getAppUrl()).toString() : null;
  const trackedPrimaryHref = buildWelcomeDripClickUrl(deliveryId, primaryHref, "primary");
  const trackedSecondaryHref = secondaryHref
    ? buildWelcomeDripClickUrl(deliveryId, secondaryHref, "secondary")
    : null;
  const openPixelUrl = buildWelcomeDripOpenUrl(deliveryId);
  const html = `<!doctype html>
<html lang="en">
  <body style="margin: 0; padding: 0; background: #09090b; color: #f4f4f5; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
    <div style="margin: 0 auto; max-width: 640px; padding: 32px 20px 48px;">
      <div style="border: 1px solid #27272a; background: #09090b; padding: 32px;">
        <p style="margin: 0 0 16px; color: #71717a; font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase;">${escapeHtml(step.eyebrow)}</p>
        <h1 style="margin: 0; color: #ffffff; font-size: 34px; line-height: 1.05; letter-spacing: -0.04em; font-weight: 700;">${escapeHtml(step.title)}</h1>
        <p style="margin: 18px 0 0; color: #d4d4d8; font-size: 16px; line-height: 1.8;">${escapeHtml(step.summary)}</p>
        <p style="margin: 14px 0 0; color: #f4f4f5; font-size: 15px; line-height: 1.8; font-style: italic;">${escapeHtml(step.hook)}</p>

        <div style="margin-top: 22px; border: 1px solid #3f3f46; background: #111113; padding: 14px 16px;">
          <p style="margin: 0; color: #a1a1aa; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase;">Try This</p>
          <p style="margin: 8px 0 0; color: #f4f4f5; font-size: 14px; line-height: 1.75;">${escapeHtml(step.microChallenge)}</p>
        </div>

        <div style="margin-top: 28px; border-top: 1px solid #27272a; border-bottom: 1px solid #27272a; padding: 20px 0;">
          ${step.bullets
            .map(
              (bullet) => `<div style="padding: 10px 0; border-top: 1px solid #18181b;"><p style="margin: 0; color: #f4f4f5; font-size: 14px; line-height: 1.7;">${escapeHtml(bullet)}</p></div>`,
            )
            .join("")}
        </div>

        ${step.paragraphs
          .map(
            (paragraph) => `<p style="margin: 18px 0 0; color: #d4d4d8; font-size: 15px; line-height: 1.85;">${escapeHtml(paragraph)}</p>`,
          )
          .join("")}

        <div style="margin-top: 28px;">
          ${renderButton(trackedPrimaryHref, step.ctaLabel, true)}
          ${trackedSecondaryHref && step.secondaryLabel ? renderButton(trackedSecondaryHref, step.secondaryLabel, false) : ""}
        </div>
      </div>

      <p style="margin: 18px 0 0; color: #71717a; font-size: 12px; line-height: 1.7;">
        You are receiving this because you joined the Macro Bias free daily signal list.
        <a href="${escapeHtml(unsubscribeUrl)}" style="color: #a1a1aa; text-decoration: underline;">Unsubscribe</a>
      </p>
      <img src="${escapeHtml(openPixelUrl)}" alt="" width="1" height="1" style="display:block;border:0;outline:none;text-decoration:none;" />
    </div>
  </body>
</html>`;
  const text = [
    step.eyebrow,
    step.title,
    "",
    step.summary,
    "",
    step.hook,
    "",
    `2-Minute Challenge: ${step.microChallenge}`,
    "",
    ...step.bullets.map((bullet) => `- ${bullet}`),
    "",
    ...step.paragraphs,
    "",
    `${step.ctaLabel}: ${trackedPrimaryHref}`,
    trackedSecondaryHref && step.secondaryLabel ? `${step.secondaryLabel}: ${trackedSecondaryHref}` : null,
    `Unsubscribe: ${unsubscribeUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    html,
    subject: step.subject,
    text,
    unsubscribeUrl,
  };
}

async function cancelIneligibleDeliveries(deliveryIds: string[]) {
  if (deliveryIds.length === 0) {
    return;
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("welcome_email_drip_deliveries")
    .update({
      error_message: "Subscriber inactive or no longer eligible for drip delivery.",
      status: "cancelled",
    })
    .in("id", deliveryIds);

  if (error) {
    throw new Error(`Failed to cancel ineligible welcome drip deliveries: ${error.message}`);
  }
}

async function markEnrollmentCompletion(emails: string[]) {
  if (emails.length === 0) {
    return;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("welcome_email_drip_deliveries")
    .select("email, status")
    .in("email", emails);

  if (error) {
    throw new Error(`Failed to load welcome drip delivery completion state: ${error.message}`);
  }

  const completionEligibleEmails = new Set<string>();
  const groupedStatuses = new Map<string, string[]>();

  for (const row of (data as Array<{ email: string; status: string }> | null) ?? []) {
    const statuses = groupedStatuses.get(row.email) ?? [];
    statuses.push(row.status);
    groupedStatuses.set(row.email, statuses);
  }

  for (const [email, statuses] of groupedStatuses) {
    if (statuses.length === WELCOME_DRIP_STEPS.length && statuses.every((status) => status === "sent")) {
      completionEligibleEmails.add(email);
    }
  }

  if (completionEligibleEmails.size === 0) {
    return;
  }

  const { error: updateError } = await supabase
    .from("welcome_email_drip_enrollments")
    .update({
      completed_at: new Date().toISOString(),
      status: "completed",
    })
    .in("email", [...completionEligibleEmails]);

  if (updateError) {
    throw new Error(`Failed to mark welcome drip enrollments complete: ${updateError.message}`);
  }
}

export async function enrollSubscriberInWelcomeDrip(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    return;
  }

  const supabase = createSupabaseAdminClient();
  const enrolledAt = new Date();
  const { error: enrollmentError } = await supabase.from("welcome_email_drip_enrollments").upsert(
    {
      email: normalizedEmail,
      status: "active",
    },
    {
      onConflict: "email",
    },
  );

  if (enrollmentError) {
    throw new Error(`Failed to enroll subscriber in welcome drip: ${enrollmentError.message}`);
  }

  const deliveries = WELCOME_DRIP_STEPS.map((step) => ({
    email: normalizedEmail,
    scheduled_for: buildScheduledFor(enrolledAt, step.dayOffset),
    sequence_day: step.dayOffset,
    sequence_order: step.order,
  }));

  const { error: deliveryError } = await supabase.from("welcome_email_drip_deliveries").upsert(deliveries, {
    ignoreDuplicates: true,
    onConflict: "email,sequence_order",
  });

  if (deliveryError) {
    throw new Error(`Failed to schedule welcome drip deliveries: ${deliveryError.message}`);
  }
}

export async function dispatchPendingWelcomeDripEmails(
  options: DispatchPendingWelcomeDripEmailsOptions = {},
): Promise<DispatchPendingWelcomeDripEmailsResult> {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("welcome_email_drip_deliveries")
    .select("id, email, scheduled_for, sequence_day, sequence_order, status")
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(options.limit ?? EMAIL_BATCH_SIZE);

  if (options.email) {
    query = query.eq("email", options.email.trim().toLowerCase());
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load pending welcome drip deliveries: ${error.message}`);
  }

  const pendingRows = (data as PendingDeliveryRow[] | null) ?? [];

  if (pendingRows.length === 0) {
    return {
      deliveredCount: 0,
      failedCount: 0,
      pendingCount: 0,
      shadowMode: Boolean(getShadowRunRecipient()),
    };
  }

  const uniqueEmails = [...new Set(pendingRows.map((row) => row.email))];
  const [{ data: enrollmentRows, error: enrollmentError }, { data: subscriberRows, error: subscriberError }] = await Promise.all([
    supabase.from("welcome_email_drip_enrollments").select("email, status").in("email", uniqueEmails),
    supabase.from("free_subscribers").select("email, status").in("email", uniqueEmails),
  ]);

  if (enrollmentError) {
    throw new Error(`Failed to load welcome drip enrollments: ${enrollmentError.message}`);
  }

  if (subscriberError) {
    throw new Error(`Failed to load subscriber statuses for welcome drip: ${subscriberError.message}`);
  }

  const enrollmentStatusByEmail = new Map(
    ((enrollmentRows as SubscriberStatusRow[] | null) ?? []).map((row) => [row.email, row.status]),
  );
  const subscriberStatusByEmail = new Map(
    ((subscriberRows as SubscriberStatusRow[] | null) ?? []).map((row) => [row.email, row.status]),
  );

  const eligibleRows = pendingRows.filter((row) => {
    return enrollmentStatusByEmail.get(row.email) === "active" && subscriberStatusByEmail.get(row.email) === "active";
  });
  const ineligibleRowIds = pendingRows
    .filter((row) => !eligibleRows.some((eligibleRow) => eligibleRow.id === row.id))
    .map((row) => row.id);

  await cancelIneligibleDeliveries(ineligibleRowIds);

  if (eligibleRows.length === 0) {
    return {
      deliveredCount: 0,
      failedCount: 0,
      pendingCount: pendingRows.length,
      shadowMode: Boolean(getShadowRunRecipient()),
    };
  }

  const resend = new Resend(getRequiredServerEnv("RESEND_API_KEY"));
  const fromAddress = getConfiguredFromAddress();
  const shadowRunRecipient = getShadowRunRecipient();
  let deliveredCount = 0;
  let failedCount = 0;

  for (const batch of chunkValues(eligibleRows, EMAIL_BATCH_SIZE)) {
    const batchPayload = await Promise.all(batch.map(async (row) => {
      const step = getWelcomeStep(row.sequence_order);

      if (!step) {
        throw new Error(`No welcome drip step found for sequence order ${row.sequence_order}.`);
      }

      let finalStep: WelcomeDripStep | MutableWelcomeDripStep = step;
      if (step.order === 1) {
        const prefs = await getSubscriberPreferences(row.email);
        finalStep = personalizeWelcomeStep1(step, prefs);
      }

      const recipient = shadowRunRecipient ?? row.email;
      const emailContent = createWelcomeDripEmailContent(finalStep, row.email, row.id);

      return {
        from: fromAddress,
        headers: {
          "List-Unsubscribe": `<${emailContent.unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        html: emailContent.html,
        rowId: row.id,
        subject: emailContent.subject,
        text: emailContent.text,
        to: [recipient],
      };
    }));

    const response = await resend.batch.send(
      batchPayload.map(({ from, headers, html, subject, text, to }) => ({
        from,
        headers,
        html,
        subject,
        text,
        to,
      })),
    );

    if (response.error) {
      failedCount += batch.length;

      const { error: failedUpdateError } = await supabase
        .from("welcome_email_drip_deliveries")
        .update({
          error_message: response.error.message,
          status: "failed",
        })
        .in(
          "id",
          batchPayload.map((row) => row.rowId),
        );

      if (failedUpdateError) {
        throw new Error(`Failed to persist welcome drip delivery failure: ${failedUpdateError.message}`);
      }

      continue;
    }

    const results = response.data.data;
    const deliveryTimestamp = new Date().toISOString();
    const deliveryUpdateResults = await Promise.all(
      batchPayload.map((row, index) =>
        supabase
          .from("welcome_email_drip_deliveries")
          .update({
            delivered_at: deliveryTimestamp,
            error_message: null,
            resend_email_id: results[index]?.id ?? null,
            status: "sent",
          })
          .eq("id", row.rowId),
      ),
    );

    const deliveredUpdateError = deliveryUpdateResults.find((result) => result.error)?.error;

    if (deliveredUpdateError) {
      throw new Error(`Failed to persist welcome drip delivery success: ${deliveredUpdateError.message}`);
    }

    deliveredCount += batch.length;
  }

  await markEnrollmentCompletion(eligibleRows.map((row) => row.email));

  return {
    deliveredCount,
    failedCount,
    pendingCount: pendingRows.length,
    shadowMode: Boolean(shadowRunRecipient),
  };
}
