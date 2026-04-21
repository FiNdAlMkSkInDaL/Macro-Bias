import 'server-only';

import { Resend } from 'resend';

import { DAILY_BRIEFING_SECTION_HEADERS } from '../briefing/daily-briefing-config';
import type { WeeklyDigestData, WeeklyBriefingRow } from '../briefing/weekly-digest-data';
import { getAppUrl, getRequiredServerEnv } from '../server-env';

const DEFAULT_FROM_ADDRESS = 'Macro Bias <briefing@macro-bias.com>';
const EMAIL_BATCH_SIZE = 100;
const FREE_TIER_LOCKED_PLAYBOOK_LINE = '🔒 **[LOCKED]**: Visit macro-bias.com/today for the full read and deeper context.';
const FREE_TIER_PAYWALL_MESSAGE =
  'Visit macro-bias.com/today for the full morning read, trust check, and model context.';
const UNSUBSCRIBE_PLACEHOLDER = '{{UNSUBSCRIBE_URL}}';
const NEWSLETTER_SECTION_ORDER = [
  DAILY_BRIEFING_SECTION_HEADERS.bottomLine,
  DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook,
  DAILY_BRIEFING_SECTION_HEADERS.stressTest,
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

type PlaybookListItem = string;

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
  weeklyDigest?: WeeklyDigestData | null;
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

function buildHeaderSummary(score: number, label: string, isOverrideActive: boolean) {
  const scoreText = `TODAY'S SCORE: ${formatDisplayLabel(label)} (${formatSignedNumber(score)})`;
  return isOverrideActive ? `${scoreText} | ⚠️ MACRO OVERRIDE ACTIVE` : scoreText;
}

function renderMonospaceSpan(value: string, color?: string) {
  const colorStyle = color ? ` color: ${color}; -webkit-text-fill-color: ${color};` : "";

  return `<span style="font-family: monospace, 'Courier New', Courier;${colorStyle}">${escapeHtml(value)}</span>`;
}

function stripMarkdownBold(value: string) {
  return value.replace(/\*\*([^*]+)\*\*/g, '$1');
}

function renderMarkdownInline(value: string) {
  return escapeHtml(value).replace(
    /\*\*([^*]+)\*\*/g,
    '<strong style="font-weight: 700; color: #f8fafc; -webkit-text-fill-color: #f8fafc;">$1</strong>',
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

function parseBulletListItems(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^-\s+/, '').trim());
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
  return `- ${item}`;
}

function buildNewsletterSectionText(title: string, content: string) {
  return content ? `${title}:\n${content}` : `${title}:`;
}

function buildFreeTierPlaybookMarkdown(content: string) {
  const items = parseBulletListItems(content);

  if (items.length === 0) {
    return `- ${FREE_TIER_LOCKED_PLAYBOOK_LINE}`;
  }

  const previewLines = [`- ${items[0]}`];

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
  const trustCheckSection = sectionMap.get(DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus);

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

  if (trustCheckSection) {
    visibleSections.push(
      buildNewsletterSectionText(trustCheckSection.title, trustCheckSection.content),
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

function renderParagraphsHtml(
  content: string,
  textColor = '#dbe4ee',
  fontSize = 16,
  bottomMargin = 16,
) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs
    .map((paragraph) => {
      const renderedParagraph = renderMarkdownInline(paragraph).replace(/\n/g, '<br />');

      return `<p style="margin: 0 0 ${bottomMargin}px; color: ${textColor}; -webkit-text-fill-color: ${textColor}; font-size: ${fontSize}px; line-height: 1.7;">${renderedParagraph}</p>`;
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
  const dividerStyle = marginTop > 0
    ? `margin-top: ${marginTop}px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.06);`
    : `margin-top: ${marginTop}px;`;

  return `<div style="${dividerStyle}">
    <div style="color: ${titleColor}; -webkit-text-fill-color: ${titleColor}; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">${escapeHtml(title)}</div>
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
  const overlayLabel = isOverrideActive ? 'PATTERN BROKEN' : 'PATTERN INTACT';

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 0 0 14px;">
        <div class="email-label" style="color: #64748b; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">TODAY'S SCORE</div>
        <div class="email-heading" style="margin-top: 8px; color: #f8fafc; font-size: 30px; font-weight: 700; line-height: 1.2;">
          ${renderMonospaceSpan(baselineLabel)} <span style="color: ${accentColor};">${renderMonospaceSpan(`(${baselineScore})`)}</span>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 14px 0 0; border-top: 1px solid #1e293b;">
        <div class="email-label" style="color: #64748b; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">TRUST CHECK</div>
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
    <div style="color: #7dd3fc; -webkit-text-fill-color: #7dd3fc; font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;">Premium Access Required</div>
    <p style="margin: 14px 0 0; color: #f8fafc; -webkit-text-fill-color: #f8fafc; font-size: 20px; font-weight: 700; line-height: 1.5;">${escapeHtml(FREE_TIER_PAYWALL_MESSAGE)}</p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top: 22px; border-collapse: separate;">
      <tr>
        <td bgcolor="#0ea5e9" style="border: 1px solid #7dd3fc; border-radius: 14px; background: linear-gradient(135deg, #38bdf8, #0ea5e9); box-shadow: 0 12px 32px rgba(56, 189, 248, 0.22);">
          <a href="${upgradeUrl}" style="display: inline-block; padding: 16px 26px; color: #f8fafc; text-decoration: none; font-size: 13px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; mso-padding-alt: 16px 26px 16px 26px;">START 7-DAY FREE TRIAL</a>
        </td>
      </tr>
    </table>
  </div>`;
}

function renderPlaybookListItemHtml(item: PlaybookListItem) {
  return `<li style="margin: 0 0 18px; color: #dbe4ee; -webkit-text-fill-color: #dbe4ee; font-size: 16px; line-height: 1.8;">
    ${renderMarkdownInline(item)}
  </li>`;
}

function renderFreeTierLockedPlaybookItemHtml() {
  return `<li style="margin: 0 0 14px; color: #dbe4ee; -webkit-text-fill-color: #dbe4ee; font-size: 16px; line-height: 1.8;">
    🔒 <strong style="font-weight: 700; color: #f8fafc; -webkit-text-fill-color: #f8fafc;">[LOCKED]</strong>: Visit macro-bias.com/today for the full read and deeper context.
  </li>`;
}

function renderPlaybookListHtml(content: string) {
  const items = parseBulletListItems(content);

  if (items.length === 0) {
    return renderParagraphsHtml(content);
  }

  return `<ul style="margin: 0; padding: 0 0 0 22px; color: #dbe4ee;">
    ${items.map((item) => renderPlaybookListItemHtml(item)).join('')}
  </ul>`;
}

function renderFreeTierPlaybookListHtml(content: string) {
  const items = parseBulletListItems(content);

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
  const whySection = sectionMap.get(DAILY_BRIEFING_SECTION_HEADERS.stressTest);
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

  if (tier === 'premium' && whySection) {
    renderedSections.push(
      renderSectionBlock(
        whySection.title,
        renderParagraphsHtml(whySection.content, '#dbe4ee', 16, 14),
        {
          marginTop: 28,
          titleColor: '#cbd5e1',
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

// ----- Weekly Recap Section (embedded into Monday daily email) -----

function formatWeeklyShortDate(dateString: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(dateString));
}

function formatWeekRange(start: string, end: string) {
  const s = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(start),
  );
  const e = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(end));
  return `${s} – ${e}`;
}

function getScoreBarColor(score: number) {
  if (score >= 20) return '#22c55e';
  if (score <= -20) return '#f97316';
  return '#f59e0b';
}

function getTrendEmoji(trend: WeeklyDigestData['trendDirection']) {
  switch (trend) {
    case 'improving':
      return '↗';
    case 'deteriorating':
      return '↘';
    default:
      return '→';
  }
}

function getTrendLabel(trend: WeeklyDigestData['trendDirection']) {
  switch (trend) {
    case 'improving':
      return 'Improving';
    case 'deteriorating':
      return 'Deteriorating';
    default:
      return 'Flat';
  }
}

function renderWeeklyScoreBarHtml(score: number) {
  const normalized = Math.round(((score + 100) / 200) * 100);
  const width = Math.max(3, Math.min(97, normalized));
  const color = getScoreBarColor(score);

  return `<div style="position: relative; width: 100%; height: 8px; background: #1e293b; border-radius: 4px; overflow: hidden;">
    <div style="position: absolute; top: 0; left: 0; height: 100%; width: ${width}%; background: ${color}; border-radius: 4px;"></div>
  </div>`;
}

function renderWeeklyDayRowHtml(briefing: WeeklyBriefingRow) {
  const label = formatDisplayLabel(briefing.bias_label);
  const score = formatSignedNumber(briefing.quant_score);
  const accent = getAccentColor(briefing.bias_label);
  const override = briefing.is_override_active
    ? '<span style="color: #fca5a5; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; margin-left: 6px;">⚠ OVERRIDE</span>'
    : '';

  return `<tr>
    <td style="padding: 10px 0; border-bottom: 1px solid #1e293b;">
      <div style="display: flex; align-items: baseline; gap: 8px;">
        <span style="color: #e2e8f0; font-size: 13px; font-weight: 600; font-family: monospace, 'Courier New', Courier;">${escapeHtml(formatWeeklyShortDate(briefing.briefing_date))}</span>
        <span style="color: ${accent}; font-size: 13px; font-weight: 700; font-family: monospace, 'Courier New', Courier;">${escapeHtml(label)} (${escapeHtml(score)})</span>${override}
      </div>
      <div style="margin-top: 6px;">${renderWeeklyScoreBarHtml(briefing.quant_score)}</div>
    </td>
  </tr>`;
}

function renderWeeklyStatCellHtml(label: string, value: string, valueColor = '#f8fafc') {
  return `<td style="padding: 10px 12px; border: 1px solid #1e293b; text-align: center; width: 33%;">
    <div style="color: #64748b; font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">${escapeHtml(label)}</div>
    <div style="margin-top: 4px; color: ${valueColor}; font-size: 18px; font-weight: 700; font-family: monospace, 'Courier New', Courier;">${escapeHtml(value)}</div>
  </td>`;
}

function buildWeeklyCommentary(digest: WeeklyDigestData): string {
  const label = formatDisplayLabel(digest.dominantRegime);
  const scores = digest.briefings.map((b) => b.quant_score);
  const range = Math.max(...scores) - Math.min(...scores);
  const parts: string[] = [];

  parts.push(
    `Dominant regime: <strong style="color: #f8fafc;">${escapeHtml(label)}</strong>, avg score <strong style="color: #f8fafc;">${escapeHtml(formatSignedNumber(digest.avgScore))}</strong>.`,
  );

  if (range >= 30) {
    parts.push(`Elevated ${range}-point dispersion — regime instability.`);
  } else if (range <= 10) {
    parts.push(`Tight ${range}-point range — high conviction.`);
  } else {
    parts.push(`Moderate ${range}-point range — selective rotation.`);
  }

  if (digest.trendDirection === 'improving') {
    parts.push('Week-over-week trajectory tilted positive.');
  } else if (digest.trendDirection === 'deteriorating') {
    parts.push('Trajectory deteriorated through the week.');
  }

  if (digest.overrideCount > 0) {
    parts.push(
      `<strong style="color: #fca5a5;">${digest.overrideCount} macro override${digest.overrideCount > 1 ? 's' : ''}</strong> flagged.`,
    );
  }

  return parts.join(' ');
}

function buildWeeklyRecapSectionHtml(digest: WeeklyDigestData, tier: QuantBriefingTier): string {
  const weekRange = formatWeekRange(digest.weekStart, digest.weekEnd);
  const avgColor = getScoreBarColor(digest.avgScore);
  const dominantLabel = formatDisplayLabel(digest.dominantRegime);
  const dominantAccent = getAccentColor(digest.dominantRegime);
  const trendEmoji = getTrendEmoji(digest.trendDirection);
  const trendLabel = getTrendLabel(digest.trendDirection);
  const scores = digest.briefings.map((b) => b.quant_score);

  const dayRowsHtml = digest.briefings.map((b) => renderWeeklyDayRowHtml(b)).join('');

  const statsHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin-top: 16px;">
    <tr>
      ${renderWeeklyStatCellHtml('Avg Score', formatSignedNumber(digest.avgScore), avgColor)}
      ${renderWeeklyStatCellHtml('Regime', dominantLabel, dominantAccent)}
      ${renderWeeklyStatCellHtml('Trend', `${trendEmoji} ${trendLabel}`)}
    </tr>
    <tr>
      ${renderWeeklyStatCellHtml('Sessions', `${digest.sessionCount}`)}
      ${renderWeeklyStatCellHtml('Overrides', `${digest.overrideCount}`, digest.overrideCount > 0 ? '#fca5a5' : '#f8fafc')}
      ${renderWeeklyStatCellHtml('Range', `${Math.min(...scores)} / ${Math.max(...scores)}`)}
    </tr>
  </table>`;

  const commentaryHtml =
    tier === 'premium'
      ? `<div style="margin-top: 18px;">
          <div style="color: #7dd3fc; font-size: 10px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;">Regime Commentary</div>
          <p style="margin: 8px 0 0; color: #dbe4ee; font-size: 14px; line-height: 1.6;">${buildWeeklyCommentary(digest)}</p>
        </div>`
      : `<div style="margin-top: 18px; color: #475569; font-size: 12px; font-style: italic;">🔒 Weekly regime commentary and pattern analysis available for premium subscribers.</div>`;

  return `<div style="margin-top: 36px; padding-top: 28px; border-top: 2px solid #1e293b;">
    <div style="color: #7dd3fc; font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;">Last Week in Review</div>
    <div style="margin-top: 4px; color: #64748b; font-size: 12px; font-weight: 600; letter-spacing: 0.1em;">${escapeHtml(weekRange)}</div>
    ${statsHtml}
    <div style="margin-top: 20px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        ${dayRowsHtml}
      </table>
    </div>
    ${commentaryHtml}
  </div>`;
}

function buildWeeklyRecapSectionText(digest: WeeklyDigestData, tier: QuantBriefingTier): string {
  const weekRange = formatWeekRange(digest.weekStart, digest.weekEnd);
  const label = formatDisplayLabel(digest.dominantRegime);

  const lines: string[] = [
    '— LAST WEEK IN REVIEW —',
    weekRange,
    `Dominant: ${label} | Avg: ${formatSignedNumber(digest.avgScore)} | Trend: ${getTrendLabel(digest.trendDirection)} | Overrides: ${digest.overrideCount}`,
    '',
  ];

  for (const b of digest.briefings) {
    const override = b.is_override_active ? ' [OVERRIDE]' : '';
    lines.push(
      `${formatWeeklyShortDate(b.briefing_date)}: ${formatDisplayLabel(b.bias_label)} (${formatSignedNumber(b.quant_score)})${override}`,
    );
  }

  if (tier === 'premium') {
    const scores = digest.briefings.map((b) => b.quant_score);
    const range = Math.max(...scores) - Math.min(...scores);
    lines.push(
      '',
      `Commentary: ${label} dominated. ${range >= 30 ? 'High dispersion.' : range <= 10 ? 'High conviction.' : 'Moderate rotation.'}${digest.overrideCount > 0 ? ` ${digest.overrideCount} override(s).` : ''}`,
    );
  } else {
    lines.push('', `Weekly commentary locked — upgrade: ${buildUpgradeUrl()}`);
  }

  return lines.join('\n');
}

function buildEmailHtml(
  newsletterCopy: string,
  score: number,
  label: string,
  isOverrideActive: boolean,
  tier: QuantBriefingTier,
  weeklyDigest?: WeeklyDigestData | null,
) {
  const accentColor = getAccentColor(label);
  const dashboardUrl = escapeHtml(new URL('/dashboard', getAppUrl()).toString());
  const cryptoBriefingUrl = escapeHtml(new URL('/crypto', getAppUrl()).toString());
  const referralPageUrl = escapeHtml(new URL('/refer', getAppUrl()).toString());
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
  const weeklyRecapHtml =
    weeklyDigest && weeklyDigest.sessionCount > 0
      ? buildWeeklyRecapSectionHtml(weeklyDigest, tier)
      : '';
  const referralWidgetHtml =
    tier === 'free'
      ? `<div style="margin-top: 32px; padding: 16px 20px; border: 1px solid rgba(56,189,248,0.2); border-radius: 8px; background: rgba(56,189,248,0.04); text-align: center;">
                  <p style="margin: 0; color: #7dd3fc; -webkit-text-fill-color: #7dd3fc; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;">Refer &amp; Earn</p>
                  <p style="margin: 6px 0 0; color: #e2e8f0; -webkit-text-fill-color: #e2e8f0; font-size: 14px; line-height: 1.65;">Invite 3 traders and unlock 7 days of Premium free. Hit 7 referrals for a free month. Hit 15 for a free annual plan.</p>
                  <a href="${referralPageUrl}" style="display: inline-block; margin-top: 10px; color: #38bdf8; -webkit-text-fill-color: #38bdf8; font-size: 12px; font-weight: 600; text-decoration: underline;">Get your referral link & rewards &rarr;</a>
                </div>
                <div style="margin-top: 12px; text-align: center;">
                  <a href="${cryptoBriefingUrl}" style="color: #475569; -webkit-text-fill-color: #475569; font-size: 11px; text-decoration: underline;">Also available: Daily Crypto Regime Briefing</a>
                </div>`
      : '';

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
                <div class="email-eyebrow" style="color: #7dd3fc; font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;">Daily Macro Bias</div>
                <div style="margin-top: 16px;">${headerTickerHtml}</div>
                <div style="margin-top: 28px; padding-top: 24px; border-top: 1px solid #1e293b;">
                  ${bodyCopyHtml}
                </div>
                ${weeklyRecapHtml}
                <div style="margin-top: 32px;">
                  ${footerCtaHtml}
                </div>
                ${referralWidgetHtml}
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #1e293b; text-align: center;">
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
  weeklyDigest?: WeeklyDigestData | null,
) {
  const dashboardUrl = new URL('/dashboard', getAppUrl()).toString();
  const cryptoBriefingUrl = new URL('/crypto', getAppUrl()).toString();
  const referralPageUrl = new URL('/refer', getAppUrl()).toString();
  const upgradeUrl = buildUpgradeUrl();
  const bodyCopy = tier === 'free' ? buildFreeTierNewsletterCopyText(newsletterCopy) : newsletterCopy;
  const footerCallToAction =
    tier === 'free'
      ? `${FREE_TIER_PAYWALL_MESSAGE}\nStart 7-Day Free Trial: ${upgradeUrl}`
      : `Live Terminal: ${dashboardUrl}`;
  const strippedBodyCopy = stripMarkdownBold(bodyCopy).trim();
  const weeklyRecapText =
    weeklyDigest && weeklyDigest.sessionCount > 0
      ? buildWeeklyRecapSectionText(weeklyDigest, tier)
      : '';
  const referralText =
    tier === 'free'
      ? [
          `Refer & Earn: 3 verified referrals unlock 7 days of Premium. 7 unlock a free month. 15 unlock a free annual plan.`,
          `Get your referral link and rewards: ${referralPageUrl}`,
          `Also available: Daily Crypto Regime Briefing: ${cryptoBriefingUrl}`,
        ]
      : [];

  return [
    'Macro Bias Daily Quant Briefing',
    buildHeaderSummary(score, label, isOverrideActive),
    strippedBodyCopy,
    weeklyRecapText,
    footerCallToAction,
    ...referralText,
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
  weeklyDigest?: WeeklyDigestData | null,
): QuantBriefingEmailContent {
  const weeklyTag =
    weeklyDigest && weeklyDigest.sessionCount > 0
      ? ` + Weekly Recap ${getTrendEmoji(weeklyDigest.trendDirection)}`
      : '';
  const labelText = `${formatDisplayLabel(label)} (${formatSignedNumber(score)})`;
  const subject = isOverrideActive
    ? `⚠️ Pattern Broken | ${labelText}${weeklyTag}`
    : `${labelText}${weeklyTag}`;

  return {
    html: buildEmailHtml(newsletterCopy, score, label, isOverrideActive, tier, weeklyDigest),
    subject,
    text: buildEmailText(newsletterCopy, score, label, isOverrideActive, tier, weeklyDigest),
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
    options.weeklyDigest,
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
