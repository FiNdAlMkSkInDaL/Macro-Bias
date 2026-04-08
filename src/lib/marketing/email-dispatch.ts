import 'server-only';

import { Resend } from 'resend';

import { getAppUrl, getRequiredServerEnv } from '../server-env';
import { createSupabaseAdminClient } from '../supabase/admin';

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const;
const DEFAULT_FROM_ADDRESS = 'Macro Bias <briefing@macro-bias.com>';
const EMAIL_BATCH_SIZE = 100;
const RECIPIENT_PAGE_SIZE = 1000;

type SubscriberEmailRow = {
  email: string | null;
};

export type DispatchQuantBriefingResult = {
  batchCount: number;
  emailIds: string[];
  recipientCount: number;
};

function getConfiguredFromAddress() {
  const configuredFromAddress = process.env.RESEND_FROM_ADDRESS?.trim();

  return configuredFromAddress || DEFAULT_FROM_ADDRESS;
}

function getShadowRunRecipient() {
  const configuredRecipient = process.env.SHADOW_RUN_EMAIL?.trim();

  // TODO: Remove this shadow-run override before production rollout.
  return configuredRecipient || 'finlayp32@gmail.com';
}

function applyShadowRunRecipientOverride(recipients: readonly string[]) {
  const shadowRunRecipient = getShadowRunRecipient();
  const normalizedShadowRunRecipient = shadowRunRecipient.toLowerCase();
  const matchedRecipient = recipients.find(
    (recipient) => recipient.toLowerCase() === normalizedShadowRunRecipient,
  );
  const finalRecipient = matchedRecipient ?? shadowRunRecipient;

  console.log(
    `[email-dispatch] Shadow run recipient override active: forcing delivery to ${finalRecipient}`,
  );

  return [finalRecipient];
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
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDisplayLabel(label: string) {
  return label.replace(/_/g, ' ');
}

function formatSignedNumber(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function getAccentColor(label: string) {
  switch (label) {
    case 'EXTREME_RISK_ON':
    case 'RISK_ON':
      return '#22c55e';
    case 'EXTREME_RISK_OFF':
    case 'RISK_OFF':
      return '#f97316';
    default:
      return '#f59e0b';
  }
}

function getOverrideStatusPalette(isOverrideActive: boolean) {
  if (isOverrideActive) {
    return {
      backgroundColor: '#2a0f12',
      borderColor: '#7f1d1d',
      label: 'HIGH ALERT',
      textColor: '#fca5a5',
    };
  }

  return {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    label: 'STANDARD ANALYSIS',
    textColor: '#93c5fd',
  };
}

function renderNewsletterCopyHtml(newsletterCopy: string) {
  const paragraphs = newsletterCopy
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs
    .map((paragraph) => {
      const escapedParagraph = escapeHtml(paragraph).replace(/\n/g, '<br />');

      return `<p style="margin: 0 0 18px; color: #dbe4ee; font-size: 15px; line-height: 1.75;">${escapedParagraph}</p>`;
    })
    .join('');
}

function buildEmailHtml(
  newsletterCopy: string,
  score: number,
  label: string,
  isOverrideActive: boolean,
) {
  const accentColor = getAccentColor(label);
  const dashboardUrl = escapeHtml(new URL('/dashboard', getAppUrl()).toString());
  const displayLabel = escapeHtml(formatDisplayLabel(label));
  const displayScore = escapeHtml(formatSignedNumber(score));
  const overridePalette = getOverrideStatusPalette(isOverrideActive);
  const bodyCopyHtml = renderNewsletterCopyHtml(newsletterCopy);

  return `<!doctype html>
<html lang="en">
  <body style="margin: 0; padding: 0; background: #020617; color: #e2e8f0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: #020617; padding: 28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 680px; border: 1px solid #1e293b; background: #020817; font-family: 'IBM Plex Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
            <tr>
              <td style="padding: 28px 28px 22px; border-bottom: 1px solid #1e293b;">
                <div style="color: #94a3b8; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase;">Macro Bias Daily Quant Briefing</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top: 20px;">
                  <tr>
                    <td valign="top" style="padding-right: 12px;">
                      <div style="color: #64748b; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;">Score</div>
                      <div style="margin-top: 8px; color: ${accentColor}; font-size: 42px; font-weight: 700; line-height: 1;">${displayScore}</div>
                    </td>
                    <td valign="top" align="right">
                      <div style="color: #64748b; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;">Label</div>
                      <div style="margin-top: 8px; color: #f8fafc; font-size: 18px; font-weight: 700; line-height: 1.3;">${displayLabel}</div>
                    </td>
                  </tr>
                </table>
                <div style="margin-top: 20px; padding: 12px 14px; border: 1px solid ${overridePalette.borderColor}; background: ${overridePalette.backgroundColor}; color: ${overridePalette.textColor}; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;">
                  ${overridePalette.label}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding: 28px;">
                ${bodyCopyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding: 0 28px 28px;">
                <a href="${dashboardUrl}" style="display: inline-block; padding: 12px 16px; border: 1px solid #334155; color: #f8fafc; text-decoration: none; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;">Open Dashboard</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildEmailText(
  newsletterCopy: string,
  score: number,
  label: string,
  isOverrideActive: boolean,
) {
  const dashboardUrl = new URL('/dashboard', getAppUrl()).toString();

  return [
    'Macro Bias Daily Quant Briefing',
    `Score: ${formatSignedNumber(score)}`,
    `Label: ${formatDisplayLabel(label)}`,
    `Status: ${isOverrideActive ? 'HIGH ALERT' : 'STANDARD ANALYSIS'}`,
    newsletterCopy,
    `Dashboard: ${dashboardUrl}`,
  ].join('\n\n');
}

async function getSubscribedEmails() {
  const supabase = createSupabaseAdminClient();
  const emailsByNormalizedValue = new Map<string, string>();
  const shadowRunRecipient = getShadowRunRecipient();

  for (let offset = 0; ; offset += RECIPIENT_PAGE_SIZE) {
    let query = supabase
      .from('users')
      .select('email')
      .in('subscription_status', [...ACTIVE_SUBSCRIPTION_STATUSES])
      .not('email', 'is', null)
      .order('email', { ascending: true })
      .range(offset, offset + RECIPIENT_PAGE_SIZE - 1);

    query = query.eq('email', shadowRunRecipient);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to query subscribed users for email dispatch: ${error.message}`);
    }

    const rows = (data as SubscriberEmailRow[] | null) ?? [];
    console.log(
      `[email-dispatch] Supabase users query returned ${rows.length} rows at offset ${offset}`,
    );

    for (const row of rows) {
      if (typeof row.email !== 'string') {
        continue;
      }

      const email = row.email.trim();

      if (!email) {
        continue;
      }

      emailsByNormalizedValue.set(email.toLowerCase(), email);
    }

    if (rows.length < RECIPIENT_PAGE_SIZE) {
      break;
    }
  }

  return [...emailsByNormalizedValue.values()];
}

