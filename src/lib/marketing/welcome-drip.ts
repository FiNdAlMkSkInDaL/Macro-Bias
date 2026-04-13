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
    ctaLabel: "See the proof now",
    dayOffset: 0,
    eyebrow: "[ Welcome Sequence 01 ]",
    hook: "Most retail traders lose before their first trade of the day. The mistake is not entry quality. It is regime blindness.",
    microChallenge: "Before your next session, write one sentence: 'If we open Risk-Off, I will reduce size by __% and skip __ setup.'",
    order: 1,
    secondaryHref: "/briefings",
    secondaryLabel: "See a real briefing",
    subject: "You now have the unfair 8:57AM edge",
    summary:
      "You are now on the list for the daily Macro Bias signal. Before the bell, we compress volatility, credit, rates, commodities, and trend into one executable regime call.",
    title: "Welcome to your pre-market quant protocol.",
    bullets: [
      "Audited track record since 2020: +286% strategy return vs +111% SPY.",
      "One daily score: Risk-On, Neutral, or Risk-Off.",
      "Your edge is clarity before the open, not panic after it.",
    ],
    paragraphs: [
      "Macro Bias is not a hype newsletter. It is a disciplined decision layer for traders who want to know whether the environment is helping or hurting them before they put capital at risk.",
      "Start with the track record, then review two archived briefings. In 10 minutes, you will understand the full workflow: read regime, choose posture, execute with intent.",
    ],
  },
  {
    ctaHref: "/briefings",
    ctaLabel: "Steal this workflow",
    dayOffset: 1,
    eyebrow: "[ Welcome Sequence 02 ]",
    hook: "The best traders are boring before the open and ruthless during it.",
    microChallenge: "Tomorrow, run this in order: bias -> playbook -> sizing plan. Do not open social media first.",
    order: 2,
    secondaryHref: "/pricing",
    secondaryLabel: "See Premium unlocks",
    subject: "The 90-second ritual that saves bad trading days",
    summary:
      "The highest-ROI way to use Macro Bias is simple: read the score before the open, decide if the day is for aggression or defense, then lock your plan before emotion starts.",
    title: "Run this before every opening bell.",
    bullets: [
      "Step 1: Check top-line bias before chart overload.",
      "Step 2: Read the playbook for likely pressure/leaders.",
      "Step 3: Let regime set size ceilings, not confidence spikes.",
    ],
    paragraphs: [
      "Macro Bias is a context filter, not a crystal ball. On favorable days it tells you when to lean in with structure. On hostile days it protects you from forcing low-quality trades.",
      "That one shift tends to improve consistency faster than adding another indicator, signal room, or guru feed.",
    ],
  },
  {
    ctaHref: "/regime",
    ctaLabel: "Read the regime map",
    dayOffset: 3,
    eyebrow: "[ Welcome Sequence 03 ]",
    hook: "Most traders think they need better entries. They usually need better weather awareness.",
    microChallenge: "Audit your last 10 losses: mark each one Risk-On, Neutral, or Risk-Off. You will see the pattern immediately.",
    order: 3,
    secondaryHref: "/track-record",
    secondaryLabel: "Review the audited results",
    subject: "The expensive retail mistake nobody warns you about",
    summary:
      "Most traders do not fail from a lack of setups. They fail by sizing aggressively in hostile conditions. Macro Bias was built to solve that exact leak.",
    title: "Stop guessing market weather.",
    bullets: [
      "Bad regime can break even A+ setups.",
      "Good regime makes plain setups easier to hold.",
      "Expectancy changes before your entry trigger fires.",
    ],
    paragraphs: [
      "The model tracks cross-asset behavior because real stress rarely appears in one chart first. Credit, rates, volatility, commodities, and trend often shift before retail sentiment catches up.",
      "You do not need perfect prediction. You need repeatable positioning rules that tell you when to press and when to protect your account.",
    ],
  },
  {
    ctaHref: "/pricing",
    ctaLabel: "Start your 7-day trial",
    dayOffset: 7,
    eyebrow: "[ Welcome Sequence 04 ]",
    hook: "If the free signal improved your decisions, the full terminal will feel like trading with x-ray vision.",
    microChallenge: "Run one week with the full stack and score your decisions: better timing, better sizing, fewer forced trades.",
    order: 4,
    secondaryHref: "/dashboard",
    secondaryLabel: "Preview the live terminal",
    subject: "Your trial starts when you’re ready to stop guessing",
    summary:
      "The free list gives you the headline call. Premium gives you the full execution map: sector pressure, regime diagnostics, historical analogs, and the live terminal behind each signal.",
    title: "Move from headline signal to full quant map.",
    bullets: [
      "Pre-open briefing with detailed tactical context.",
      "Sector and cross-asset decomposition behind the score.",
      "Historical analog framework to pressure-test your plan.",
    ],
    paragraphs: [
      "If the free signal already improves your posture, Premium gives you the detail that compounds the edge: what drives the score, where pressure is building, and how similar regimes behaved historically.",
      "Start with a 7-day free trial. Then it is $25/month or $190/year. Keep it only if your execution improves.",
    ],
  },
] as const;

type WelcomeDripStep = (typeof WELCOME_DRIP_STEPS)[number];

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

function createWelcomeDripEmailContent(step: WelcomeDripStep, recipientEmail: string) {
  const unsubscribeUrl = buildUnsubscribeUrl(recipientEmail);
  const primaryHref = new URL(step.ctaHref, getAppUrl()).toString();
  const secondaryHref = step.secondaryHref ? new URL(step.secondaryHref, getAppUrl()).toString() : null;
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
          <p style="margin: 0; color: #a1a1aa; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase;">2-Minute Edge Challenge</p>
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
          ${renderButton(primaryHref, step.ctaLabel, true)}
          ${secondaryHref && step.secondaryLabel ? renderButton(secondaryHref, step.secondaryLabel, false) : ""}
        </div>
      </div>

      <p style="margin: 18px 0 0; color: #71717a; font-size: 12px; line-height: 1.7;">
        You are receiving this because you joined the Macro Bias free daily signal list.
        <a href="${escapeHtml(unsubscribeUrl)}" style="color: #a1a1aa; text-decoration: underline;">Unsubscribe</a>
      </p>
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
    `2-Minute Edge Challenge: ${step.microChallenge}`,
    "",
    ...step.bullets.map((bullet) => `- ${bullet}`),
    "",
    ...step.paragraphs,
    "",
    `${step.ctaLabel}: ${primaryHref}`,
    secondaryHref && step.secondaryLabel ? `${step.secondaryLabel}: ${secondaryHref}` : null,
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
    const batchPayload = batch.map((row) => {
      const step = getWelcomeStep(row.sequence_order);

      if (!step) {
        throw new Error(`No welcome drip step found for sequence order ${row.sequence_order}.`);
      }

      const recipient = shadowRunRecipient ?? row.email;
      const emailContent = createWelcomeDripEmailContent(step, row.email);

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
    });

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
