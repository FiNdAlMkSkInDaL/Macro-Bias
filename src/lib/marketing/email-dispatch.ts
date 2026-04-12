import 'server-only';

import { Resend } from 'resend';

import { DAILY_BRIEFING_SECTION_HEADERS } from '../briefing/daily-briefing-config';
import { getAppUrl, getRequiredServerEnv } from '../server-env';

const DEFAULT_FROM_ADDRESS = 'Macro Bias <briefing@macro-bias.com>';
const EMAIL_BATCH_SIZE = 100;
const FREE_TIER_LOCKED_PLAYBOOK_LINE = '🔒 **[LOCKED]**: Upgrade to view sector bias and algo catalyst.';
const FREE_TIER_PAYWALL_MESSAGE =
  'Unlock the remaining sector scores, proprietary K-NN diagnostics, and Live Terminal access.';
const UNSUBSCRIBE_PLACEHOLDER = '{{UNSUBSCRIBE_URL}}';
const NEWSLETTER_SECTION_ORDER = [
  DAILY_BRIEFING_SECTION_HEADERS.bottomLine,
  DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook,
  DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus,
  DAILY_BRIEFING_SECTION_HEADERS.quantCorner,
] as const;
const PREMIUM_UPGRADE_PATH = '/api/checkout?plan=monthly';

export type QuantBriefingTier = 'free' | 'premium';

type NewsletterSectionTitle = (typeof NEWSLETTER_SECTION_ORDER)[number];

type NewsletterSection = {
  content: string;
  title: NewsletterSectionTitle;
};

type PlaybookListItem = {
  catalyst: string;
  sector: string;
  sectorBias: 'Strong' | 'Neutral' | 'Under Pressure';
};

export type DispatchQuantBriefingResult = {
  batchCount: number;
  emailIds: string[];
  recipientCount: number;
};

export type QuantBriefingEmailContent = {
  html: string;
  subject: string;
  text: string;
};

type DispatchQuantBriefingOptions = {
  recipients: readonly string[];
  tier?: QuantBriefingTier;
};

function getConfiguredFromAddress() {
  const configuredFromAddress = process.env.RESEND_FROM_ADDRESS?.trim();

  return configuredFromAddress || DEFAULT_FROM_ADDRESS;
}

function getShadowRunRecipient() {
  const configuredRecipient = process.env.SHADOW_RUN_EMAIL?.trim();

  return configuredRecipient || null;
}