export async function dispatchQuantBriefing(
  newsletterCopy: string,
  score: number,
  label: string,
  isOverrideActive: boolean,
): Promise<DispatchQuantBriefingResult> {
  console.log('[email-dispatch] dispatchQuantBriefing() entered');
  const subscribedRecipients = await getSubscribedEmails();
  const recipients = applyShadowRunRecipientOverride(subscribedRecipients);

  if (recipients.length === 0) {
    return {
      batchCount: 0,
      emailIds: [],
      recipientCount: 0,
    };
  }

  const resend = new Resend(getRequiredServerEnv('RESEND_API_KEY'));
  const subjectPrefix = isOverrideActive ? 'HIGH ALERT' : 'Standard Analysis';
  const subject = `${subjectPrefix} | ${formatDisplayLabel(label)} ${formatSignedNumber(score)}`;
  const html = buildEmailHtml(newsletterCopy, score, label, isOverrideActive);
  const text = buildEmailText(newsletterCopy, score, label, isOverrideActive);
  const emailIds: string[] = [];
  const recipientBatches = chunkValues(recipients, EMAIL_BATCH_SIZE);
  const fromAddress = getConfiguredFromAddress();

  console.log(`[email-dispatch] Attempting to send ${recipients.length} emails via Resend...`);

  for (const recipientBatch of recipientBatches) {
    const response = await resend.batch.send(
      recipientBatch.map((email) => ({
        from: fromAddress,
        to: [email],
        subject,
        html,
        text,
      })),
    );

    if (response.error) {
      throw new Error(`Resend batch send failed: ${response.error.message}`);
    }

    emailIds.push(...response.data.data.map((result) => result.id));
  }

  return {
    batchCount: recipientBatches.length,
    emailIds,
    recipientCount: recipients.length,
  };
}