import type { TradableSignal } from '../signal';
import type { DailyEmailContext } from './daily-email-context';

export const DAILY_EMAIL_UNSUBSCRIBE_PLACEHOLDER = '{{UNSUBSCRIBE_URL}}';

export function escapeDailyEmailHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** Technical diagnostics stay in the stored briefing, outside customer emails. */
export function cleanDailyEmailCopy(copy: string) {
  return copy.replace(/\r\n/g, '\n')
    .replace(/^[ \t]*(?:\*\*)?Model Diagnostics(?:\*\*)?\s*:(?:\*\*)?.*$/gim, '')
    .replace(/\bModel Diagnostics\s*:[^\n]*/gi, '')
    .replace(/[^.!?\n]*(?:compressed quant context|this fallback|fallback is leaning)[^.!?\n]*[.!?]?/gi, '')
    .replace(/\$([\d,]+)\.(\d{3,})/g, (match, integer: string, decimal: string) => {
      const amount = Number(`${integer.replaceAll(',', '')}.${decimal}`);
      return amount >= 1 ? `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : match;
    })
    .replace(/\n{3,}/g, '\n\n').trim();
}

export function dailyEmailPlainText(value: string) {
  return value.replace(/\*\*([^*]+)\*\*/g, '$1');
}

export function dailyEmailInlineHtml(value: string) {
  return escapeDailyEmailHtml(value).replace(/\*\*([^*]+)\*\*/g,
    '<strong style="font-weight:700;color:#f8fafc;-webkit-text-fill-color:#f8fafc;">$1</strong>');
}

export function dailyEmailSignedNumber(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

export function dailyEmailDisplayDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function reliabilityLabel(signal?: TradableSignal | null) {
  if (!signal) return null;
  const labels = { A: 'Strong historical fit', B: 'Good historical fit', C: 'Mixed historical fit', D: 'Weak historical fit', F: 'Insufficient historical fit' };
  return labels[signal.reliability] ?? null;
}

export function dailyEmailInterpretation(
  score: number,
  label: string,
  fallback: string,
  context?: DailyEmailContext,
  signal?: TradableSignal | null,
  isOverrideActive = false,
) {
  if (isOverrideActive) {
    const interpretation = cleanDailyEmailCopy(context?.interpretation || fallback);
    return /^override active\b/i.test(dailyEmailPlainText(interpretation))
      ? interpretation : 'Override active: current headlines reduce the weight of the historical score today.';
  }
  if (signal?.noTrade) {
    const lean = score === 0 ? 'no directional lean' : label === 'NEUTRAL'
      ? score > 0 ? 'only a small positive lean' : 'only a small negative lean'
      : score > 0 ? 'a positive lean' : 'a negative lean';
    return `The model shows ${lean}, but the historical evidence is too weak to rely on the score today.`;
  }
  return cleanDailyEmailCopy(context?.interpretation || fallback);
}

export function dailyEmailMetadataText(context?: DailyEmailContext, market: 'stocks' | 'crypto' = 'crypto') {
  const scoreDate = dailyEmailDisplayDate(context?.scoreDate);
  const priceDate = dailyEmailDisplayDate(context?.marketDataDate);
  const lines: string[] = [];
  if (scoreDate) lines.push(`${market === 'stocks' ? 'Session' : 'Score date'}: ${scoreDate}`);
  if (priceDate) lines.push(`Price data through: ${priceDate} (${market === 'stocks' ? 'New York close' : 'UTC'})`);
  if (context?.generatedAt) {
    const timestamp = new Date(context.generatedAt);
    if (Number.isFinite(timestamp.getTime())) {
      const display = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
      }).format(timestamp);
      lines.push(`Prepared: ${display} UTC`);
    }
  }
  return lines.join('\n');
}

export function dailyEmailDeltaText(score: number, context?: DailyEmailContext) {
  const previousDate = dailyEmailDisplayDate(context?.previousScoreDate);
  if (!previousDate || !context?.scoreDate || !dailyEmailDisplayDate(context.scoreDate)
    || !context.previousScoreDate || context.previousScoreDate >= context.scoreDate
    || context.previousScore == null || !Number.isFinite(context.previousScore) || Math.abs(context.previousScore) > 100
    || !Number.isFinite(score) || Math.abs(score) > 100) return '';
  const delta = Math.round((score - context.previousScore) * 100) / 100;
  return `Change: ${dailyEmailSignedNumber(delta)} points since ${previousDate} (${dailyEmailSignedNumber(context.previousScore)})`;
}

export function dailyEmailReliabilityText(signal?: TradableSignal | null) {
  if (signal && (/legacy score without tradable signal metadata/i.test(signal.reason ?? '')
    || !Number.isFinite(signal.distanceQuality) || signal.distanceQuality <= 0 || signal.distanceQuality > 1
    || !Number.isFinite(signal.meanNeighborDistance) || signal.meanNeighborDistance < 0
    || !Number.isFinite(signal.neighborAgreement) || signal.neighborAgreement < 0 || signal.neighborAgreement > 1)) {
    return 'Historical match quality: Unavailable for this stored score.';
  }
  const label = reliabilityLabel(signal);
  if (!label) return '';
  const agreement = signal && Number.isFinite(signal.neighborAgreement) && signal.neighborAgreement >= 0 && signal.neighborAgreement <= 1
    ? `; recorded historical agreement ${Math.round(signal.neighborAgreement * 100)}%` : '';
  return `Historical match quality: ${label}${agreement}. Historical fit is not a probability of a gain.`;
}

export function dailyEmailHeaderHtml(options: {
  title: string; score: number; label: string; interpretation: string; accent: string;
  context?: DailyEmailContext; signal?: TradableSignal | null; isOverrideActive?: boolean; market?: 'stocks' | 'crypto';
}) {
  const { title, score, label, interpretation, accent, context, signal, isOverrideActive } = options;
  const metadata = dailyEmailMetadataText(context, options.market);
  const delta = dailyEmailDeltaText(score, context);
  const reliability = dailyEmailReliabilityText(signal);
  return `<div style="color:#a1a1aa;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${escapeDailyEmailHtml(title)}</div>
    ${metadata ? `<div style="margin-top:10px;color:#cbd5e1;font-size:14px;line-height:1.6;">${escapeDailyEmailHtml(metadata).replaceAll('\n', '<br />')}</div>` : ''}
    <div style="margin-top:18px;color:#a1a1aa;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">Base score</div>
    <h1 style="margin:6px 0 0;color:${accent};-webkit-text-fill-color:${accent};font-size: 28px;font-weight:700;line-height:1.2;letter-spacing:-0.02em;">${escapeDailyEmailHtml(label.replaceAll('_', ' '))} <span style="display:inline-block;font-size:24px;">(${escapeDailyEmailHtml(dailyEmailSignedNumber(score))})</span></h1>
    ${delta ? `<p style="margin:10px 0 0;color:#cbd5e1;font-size:14px;line-height:1.6;">${escapeDailyEmailHtml(delta)}</p>` : ''}
    ${isOverrideActive ? '<p style="margin:14px 0 0;color:#fca5a5;font-size:14px;font-weight:700;">OVERRIDE ACTIVE</p>' : ''}
    ${interpretation ? `<p style="margin:18px 0 0;color:#f1f5f9;-webkit-text-fill-color:#f1f5f9;font-size:18px;line-height:1.6;">${dailyEmailInlineHtml(interpretation)}</p>` : ''}
    ${reliability ? `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #323238;color:#cbd5e1;font-size:14px;line-height:1.6;">${escapeDailyEmailHtml(reliability)}</p>` : ''}`;
}

export function dailyEmailSectionHtml(title: string, body: string, color = '#7dd3fc') {
  if (!body) return '';
  return `<div style="margin-top:24px;padding-top:20px;border-top:1px solid #323238;">
    <h2 style="margin:0 0 12px;color:${color};-webkit-text-fill-color:${color};font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">${escapeDailyEmailHtml(title)}</h2>${body}</div>`;
}

export function dailyEmailParagraphHtml(content: string) {
  return cleanDailyEmailCopy(content).split(/\n{2,}/).filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 12px;color:#dbe4ee;-webkit-text-fill-color:#dbe4ee;font-size:16px;line-height:1.65;">${dailyEmailInlineHtml(paragraph).replaceAll('\n', '<br />')}</p>`).join('');
}

/** Each market has its own row; the observation and implication stay together. */
export function dailyEmailMarketRowsHtml(lines: readonly string[]) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${lines.map((line) => {
    const content = cleanDailyEmailCopy(line.replace(/^\s*-\s*/, ''));
    const parsed = content.match(/^\*\*([^*]+)\*\*:?\s*(.*)$/);
    const label = parsed?.[1]?.replace(/:$/, '') ?? '';
    const rest = parsed?.[2] ?? content;
    const status = rest.match(/^(Strong|Neutral|Under Pressure|Coverage limited|Not measured)\s*(?:--|:|[–—])\s*(.*)$/i);
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #323238;color:#dbe4ee;font-size:16px;line-height:1.65;">${label ? `<strong style="color:#f8fafc;">${escapeDailyEmailHtml(label)}</strong>${status ? ` <span style="color:#a1a1aa;font-size:14px;">· ${escapeDailyEmailHtml(status[1])}</span>` : ''}<br />` : ''}${dailyEmailInlineHtml(status?.[2] ?? rest)}</td></tr>`;
  }).join('')}</table>`;
}

export function dailyEmailEvidenceHtml(context?: DailyEmailContext) {
  const evidence = context?.evidence?.map(cleanDailyEmailCopy).filter(Boolean).slice(0, 3) ?? [];
  if (!evidence.length) return '';
  return dailyEmailSectionHtml('Inputs behind the reading',
    `<ul style="margin:0;padding-left:20px;">${evidence.map((line) => `<li style="margin:0 0 10px;color:#dbe4ee;font-size:16px;line-height:1.65;">${dailyEmailInlineHtml(line)}</li>`).join('')}</ul>`);
}

export function dailyEmailDashboardCtaHtml(url: string) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:28px;border-collapse:separate;"><tr>
    <td bgcolor="#0ea5e9" style="border:1px solid #7dd3fc;border-radius:8px;background:#0ea5e9;">
      <a href="${escapeDailyEmailHtml(url)}" style="display:inline-block;padding:14px 22px;color:#ffffff;-webkit-text-fill-color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;mso-padding-alt:14px 22px;">View dashboard</a>
    </td></tr></table>`;
}