function applyShadowRunRecipientOverride(recipients: readonly string[]) {
  const shadowRunRecipient = getShadowRunRecipient();

  if (!shadowRunRecipient) {
    return [...recipients];
  }

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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDisplayLabel(label: string) {
  return label.replace(/_/g, ' ');
}

function formatSignedNumber(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function getMacroOverlayLabel(isOverrideActive: boolean) {
  return isOverrideActive ? 'HIGH ALERT' : 'CONTAINED';
}

function buildHeaderSummary(score: number, label: string, isOverrideActive: boolean) {
  return `[SYSTEM OUTPUT] ALGO BIAS: ${formatDisplayLabel(label)} (${formatSignedNumber(score)}) | [SYSTEM OUTPUT] OVERLAY: ${getMacroOverlayLabel(isOverrideActive)}`;
}

function renderMonospaceSpan(value: string, color?: string) {
  const colorStyle = color ? ` color: ${color};` : "";

  return `<span style="font-family: monospace, 'Courier New', Courier;${colorStyle}">${escapeHtml(value)}</span>`;
}

function stripMarkdownBold(value: string) {
  return value.replace(/\*\*([^*]+)\*\*/g, '$1');
}

function renderMarkdownInline(value: string) {
  return escapeHtml(value).replace(
    /\*\*([^*]+)\*\*/g,
    '<strong style="font-weight: 700; color: #f8fafc;">$1</strong>',
  );
}

function normalizeSectionBoundaries(newsletterCopy: string) {
  let normalizedNewsletterCopy = newsletterCopy.replace(/\r\n/g, '\n').trim();

  for (const sectionTitle of NEWSLETTER_SECTION_ORDER) {
    const escapedSectionTitle = escapeRegExp(sectionTitle);

    normalizedNewsletterCopy = normalizedNewsletterCopy
      .replace(
        new RegExp(`\\*\\*\\s*${escapedSectionTitle}\\s*:\\s*\\*\\*`, 'g'),
        `${sectionTitle}:`,
      )
      .replace(
        new RegExp(`\\*\\*\\s*${escapedSectionTitle}\\s*\\*\\*\\s*:`, 'g'),
        `${sectionTitle}:`,
      )
      .replace(new RegExp(`([^\\n])\\s*(${escapedSectionTitle}:)`, 'g'), '$1\n$2');
  }

  return normalizedNewsletterCopy;
}

function normalizeNewsletterCopy(newsletterCopy: string) {
  return normalizeSectionBoundaries(newsletterCopy);
}

function parseNewsletterSections(newsletterCopy: string): NewsletterSection[] {
  const normalizedNewsletterCopy = normalizeNewsletterCopy(newsletterCopy);

  if (!normalizedNewsletterCopy) {
    return [];
  }

  const sectionHeaderPattern = new RegExp(
    `^(${NEWSLETTER_SECTION_ORDER.map(escapeRegExp).join('|')}):?\\s*(.*)$`,
  );
  const sections: NewsletterSection[] = [];
  let activeSectionTitle: NewsletterSectionTitle | null = null;
  let activeSectionLines: string[] = [];

  const flushActiveSection = () => {
    if (!activeSectionTitle) {
      return;
    }

    sections.push({
      content: activeSectionLines.join('\n').trim(),
      title: activeSectionTitle,
    });
  };

  for (const rawLine of normalizedNewsletterCopy.split('\n')) {
    const trimmedLine = rawLine.trim();
    const sectionMatch = trimmedLine.match(sectionHeaderPattern);

    if (sectionMatch) {
      flushActiveSection();
      activeSectionTitle = sectionMatch[1] as NewsletterSectionTitle;
      activeSectionLines = sectionMatch[2] ? [sectionMatch[2].trim()] : [];
      continue;
    }

    if (!activeSectionTitle) {
      continue;
    }

    activeSectionLines.push(rawLine.trimEnd());
  }

  flushActiveSection();

  return sections;
}

function parsePlaybookListItems(content: string): PlaybookListItem[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(
        /^-\s+\*\*([^*]+)\*\*:\s*(Strong|Neutral|Under Pressure)\s*[\u2014-]\s*(.+)$/i,
      );

      if (!match) {
        return null;
      }

      const sectorBias = normalizePlaybookBias(match[2]);

      if (!sectorBias) {
        return null;
      }

      return {
        catalyst: match[3].trim(),
        sector: match[1].trim(),
        sectorBias,
      };
    })
    .filter((item): item is PlaybookListItem => item !== null);
}

function buildUpgradeUrl() {
  return new URL(PREMIUM_UPGRADE_PATH, getAppUrl()).toString();
}

function buildUnsubscribeUrl(email: string) {
  const url = new URL('/api/subscribe/unsubscribe', getAppUrl());
  url.searchParams.set('email', email);
  return url.toString();
}

function formatPlaybookListItemMarkdown(item: PlaybookListItem) {
  return `- **${item.sector}**: ${item.sectorBias} — ${item.catalyst}`;
}

function buildNewsletterSectionText(title: string, content: string) {
  return content ? `${title}:\n${content}` : `${title}:`;
}

function buildFreeTierPlaybookMarkdown(content: string) {
  const items = parsePlaybookListItems(content);

  if (items.length === 0) {
    return `- ${FREE_TIER_LOCKED_PLAYBOOK_LINE}`;
  }

  const previewLines = [formatPlaybookListItemMarkdown(items[0])];

  if (items.length > 1) {
    previewLines.push(`- ${FREE_TIER_LOCKED_PLAYBOOK_LINE}`);
  }

  return previewLines.join('\n');
}

