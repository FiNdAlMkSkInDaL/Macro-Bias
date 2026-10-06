import { CRYPTO_BRIEFING_SECTION_HEADERS } from '../crypto-briefing/crypto-briefing-config';
import { getAppUrl } from '../server-env';
import type { TradableSignal } from '../signal';
import type { DailyEmailContext } from './daily-email-context';
import {
  cleanDailyEmailCopy,
  DAILY_EMAIL_UNSUBSCRIBE_PLACEHOLDER,
  dailyEmailDeltaText,
  dailyEmailDisplayDate,
  dailyEmailEvidenceHtml,
  dailyEmailHeaderHtml,
  dailyEmailInterpretation,
  dailyEmailMarketRowsHtml,
  dailyEmailMetadataText,
  dailyEmailParagraphHtml,
  dailyEmailPlainText,
  dailyEmailReliabilityText,
  dailyEmailSectionHtml,
  dailyEmailShellHtml,
  dailyEmailSignedNumber,
  escapeDailyEmailHtml,
} from './daily-email-template';

type CryptoEmailTier = 'free' | 'premium';

function parseCryptoEmailSections(copy: string) {
  const headers = Object.values(CRYPTO_BRIEFING_SECTION_HEADERS);
  const sections = new Map<string, string>();
  let current: string | null = null;
  let lines: string[] = [];
  const flush = () => { if (current) sections.set(current, lines.join('\n').trim()); };
  for (const line of cleanDailyEmailCopy(copy).split('\n')) {
    const normalized = line.trim().replaceAll('**', '');
    const header = headers.find((value) => normalized === value || normalized.startsWith(`${value}:`));
    if (header) {
      flush();
      current = header;
      const remainder = normalized.slice(header.length).replace(/^:\s*/, '').trim();
      lines = remainder ? [remainder] : [];
    } else if (current) lines.push(line);
  }
  flush();
  return sections;
}

/** Pure content builder; delivery, recipient policy, and unsubscribe substitution stay in the publisher. */
export function createCryptoBriefingEmailContent(
  newsletterCopy: string,
  score: number,
  label: string,
  tier: CryptoEmailTier = 'premium',
  context?: DailyEmailContext,
  signal?: TradableSignal | null,
): { html: string; text: string; subject: string } {
  const sections = parseCryptoEmailSections(newsletterCopy);
  const regime = sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.bottomLine) ?? '';
  const override = context?.isOverrideActive ?? /^override active\b/i.test(dailyEmailPlainText(regime));
  const interpretation = dailyEmailInterpretation(score, label, regime, context, signal, override);
  const accent = /RISK_ON$/.test(label) ? '#4ade80' : /RISK_OFF$/.test(label) ? '#fb923c' : '#fbbf24';
  const marketRows = (sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.marketBreakdown) ?? '')
    .split('\n').map((line) => line.trim()).filter(Boolean);
  const visibleRows = tier === 'premium' ? marketRows : marketRows.slice(0, 1);
  const risk = sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.riskCheck) ?? '';
  const history = cleanDailyEmailCopy(context?.historicalContext || sections.get(CRYPTO_BRIEFING_SECTION_HEADERS.modelNotes) || '');
  const coverage = cleanDailyEmailCopy(context?.coverageNote || '');
  const dashboardUrl = new URL('/crypto/dashboard', getAppUrl()).toString();
  const upgradeUrl = new URL('/api/checkout?plan=monthly', getAppUrl()).toString();
  const referralUrl = new URL('/refer', getAppUrl()).toString();
  const freePreview = 'Pro includes the full market map, confirmation to watch, and historical context.';
  const bodyHtml = [
    tier === 'premium' ? dailyEmailEvidenceHtml(context) : '',
    visibleRows.length ? dailyEmailSectionHtml('The latest prices', dailyEmailMarketRowsHtml(visibleRows), '#c4b5fd') : '',
    tier === 'premium' && risk ? dailyEmailSectionHtml('What to watch', dailyEmailParagraphHtml(risk), '#fdba74') : '',
    tier === 'premium' && history ? dailyEmailSectionHtml('Past sessions', dailyEmailParagraphHtml(history), '#6ee7b7') : '',
    coverage ? dailyEmailSectionHtml('What this covers', dailyEmailParagraphHtml(coverage), '#a1a1aa') : '',
    tier === 'free' ? dailyEmailSectionHtml('Free preview', `${dailyEmailParagraphHtml(freePreview)}<p style="margin:0;font-size:16px;line-height:1.65;"><a href="${escapeDailyEmailHtml(upgradeUrl)}" style="color:#7dd3fc;text-decoration:underline;">Explore Pro</a></p>`) : '',
  ].join('');
  const footerHtml = tier === 'free'
    ? `<p style="margin:22px 0 0;color:#a1a1aa;font-size:14px;line-height:1.6;"><a href="${escapeDailyEmailHtml(referralUrl)}" style="color:#7dd3fc;text-decoration:underline;">Refer &amp; earn Pro access</a></p>` : '';
  const date = dailyEmailDisplayDate(context?.scoreDate);
  const labelAndScore = `${label.replaceAll('_', ' ')} (${dailyEmailSignedNumber(score)})`;
  const subject = `Crypto Bias: ${override ? 'Override active | ' : ''}${labelAndScore}${date ? ` | ${date} UTC` : ''}`;
  const metadata = dailyEmailMetadataText(context);
  const delta = dailyEmailDeltaText(score, context);
  const reliability = dailyEmailReliabilityText(signal);
  const evidence = tier === 'premium' ? (context?.evidence ?? []).map(cleanDailyEmailCopy).filter(Boolean).slice(0, 3) : [];
  const text = [
    'Daily Crypto Bias',
    metadata,
    `BASE SCORE: ${labelAndScore}`,
    delta,
    interpretation,
    reliability,
    evidence.length ? `What the model sees\n${evidence.map((line) => `- ${line}`).join('\n')}` : '',
    visibleRows.length ? `The latest prices\n${visibleRows.join('\n')}` : '',
    tier === 'premium' && risk ? `What to watch\n${risk}` : '',
    tier === 'premium' && history ? `Past sessions\n${history}` : '',
    coverage ? `What this covers\n${coverage}` : '',
    tier === 'free' ? `${freePreview}\nExplore Pro: ${upgradeUrl}` : '',
    `View dashboard: ${dashboardUrl}`,
    tier === 'free' ? `Refer & earn Pro access: ${referralUrl}` : '',
    `Unsubscribe: ${DAILY_EMAIL_UNSUBSCRIBE_PLACEHOLDER}`,
  ].filter(Boolean).map(dailyEmailPlainText).join('\n\n');
  return {
    subject,
    text,
    html: dailyEmailShellHtml({
      preheader: [interpretation, delta, date ? `Score date: ${date}.` : ''].filter(Boolean).join(' '),
      headerHtml: dailyEmailHeaderHtml({ title: 'Daily Crypto Bias', score, label, interpretation, accent, context, signal, isOverrideActive: override }),
      bodyHtml,
      dashboardUrl,
      footerHtml,
      subscriptionLabel: 'Macro Bias daily crypto emails',
    }),
  };
}