export function dailyEmailShellHtml(options: {
  preheader: string; headerHtml: string; bodyHtml: string; dashboardUrl: string; footerHtml?: string; subscriptionLabel: string;
}) {
  const { preheader, headerHtml, bodyHtml, dashboardUrl, footerHtml = '', subscriptionLabel } = options;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" /><meta name="color-scheme" content="light dark" /><meta name="supported-color-schemes" content="light dark" />
  <style>
    :root{color-scheme:light dark;supported-color-schemes:light dark;}
    html,body{margin:0!important;padding:0!important;width:100%!important;background-color:#09090b!important;color:#e4e4e7!important;}
    body,table,td,div,p,a,span,li{-webkit-text-size-adjust:100%!important;}
    .email-wrapper,.email-surface{background-color:#09090b!important;background-image:linear-gradient(#09090b,#09090b)!important;}
    .email-card{background-color:#18181b!important;background-image:linear-gradient(#18181b,#18181b)!important;}
    [data-ogsc] .email-wrapper,[data-ogsc] .email-surface{background-color:#09090b!important;}
    [data-ogsc] .email-card{background-color:#18181b!important;}
    @media only screen and (max-width:620px){.email-outer{padding:16px 8px!important;}.email-padding{padding:20px 16px!important;}}
  </style></head>
<body bgcolor="#09090b" style="margin:0;padding:0;background:#09090b;color:#e4e4e7;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeDailyEmailHtml(dailyEmailPlainText(preheader))}</div>
  <table role="presentation" class="email-wrapper" bgcolor="#09090b" width="100%" cellspacing="0" cellpadding="0"><tr><td class="email-outer" align="center" style="padding:32px 16px;">
    <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
    <table role="presentation" class="email-surface" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;"><tr><td>
      <table role="presentation" class="email-card" bgcolor="#18181b" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #323238;"><tr><td class="email-padding" style="padding:28px 28px;">
        ${headerHtml}${bodyHtml}${dailyEmailDashboardCtaHtml(dashboardUrl)}${footerHtml}
      </td></tr></table>
      <div style="padding:22px 8px;text-align:center;">
        <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.6;">You're receiving this because you opted into ${escapeDailyEmailHtml(subscriptionLabel)}.</p>
        <p style="margin:10px 0 0;font-size:12px;line-height:1.6;"><a href="${DAILY_EMAIL_UNSUBSCRIBE_PLACEHOLDER}" style="color:#a1a1aa;text-decoration:underline;">Unsubscribe</a></p>
      </div>
    </td></tr></table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body></html>`;
}