function buildFreeTierNewsletterCopyText(newsletterCopy: string) {
  const sections = parseNewsletterSections(newsletterCopy);

  if (sections.length === 0) {
    return '';
  }

  const sectionMap = new Map(sections.map((section) => [section.title, section] as const));
  const visibleSections: string[] = [];
  const bottomLineSection = sectionMap.get(DAILY_BRIEFING_SECTION_HEADERS.bottomLine);
  const playbookSection = sectionMap.get(DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook);

  if (bottomLineSection) {
    visibleSections.push(
      buildNewsletterSectionText(bottomLineSection.title, bottomLineSection.content),
    );
  }

  if (playbookSection) {
    visibleSections.push(
      buildNewsletterSectionText(
        playbookSection.title,
        buildFreeTierPlaybookMarkdown(playbookSection.content),
      ),
    );
  }

  return visibleSections.join('\n\n').trim();
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

function getOverrideStatusColor(isOverrideActive: boolean) {
  return isOverrideActive ? '#fca5a5' : '#93c5fd';
}

function normalizePlaybookBias(value: string): PlaybookListItem['sectorBias'] | null {
  switch (value.trim().toLowerCase()) {
    case 'strong':
      return 'Strong';
    case 'under pressure':
      return 'Under Pressure';
    case 'neutral':
      return 'Neutral';
    default:
      return null;
  }
}

function getPlaybookBiasColor(sectorBias: PlaybookListItem['sectorBias']) {
  switch (sectorBias) {
    case 'Strong':
      return '#22c55e';
    case 'Under Pressure':
      return '#ef4444';
    default:
      return '#9ca3af';
  }
}

function renderPlaybookBiasHtml(value: string) {
  return escapeHtml(value).replace(/\b(Strong|Neutral|Under Pressure)\b/g, (match) => {
    const normalizedBias = normalizePlaybookBias(match);

    if (!normalizedBias) {
      return match;
    }

    return `<span style="font-weight: 700; color: ${getPlaybookBiasColor(normalizedBias)};">${escapeHtml(normalizedBias)}</span>`;
  });
}

function renderParagraphsHtml(
  content: string,
  textColor = '#dbe4ee',
  fontSize = 16,
  bottomMargin = 14,
) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs
    .map((paragraph) => {
      const renderedParagraph = renderMarkdownInline(paragraph).replace(/\n/g, '<br />');

      return `<p style="margin: 0 0 ${bottomMargin}px; color: ${textColor}; font-size: ${fontSize}px; line-height: 1.7;">${renderedParagraph}</p>`;
    })
    .join('');
}

function renderSectionBlock(
  title: string,
  bodyHtml: string,
  options?: {
    marginTop?: number;
    titleColor?: string;
  },
) {
  const marginTop = options?.marginTop ?? 28;
  const titleColor = options?.titleColor ?? '#94a3b8';

  return `<div style="margin-top: ${marginTop}px;">
    <div style="color: ${titleColor}; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">${escapeHtml(title)}</div>
    <div style="margin-top: 14px;">${bodyHtml}</div>
  </div>`;
}

