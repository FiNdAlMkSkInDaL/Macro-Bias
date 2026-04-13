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
    ctaLabel: "View the track record",
    dayOffset: 0,
    eyebrow: "[ Welcome Sequence 01 ]",
    order: 1,
    secondaryHref: "/briefings",
    secondaryLabel: "Browse free briefings",
    subject: "Welcome to Macro Bias | Your pre-market edge starts here",
    summary:
      "You are now on the list for the free daily regime signal. Each session, Macro Bias turns volatility, credit, rates, commodities, and trend into one actionable market-weather read before the bell.",
    title: "Your daily macro edge is now live.",
    bullets: [
      "Risk-On: conditions favor pressing longs and momentum setups.",
      "Neutral: odds are mixed, so size and selectivity matter more.",
      "Risk-Off: the tape is hostile, and defensive posture usually wins.",
    ],
    paragraphs: [
      "Macro Bias is not another opinions newsletter. It is a daily operating layer for traders who want to know whether the environment is helping or hurting their setups before they put risk on.",
      "Start with the track record page, then read a few archived briefings. Inside a few minutes, you will understand exactly what the product is built to do: keep you aligned with regime, not emotion.",
    ],
  },
  {
    ctaHref: "/briefings",
    ctaLabel: "See the briefing archive",
    dayOffset: 1,
    eyebrow: "[ Welcome Sequence 02 ]",
    order: 2,
    secondaryHref: "/pricing",
    secondaryLabel: "See what Premium unlocks",
    subject: "The 90-second Macro Bias morning routine",
    summary:
      "The best way to use Macro Bias is simple: read the signal before the open, decide whether the day is for aggression or restraint, and only then build your plan.",
    title: "Use the signal in under 90 seconds.",
    bullets: [
      "Check the top-line bias first. That sets the tone for your day.",
      "Read the playbook next. It tells you where strength or pressure is most likely to show up.",
      "Let regime control your sizing. Most traders do the opposite and pay for it.",
    ],
    paragraphs: [
      "Macro Bias works best as a filter, not as a prediction machine. On strong days, it helps you press. On messy days, it helps you preserve capital and avoid forcing trades that never had the backdrop to work.",
      "That one shift alone tends to improve decision quality faster than adding another indicator ever will.",
    ],
  },
  {
    ctaHref: "/regime",
    ctaLabel: "Read the regime guide",
    dayOffset: 3,
    eyebrow: "[ Welcome Sequence 03 ]",
    order: 3,
    secondaryHref: "/track-record",
    secondaryLabel: "Review the results",
    subject: "Why regime beats gut feel",
    summary:
      "Most traders do not lose because they cannot find entries. They lose because they size up in the wrong environment. Macro Bias exists to fix that specific problem.",
    title: "Stop trading the wrong weather.",
    bullets: [
      "Bad regime turns A- setups into mediocre trades.",
      "Good regime makes simple setups easier to hold and easier to size.",
      "Context changes expectancy even when your entry pattern stays the same.",
    ],
    paragraphs: [
      "The model watches cross-asset behavior because macro stress rarely announces itself in one chart. Credit, rates, volatility, commodities, and trend all move before traders emotionally catch up.",
      "You do not need perfect foresight. You need to know whether the wind is at your back, in your face, or dead sideways. That is the job.",
    ],
  },
  {
    ctaHref: "/pricing",
    ctaLabel: "Start the 7-day free trial",
    dayOffset: 7,
    eyebrow: "[ Welcome Sequence 04 ]",
    order: 4,
    secondaryHref: "/dashboard",
    secondaryLabel: "See the live terminal",
    subject: "Ready for the full Macro Bias terminal?",
    summary:
      "The free list gives you the headline signal. Premium unlocks the full playbook: sector pressure map, regime diagnostics, historical analogs, and the live dashboard used to make the call.",
    title: "Upgrade when you want the full playbook.",
    bullets: [
      "Full morning briefing before the open.",
      "Sector and cross-asset breakdowns behind the score.",
      "Historical analogs and regime context for execution quality.",
    ],
    paragraphs: [
      "If the free signal already helps you frame the day, Premium gives you the detail behind that edge. You see what is driving the score, where the model sees pressure, and how comparable environments behaved in the past.",
      "The offer is simple: 7-day free trial, then $25 per month or $190 per year. No complicated tiers and no hidden catches.",
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