function buildEmailHeadHtml() {
  return `<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <style>
      :root {
        color-scheme: light dark;
        supported-color-schemes: light dark;
      }

      html,
      body {
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        min-width: 100% !important;
        background-color: #020617 !important;
        background-image: linear-gradient(#020617, #020617) !important;
        color: #e2e8f0 !important;
        -webkit-text-size-adjust: 100% !important;
        -ms-text-size-adjust: 100% !important;
      }

      body,
      table,
      td,
      div,
      p,
      a,
      span {
        -webkit-text-size-adjust: 100% !important;
      }

      .email-body,
      .email-wrapper,
      .email-shell,
      .email-content,
      .email-surface {
        background-color: #020617 !important;
        background-image: linear-gradient(#020617, #020617) !important;
        color: #e2e8f0 !important;
      }

      .email-heading {
        color: #f8fafc !important;
        -webkit-text-fill-color: #f8fafc !important;
      }

      .email-label {
        color: #64748b !important;
        -webkit-text-fill-color: #64748b !important;
      }

      .email-eyebrow {
        color: #7dd3fc !important;
        -webkit-text-fill-color: #7dd3fc !important;
      }

      .email-copy {
        color: #dbe4ee !important;
        -webkit-text-fill-color: #dbe4ee !important;
      }

      .email-button-cell {
        background-color: #0b1220 !important;
        background-image: linear-gradient(#0b1220, #0b1220) !important;
        border: 1px solid #38bdf8 !important;
      }

      .email-button-link {
        color: #f8fafc !important;
        -webkit-text-fill-color: #f8fafc !important;
        text-decoration: none !important;
      }

      @media (prefers-color-scheme: dark) {
        html,
        body,
        .email-body,
        .email-wrapper,
        .email-shell,
        .email-content,
        .email-surface {
          background-color: #020617 !important;
          background-image: linear-gradient(#020617, #020617) !important;
          color: #e2e8f0 !important;
        }

        .email-heading {
          color: #f8fafc !important;
          -webkit-text-fill-color: #f8fafc !important;
        }

        .email-label {
          color: #64748b !important;
          -webkit-text-fill-color: #64748b !important;
        }

        .email-eyebrow {
          color: #7dd3fc !important;
          -webkit-text-fill-color: #7dd3fc !important;
        }

        .email-copy {
          color: #dbe4ee !important;
          -webkit-text-fill-color: #dbe4ee !important;
        }

        .email-button-cell {
          background-color: #0b1220 !important;
          background-image: linear-gradient(#0b1220, #0b1220) !important;
          border: 1px solid #38bdf8 !important;
        }

        .email-button-link {
          color: #f8fafc !important;
          -webkit-text-fill-color: #f8fafc !important;
        }
      }

      @media (prefers-color-scheme: light) {
        html,
        body,
        .email-body,
        .email-wrapper,
        .email-shell,
        .email-content,
        .email-surface {
          background-color: #020617 !important;
          background-image: linear-gradient(#020617, #020617) !important;
          color: #e2e8f0 !important;
        }

        .email-heading {
          color: #f8fafc !important;
          -webkit-text-fill-color: #f8fafc !important;
        }

        .email-label {
          color: #64748b !important;
          -webkit-text-fill-color: #64748b !important;
        }

        .email-eyebrow {
          color: #7dd3fc !important;
          -webkit-text-fill-color: #7dd3fc !important;
        }

        .email-copy {
          color: #dbe4ee !important;
          -webkit-text-fill-color: #dbe4ee !important;
        }

        .email-button-cell {
          background-color: #0b1220 !important;
          background-image: linear-gradient(#0b1220, #0b1220) !important;
          border: 1px solid #38bdf8 !important;
        }

        .email-button-link {
          color: #f8fafc !important;
          -webkit-text-fill-color: #f8fafc !important;
        }
      }

      [data-ogsc] .email-body,
      [data-ogsc] .email-wrapper,
      [data-ogsc] .email-shell,
      [data-ogsc] .email-content,
      [data-ogsc] .email-surface {
        background-color: #020617 !important;
        background-image: linear-gradient(#020617, #020617) !important;
        color: #e2e8f0 !important;
      }

      [data-ogsc] .email-heading {
        color: #f8fafc !important;
        -webkit-text-fill-color: #f8fafc !important;
      }

      [data-ogsc] .email-label {
        color: #64748b !important;
        -webkit-text-fill-color: #64748b !important;
      }

      [data-ogsc] .email-eyebrow {
        color: #7dd3fc !important;
        -webkit-text-fill-color: #7dd3fc !important;
      }

      [data-ogsc] .email-copy {
        color: #dbe4ee !important;
        -webkit-text-fill-color: #dbe4ee !important;
      }

      [data-ogsc] .email-button-cell {
        background-color: #0b1220 !important;
        background-image: linear-gradient(#0b1220, #0b1220) !important;
        border: 1px solid #38bdf8 !important;
      }

      [data-ogsc] .email-button-link {
        color: #f8fafc !important;
        -webkit-text-fill-color: #f8fafc !important;
      }
    </style>
  </head>`;
}

function buildHeaderTickerHtml(
  score: number,
  label: string,
  isOverrideActive: boolean,
  accentColor: string,
  overrideStatusColor: string,
) {
  const baselineLabel = formatDisplayLabel(label);
  const baselineScore = formatSignedNumber(score);
  const overlayLabel = getMacroOverlayLabel(isOverrideActive);

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 0 0 14px;">
        <div class="email-label" style="color: #64748b; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">[SYSTEM OUTPUT] ALGO BIAS</div>
        <div class="email-heading" style="margin-top: 8px; color: #f8fafc; font-size: 30px; font-weight: 700; line-height: 1.2;">
          ${renderMonospaceSpan(baselineLabel)} <span style="color: ${accentColor};">${renderMonospaceSpan(`(${baselineScore})`)}</span>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 14px 0 0; border-top: 1px solid #1e293b;">
        <div class="email-label" style="color: #64748b; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">[SYSTEM OUTPUT] OVERLAY</div>
        <div style="margin-top: 8px; color: ${overrideStatusColor}; font-size: 24px; font-weight: 700; letter-spacing: 0.04em; line-height: 1.2;">${renderMonospaceSpan(overlayLabel, overrideStatusColor)}</div>
      </td>
    </tr>
  </table>`;
}

function buildDashboardCtaHtml(dashboardUrl: string) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse: separate;">
    <tr>
      <td class="email-button-cell" bgcolor="#0b1220" style="border: 1px solid #38bdf8; border-radius: 12px; background: #0b1220; background-color: #0b1220; background-image: linear-gradient(#0b1220, #0b1220); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);">
        <a class="email-button-link" href="${dashboardUrl}" style="display: inline-block; padding: 14px 22px; color: #f8fafc; text-decoration: none; font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; mso-padding-alt: 14px 22px 14px 22px;">Unlock Live Terminal</a>
      </td>
    </tr>
  </table>`;
}

function buildFreeTierPaywallHtml(upgradeUrl: string) {
  return `<div style="border: 1px solid #38bdf8; border-radius: 22px; padding: 24px 22px; background: linear-gradient(135deg, rgba(56, 189, 248, 0.18) 0%, rgba(15, 23, 42, 0.96) 58%, rgba(2, 6, 23, 1) 100%); box-shadow: 0 18px 48px rgba(14, 165, 233, 0.2);">
    <div style="color: #7dd3fc; font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;">Premium Access Required</div>
    <p style="margin: 14px 0 0; color: #f8fafc; font-size: 20px; font-weight: 700; line-height: 1.5;">${escapeHtml(FREE_TIER_PAYWALL_MESSAGE)}</p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top: 22px; border-collapse: separate;">
      <tr>
        <td bgcolor="#0ea5e9" style="border: 1px solid #7dd3fc; border-radius: 14px; background: linear-gradient(135deg, #38bdf8, #0ea5e9); box-shadow: 0 12px 32px rgba(56, 189, 248, 0.22);">
          <a href="${upgradeUrl}" style="display: inline-block; padding: 16px 26px; color: #f8fafc; text-decoration: none; font-size: 13px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; mso-padding-alt: 16px 26px 16px 26px;">UPGRADE TO PREMIUM</a>
        </td>
      </tr>
    </table>
  </div>`;
}

function renderPlaybookListItemHtml(item: PlaybookListItem) {
  return `<li style="margin: 0 0 14px; color: #dbe4ee; font-size: 16px; line-height: 1.8;">
    <strong style="font-weight: 700; color: #f8fafc;">${escapeHtml(item.sector)}</strong>: ${renderPlaybookBiasHtml(item.sectorBias)} <span style="color: #64748b;">&mdash;</span> ${renderMarkdownInline(item.catalyst)}
  </li>`;
}

function renderFreeTierLockedPlaybookItemHtml() {
  return `<li style="margin: 0 0 14px; color: #dbe4ee; font-size: 16px; line-height: 1.8;">
    🔒 <strong style="font-weight: 700; color: #f8fafc;">[LOCKED]</strong>: Upgrade to view sector bias and algo catalyst.
  </li>`;
}

function renderPlaybookListHtml(content: string) {
  const items = parsePlaybookListItems(content);

  if (items.length === 0) {
    return renderParagraphsHtml(content);
  }

  return `<ul style="margin: 0; padding: 0 0 0 22px; color: #dbe4ee;">
    ${items.map((item) => renderPlaybookListItemHtml(item)).join('')}
  </ul>`;
}

function renderFreeTierPlaybookListHtml(content: string) {
  const items = parsePlaybookListItems(content);

  if (items.length === 0) {
    return `<ul style="margin: 0; padding: 0 0 0 22px; color: #dbe4ee;">
      ${renderFreeTierLockedPlaybookItemHtml()}
    </ul>`;
  }

  const renderedItems = [renderPlaybookListItemHtml(items[0])];

  if (items.length > 1) {
    renderedItems.push(renderFreeTierLockedPlaybookItemHtml());
  }

  return `<ul style="margin: 0; padding: 0 0 0 22px; color: #dbe4ee;">
    ${renderedItems.join('')}
  </ul>`;
}

function renderNewsletterCopyHtml(
  newsletterCopy: string,
  isOverrideActive: boolean,
  accentColor: string,
  tier: QuantBriefingTier,
) {
  const sections = parseNewsletterSections(newsletterCopy);
  const overrideStatusColor = getOverrideStatusColor(isOverrideActive);

  if (sections.length === 0) {
    return renderSectionBlock(
      tier === 'premium' ? 'Desk Read' : 'Free Preview',
      tier === 'premium'
        ? renderParagraphsHtml(newsletterCopy)
        : renderParagraphsHtml('Unlock premium to view the full desk note.'),
      {
        marginTop: 0,
        titleColor: '#94a3b8',
      },
    );
  }

  const sectionMap = new Map(sections.map((section) => [section.title, section] as const));
  const renderedSections: string[] = [];
  const bottomLineSection = sectionMap.get(DAILY_BRIEFING_SECTION_HEADERS.bottomLine);
  const playbookSection = sectionMap.get(DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook);
  const macroOverlaySection = sectionMap.get(DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus);
  const quantCornerSection = sectionMap.get(DAILY_BRIEFING_SECTION_HEADERS.quantCorner);

  if (bottomLineSection) {
    renderedSections.push(
      renderSectionBlock(
        bottomLineSection.title,
        renderParagraphsHtml(bottomLineSection.content, '#eef6ff', 18, 16),
        {
          marginTop: 0,
          titleColor: '#7dd3fc',
        },
      ),
    );
  }

  if (playbookSection) {
    renderedSections.push(
      renderSectionBlock(
        playbookSection.title,
        tier === 'free'
          ? renderFreeTierPlaybookListHtml(playbookSection.content)
          : renderPlaybookListHtml(playbookSection.content),
        {
          marginTop: 28,
          titleColor: accentColor,
        },
      ),
    );
  }

  if (tier === 'premium' && macroOverlaySection) {
    renderedSections.push(
      renderSectionBlock(
        macroOverlaySection.title,
        renderParagraphsHtml(macroOverlaySection.content, '#e5eefb', 16, 14),
        {
          marginTop: 28,
          titleColor: overrideStatusColor,
        },
      ),
    );
  }

  if (tier === 'premium' && quantCornerSection) {
    renderedSections.push(
      renderSectionBlock(
        quantCornerSection.title,
        renderParagraphsHtml(quantCornerSection.content, '#dbe4ee', 16, 14),
        {
          marginTop: 28,
          titleColor: '#cbd5e1',
        },
      ),
    );
  }

  return renderedSections.join('');
}

function buildEmailHtml(
  newsletterCopy: string,
  score: number,
  label: string,
  isOverrideActive: boolean,
  tier: QuantBriefingTier,
) {
  const accentColor = getAccentColor(label);
  const dashboardUrl = escapeHtml(new URL('/dashboard', getAppUrl()).toString());
  const upgradeUrl = escapeHtml(buildUpgradeUrl());
  const headerSummary = escapeHtml(buildHeaderSummary(score, label, isOverrideActive));
  const overrideStatusColor = getOverrideStatusColor(isOverrideActive);
  const bodyCopyHtml = renderNewsletterCopyHtml(
    newsletterCopy,
    isOverrideActive,
    accentColor,
    tier,
  );
  const headerTickerHtml = buildHeaderTickerHtml(
    score,
    label,
    isOverrideActive,
    accentColor,
    overrideStatusColor,
  );
  const footerCtaHtml =
    tier === 'free' ? buildFreeTierPaywallHtml(upgradeUrl) : buildDashboardCtaHtml(dashboardUrl);

  return `<!doctype html>
<html lang="en">
  ${buildEmailHeadHtml()}
  <body class="email-body" bgcolor="#020617" style="margin: 0; padding: 0; background: #020617; background-color: #020617; background-image: linear-gradient(#020617, #020617); color: #e2e8f0; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">${headerSummary}</div>
    <table role="presentation" class="email-wrapper email-surface" bgcolor="#020617" width="100%" cellspacing="0" cellpadding="0" style="background: #020617; background-color: #020617; background-image: linear-gradient(#020617, #020617); padding: 32px 12px 40px;">
      <tr>
        <td class="email-content" align="center" bgcolor="#020617" style="background: #020617; background-color: #020617; background-image: linear-gradient(#020617, #020617);">
          <table role="presentation" class="email-shell email-surface" bgcolor="#020617" width="100%" cellspacing="0" cellpadding="0" style="max-width: 720px; background: #020617; background-color: #020617; background-image: linear-gradient(#020617, #020617);">
            <tr>
              <td style="padding: 0 8px;">
                <div class="email-eyebrow" style="color: #7dd3fc; font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;">Macro Bias Daily Quant Briefing</div>
                <div style="margin-top: 16px;">${headerTickerHtml}</div>
                <div style="margin-top: 28px;">
                  ${bodyCopyHtml}
                </div>
                <div style="margin-top: 32px;">
                  ${footerCtaHtml}
                </div>
                <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #1e293b; text-align: center;">
                  <a href="${UNSUBSCRIBE_PLACEHOLDER}" style="color: #475569; font-size: 11px; text-decoration: underline;">Unsubscribe from daily emails</a>
                </div>
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
  tier: QuantBriefingTier,
) {
  const dashboardUrl = new URL('/dashboard', getAppUrl()).toString();
  const upgradeUrl = buildUpgradeUrl();
  const bodyCopy = tier === 'free' ? buildFreeTierNewsletterCopyText(newsletterCopy) : newsletterCopy;
  const footerCallToAction =
    tier === 'free'
      ? `${FREE_TIER_PAYWALL_MESSAGE}\nUpgrade to Premium: ${upgradeUrl}`
      : `Live Terminal: ${dashboardUrl}`;
  const strippedBodyCopy = stripMarkdownBold(bodyCopy).trim();

  return [
    'Macro Bias Daily Quant Briefing',
    buildHeaderSummary(score, label, isOverrideActive),
    strippedBodyCopy,
    footerCallToAction,
    `Unsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}`,
  ]
    .filter((fragment) => fragment.length > 0)
    .join('\n\n');
}

export function createQuantBriefingEmailContent(
  newsletterCopy: string,
  score: number,
  label: string,
  isOverrideActive: boolean,
  tier: QuantBriefingTier = 'premium',
): QuantBriefingEmailContent {
  const subjectPrefix = getMacroOverlayLabel(isOverrideActive);

  return {
    html: buildEmailHtml(newsletterCopy, score, label, isOverrideActive, tier),
    subject: `${subjectPrefix} | ${formatDisplayLabel(label)} ${formatSignedNumber(score)}`,
    text: buildEmailText(newsletterCopy, score, label, isOverrideActive, tier),
  };
}

export async function dispatchQuantBriefing(
  newsletterCopy: string,
  score: number,
  label: string,
  isOverrideActive: boolean,
  options: DispatchQuantBriefingOptions,
): Promise<DispatchQuantBriefingResult> {
  const tier = options.tier ?? 'premium';

  console.log(`[email-dispatch] dispatchQuantBriefing() entered for tier=${tier}`);
  const recipients = applyShadowRunRecipientOverride(options.recipients);

  if (recipients.length === 0) {
    return {
      batchCount: 0,
      emailIds: [],
      recipientCount: 0,
    };
  }

  const resend = new Resend(getRequiredServerEnv('RESEND_API_KEY'));
  const emailContent = createQuantBriefingEmailContent(
    newsletterCopy,
    score,
    label,
    isOverrideActive,
    tier,
  );
  const emailIds: string[] = [];
  const recipientBatches = chunkValues(recipients, EMAIL_BATCH_SIZE);
  const fromAddress = getConfiguredFromAddress();

  console.log(`[email-dispatch] Attempting to send ${recipients.length} ${tier} emails via Resend...`);

  for (const recipientBatch of recipientBatches) {
    const response = await resend.batch.send(
      recipientBatch.map((email) => {
        const unsubscribeUrl = buildUnsubscribeUrl(email);

        return {
          from: fromAddress,
          to: [email],
          subject: emailContent.subject,
          html: emailContent.html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, escapeHtml(unsubscribeUrl)),
          text: emailContent.text.replaceAll(UNSUBSCRIBE_PLACEHOLDER, unsubscribeUrl),
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        };
      }),
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