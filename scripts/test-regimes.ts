import { loadEnvConfig } from '@next/env';

import {
  DAILY_BRIEFING_SECTION_HEADERS,
} from '../src/lib/briefing/daily-briefing-config';
import {
  generateDailyBriefingFromContext,
} from '../src/lib/briefing/daily-brief-generator';
import type {
  DailyBriefingNewsResult,
  DailyBriefingQuantContext,
  DailyBriefingResult,
} from '../src/lib/briefing/types';
import type { HistoricalAnalogsPayload } from '../src/lib/market-data/derive-historical-analogs';
import {
  createQuantBriefingEmailContent,
  dispatchQuantBriefing,
  type QuantBriefingTier,
} from '../src/lib/marketing/email-dispatch';
import type { BiasLabel } from '../src/lib/macro-bias/types';
import { getRequiredServerEnv } from '../src/lib/server-env';

if (process.env.NODE_ENV === 'production') {
  throw new Error('scripts/test-regimes.ts must not run in production.');
}

loadEnvConfig(process.cwd());

const REGIME_TEST_SECTION_ORDER = [
  DAILY_BRIEFING_SECTION_HEADERS.bottomLine,
  DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook,
  DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus,
  DAILY_BRIEFING_SECTION_HEADERS.quantCorner,
] as const;

type RegimeScenario = {
  expectedOverrideActive: boolean;
  name: string;
  news: DailyBriefingNewsResult;
  quant: DailyBriefingQuantContext;
};

type ParsedSection = {
  content: string;
  title: (typeof REGIME_TEST_SECTION_ORDER)[number];
};

type PromptValidationResult = {
  criticalIssues: string[];
  warnings: string[];
};

const PLAYBOOK_BULLET_PATTERN = /^-\s+\*\*[^*]+\*\*:\s*(Strong|Neutral|Under Pressure)\s*[\u2014-]\s*.+$/;
const PLAYBOOK_BIAS_HTML_PATTERN = /<span style="[^"]*font-weight: 700;[^"]*color: #(22c55e|9ca3af|ef4444);[^"]*">(Strong|Neutral|Under Pressure)<\/span>/;
const FREE_TIER_LOCKED_PLAYBOOK_TEXT =
  '🔒 [LOCKED]: Upgrade to view sector bias and algo catalyst.';
const FREE_TIER_PAYWALL_MESSAGE =
  'Unlock the remaining sector scores, proprietary K-NN diagnostics, and Live Terminal access.';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function summarizeHeadlines(headlines: readonly string[]) {
  return headlines.slice(0, 3).join(' | ');
}

function stripMarkdownBold(value: string) {
  return value.replace(/\*\*([^*]+)\*\*/g, '$1');
}

function normalizeSectionBoundaries(newsletterCopy: string) {
  let normalizedNewsletterCopy = newsletterCopy.replace(/\r\n/g, '\n').trim();

  for (const sectionTitle of REGIME_TEST_SECTION_ORDER) {
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

function buildHistoricalAnalogsPayload(
  analogReference: string,
  nextSessionDate: string,
  intradayNet: number,
  overnightGap: number,
  sessionRange: number,
  matchConfidence: number,
): HistoricalAnalogsPayload {
  return {
    alignedSessionCount: 1284,
    candidateCount: 242,
    clusterAveragePlaybook: {
      intradayNet,
      overnightGap,
      sessionRange,
    },
    featureTickers: ['SPY', 'QQQ', 'XLP', 'TLT', 'GLD', 'USO', 'VIX', 'HYG', 'CPER'],
    topMatches: [
      {
        intradayNet,
        matchConfidence,
        nextSessionDate,
        overnightGap,
        sessionRange,
        tradeDate: analogReference,
      },
    ],
  };
}

function buildQuantContext(input: {
  analogReference: string;
  label: BiasLabel;
  matchConfidence: number;
  nextSessionDate: string;
  overnightGap: number;
  score: number;
  sessionRange: number;
  tradeDate: string;
  intradayNet: number;
}): DailyBriefingQuantContext {
  const historicalAnalogs = buildHistoricalAnalogsPayload(
    input.analogReference,
    input.nextSessionDate,
    input.intradayNet,
    input.overnightGap,
    input.sessionRange,
    input.matchConfidence,
  );

  return {
    analogReference: input.analogReference,
    analogs: [
      {
        biasLabel: input.label,
        intradayNet: input.intradayNet,
        matchConfidence: input.matchConfidence,
        nextSessionDate: input.nextSessionDate,
        overnightGap: input.overnightGap,
        score: input.score,
        sessionRange: input.sessionRange,
        tradeDate: input.analogReference,
      },
    ],
    historicalAnalogs,
    label: input.label,
    score: input.score,
    tradeDate: input.tradeDate,
  };
}

function buildNews(headlines: readonly string[]): DailyBriefingNewsResult {
  return {
    disclaimer: null,
    headlines: [...headlines],
    status: 'available',
    summary: summarizeHeadlines(headlines),
  };
}

function parseSections(newsletterCopy: string): ParsedSection[] {
  const normalizedNewsletterCopy = normalizeSectionBoundaries(newsletterCopy);
  const sectionPattern = new RegExp(
    `^(${REGIME_TEST_SECTION_ORDER.map(escapeRegExp).join('|')}):?\\s*(.*)$`,
  );
  const sections: ParsedSection[] = [];
  let activeSection: ParsedSection['title'] | null = null;
  let activeLines: string[] = [];

  const flush = () => {
    if (!activeSection) {
      return;
    }

    sections.push({
      content: activeLines.join('\n').trim(),
      title: activeSection,
    });
  };

  for (const line of normalizedNewsletterCopy.split('\n')) {
    const trimmedLine = line.trim();
    const sectionMatch = trimmedLine.match(sectionPattern);

    if (sectionMatch) {
      flush();
      activeSection = sectionMatch[1] as ParsedSection['title'];
      activeLines = sectionMatch[2] ? [sectionMatch[2].trim()] : [];
      continue;
    }

    if (!activeSection) {
      continue;
    }

    activeLines.push(line.trimEnd());
  }

  flush();

  return sections;
}

function validatePromptContract(
  scenario: RegimeScenario,
  briefing: DailyBriefingResult,
): PromptValidationResult {
  const criticalIssues: string[] = [];
  const warnings: string[] = [];
  const sections = parseSections(briefing.newsletterCopy);
  const playbookSection = sections.find(
    (section) => section.title === DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook,
  )?.content;
  const quantCorner = sections.find(
    (section) => section.title === DAILY_BRIEFING_SECTION_HEADERS.quantCorner,
  )?.content;
  const hedgeWordPattern = /\b(maybe|perhaps|appears|seems|likely|potentially|arguably|could)\b/i;

  if (sections.length !== REGIME_TEST_SECTION_ORDER.length) {
    console.log(`[regime-test] Raw newsletter copy for ${scenario.name}:`);
    console.log(briefing.newsletterCopy);
  }

  if (briefing.generatedBy !== 'anthropic') {
    criticalIssues.push(
      `[${scenario.name}] Expected Anthropic synthesis, received ${briefing.generatedBy}.`,
    );
  }

  if (briefing.isOverrideActive !== scenario.expectedOverrideActive) {
    criticalIssues.push(
      `[${scenario.name}] Expected overrideActive=${scenario.expectedOverrideActive}, received ${briefing.isOverrideActive}.`,
    );
  }

  if (sections.length !== REGIME_TEST_SECTION_ORDER.length) {
    criticalIssues.push(
      `[${scenario.name}] Expected ${REGIME_TEST_SECTION_ORDER.length} sections, received ${sections.length}.`,
    );
  }

  if (!sections.every((section, index) => section.title === REGIME_TEST_SECTION_ORDER[index])) {
    criticalIssues.push(`[${scenario.name}] Section order drift detected in newsletter copy.`);
  }

  if (briefing.newsletterCopy.includes('Sector | Sector Bias | Driving Catalyst')) {
    criticalIssues.push(
      `[${scenario.name}] LLM emitted deprecated playbook table syntax.`,
    );
  }

  if (!playbookSection) {
    criticalIssues.push(`[${scenario.name}] Missing ${DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook} content.`);
  } else {
    const playbookLines = playbookSection
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (playbookLines.length === 0 || !playbookLines.every((line) => PLAYBOOK_BULLET_PATTERN.test(line))) {
      criticalIssues.push(
        `[${scenario.name}] ${DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook} must be a bulleted list using the strict sector:bias:catalyst syntax.`,
      );
    }
  }

  if (!quantCorner) {
    criticalIssues.push(`[${scenario.name}] Missing ${DAILY_BRIEFING_SECTION_HEADERS.quantCorner} content.`);
  }

  if (hedgeWordPattern.test(briefing.newsletterCopy)) {
    warnings.push(`[${scenario.name}] Hedge-word warning: newsletter_copy contains banned hedge language.`);
  }

  if (!briefing.newsletterCopy.includes('**')) {
    criticalIssues.push(`[${scenario.name}] Missing mandatory Markdown bold emphasis in newsletter_copy.`);
  }

  return {
    criticalIssues,
    warnings,
  };
}

function validateRenderedEmail(
  scenario: RegimeScenario,
  tier: QuantBriefingTier,
  emailContent: ReturnType<typeof createQuantBriefingEmailContent>,
  briefing: DailyBriefingResult,
) {
  const playbookLines =
    parseSections(briefing.newsletterCopy)
      .find((section) => section.title === DAILY_BRIEFING_SECTION_HEADERS.regimePlaybook)
      ?.content.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0) ?? [];

  assert(
    emailContent.subject.includes(scenario.expectedOverrideActive ? 'HIGH ALERT' : 'CONTAINED'),
    `[${scenario.name}] Subject did not reflect the expected regime state.`,
  );
  assert(
    emailContent.html.includes('[SYSTEM OUTPUT] ALGO BIAS'),
    `[${scenario.name}] HTML render lost the Algo Bias system label.`,
  );
  assert(
    emailContent.html.includes('[SYSTEM OUTPUT] OVERLAY'),
    `[${scenario.name}] HTML render lost the Overlay system label.`,
  );
  assert(
    emailContent.html.includes('<ul'),
    `[${scenario.name}] HTML render failed to convert the playbook into a semantic list.`,
  );
  assert(
    emailContent.html.includes('<li'),
    `[${scenario.name}] HTML render lost the playbook list items.`,
  );
  assert(
    PLAYBOOK_BIAS_HTML_PATTERN.test(emailContent.html),
    `[${scenario.name}] HTML render failed to apply inline semantic bias highlighting.`,
  );
  assert(
    !emailContent.html.includes('Driving Catalyst'),
    `[${scenario.name}] HTML render kept the deprecated playbook table header.`,
  );
  assert(
    !emailContent.html.includes('--- | --- | ---'),
    `[${scenario.name}] Raw Markdown divider leaked into the HTML output.`,
  );
  assert(
    emailContent.text.includes('[SYSTEM OUTPUT] ALGO BIAS:'),
    `[${scenario.name}] Plain-text render lost the terminal summary.`,
  );

  if (tier === 'premium') {
    assert(
      emailContent.html.includes(DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus),
      `[${scenario.name}] Premium HTML render lost the ${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus} section.`,
    );
    assert(
      emailContent.html.includes(DAILY_BRIEFING_SECTION_HEADERS.quantCorner),
      `[${scenario.name}] Premium HTML render lost the ${DAILY_BRIEFING_SECTION_HEADERS.quantCorner} section.`,
    );

    return;
  }

  assert(
    emailContent.html.includes('UPGRADE TO PREMIUM'),
    `[${scenario.name}] Free HTML render lost the upgrade CTA button.`,
  );
  assert(
    emailContent.html.includes(FREE_TIER_PAYWALL_MESSAGE),
    `[${scenario.name}] Free HTML render lost the premium paywall message.`,
  );
  assert(
    emailContent.text.includes(FREE_TIER_PAYWALL_MESSAGE),
    `[${scenario.name}] Free text render lost the premium paywall message.`,
  );
  assert(
    emailContent.html.includes('[LOCKED]'),
    `[${scenario.name}] Free HTML render lost the locked playbook teaser row.`,
  );
  assert(
    emailContent.text.includes(FREE_TIER_LOCKED_PLAYBOOK_TEXT),
    `[${scenario.name}] Free text render lost the locked playbook teaser row.`,
  );
  assert(
    !emailContent.html.includes(DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus),
    `[${scenario.name}] Free HTML render leaked the ${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus} section.`,
  );
  assert(
    !emailContent.html.includes(DAILY_BRIEFING_SECTION_HEADERS.quantCorner),
    `[${scenario.name}] Free HTML render leaked the ${DAILY_BRIEFING_SECTION_HEADERS.quantCorner} section.`,
  );
  assert(
    !emailContent.text.includes(DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus),
    `[${scenario.name}] Free text render leaked the ${DAILY_BRIEFING_SECTION_HEADERS.macroOverrideStatus} section.`,
  );
  assert(
    !emailContent.text.includes(DAILY_BRIEFING_SECTION_HEADERS.quantCorner),
    `[${scenario.name}] Free text render leaked the ${DAILY_BRIEFING_SECTION_HEADERS.quantCorner} section.`,
  );

  if (playbookLines[0]) {
    assert(
      emailContent.text.includes(stripMarkdownBold(playbookLines[0])),
      `[${scenario.name}] Free text render lost the first visible playbook item.`,
    );
  }

  for (const hiddenLine of playbookLines.slice(1)) {
    assert(
      !emailContent.text.includes(stripMarkdownBold(hiddenLine)),
      `[${scenario.name}] Free text render leaked a hidden playbook line.`,
    );
  }
}

async function runScenario(scenario: RegimeScenario, shadowRunEmail: string) {
  console.log(`[regime-test] Running ${scenario.name}...`);

  const briefing = await generateDailyBriefingFromContext(scenario.quant, scenario.news);
  console.log(
    `[regime-test] ${scenario.name}: generatedBy=${briefing.generatedBy}, overrideActive=${briefing.isOverrideActive}`,
  );

  for (const warning of briefing.warnings) {
    console.warn(`[regime-test] ${scenario.name} generation warning: ${warning}`);
  }

  const promptValidation = validatePromptContract(scenario, briefing);

  if (promptValidation.criticalIssues.length > 0) {
    console.log(`[regime-test] Raw newsletter copy for ${scenario.name}:`);
    console.log(briefing.newsletterCopy);
  }

  assert(
    /\*\*/.test(briefing.newsletterCopy),
    `[${scenario.name}] Missing mandatory Markdown bold emphasis in newsletter_copy.`,
  );
  assert(
    promptValidation.criticalIssues.length === 0,
    promptValidation.criticalIssues.join(' '),
  );

  const premiumEmailContent = createQuantBriefingEmailContent(
    briefing.newsletterCopy,
    briefing.quant.score,
    briefing.quant.label,
    briefing.isOverrideActive,
    'premium',
  );
  const freeEmailContent = createQuantBriefingEmailContent(
    briefing.newsletterCopy,
    briefing.quant.score,
    briefing.quant.label,
    briefing.isOverrideActive,
    'free',
  );

  validateRenderedEmail(scenario, 'premium', premiumEmailContent, briefing);
  validateRenderedEmail(scenario, 'free', freeEmailContent, briefing);

  console.log(
    `[regime-test] ${scenario.name}: generatedBy=${briefing.generatedBy}, overrideActive=${briefing.isOverrideActive}, premium subject="${premiumEmailContent.subject}"`,
  );
  console.log(`[regime-test] ${scenario.name}: free-tier text preview follows:`);
  console.log(freeEmailContent.text);

  for (const warning of promptValidation.warnings) {
    console.warn(`[regime-test] ${warning}`);
  }

  const premiumDispatchResult = await dispatchQuantBriefing(
    briefing.newsletterCopy,
    briefing.quant.score,
    briefing.quant.label,
    briefing.isOverrideActive,
    {
      recipients: [shadowRunEmail],
      tier: 'premium',
    },
  );
  const freeDispatchResult = await dispatchQuantBriefing(
    briefing.newsletterCopy,
    briefing.quant.score,
    briefing.quant.label,
    briefing.isOverrideActive,
    {
      recipients: [shadowRunEmail],
      tier: 'free',
    },
  );

  assert(
    premiumDispatchResult.recipientCount === 1,
    `[${scenario.name}] Expected exactly one premium shadow recipient, dispatched to ${premiumDispatchResult.recipientCount}.`,
  );
  assert(
    freeDispatchResult.recipientCount === 1,
    `[${scenario.name}] Expected exactly one free shadow recipient, dispatched to ${freeDispatchResult.recipientCount}.`,
  );

  console.log(
    `[regime-test] ${scenario.name}: dispatched premium (${premiumDispatchResult.emailIds.length} id(s)) and free (${freeDispatchResult.emailIds.length} id(s)) shadow emails.`,
  );

  return {
    criticalIssues: promptValidation.criticalIssues,
    freeDispatchResult,
    freeEmailContent,
    premiumDispatchResult,
    promptWarnings: promptValidation.warnings,
    briefing,
  };
}

async function main() {
  const shadowRunEmail = getRequiredServerEnv('SHADOW_RUN_EMAIL').trim();

  getRequiredServerEnv('ANTHROPIC_API_KEY');
  getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_URL');
  getRequiredServerEnv('RESEND_API_KEY');
  getRequiredServerEnv('SUPABASE_SERVICE_ROLE_KEY');

  assert(shadowRunEmail.length > 0, 'SHADOW_RUN_EMAIL must be configured for the regime test.');

  const scenarios: RegimeScenario[] = [
    {
      expectedOverrideActive: true,
      name: 'Scenario A / The Shock',
      news: buildNews([
        'Israeli strikes in Lebanon result in 250 fatalities',
        'Constellation Energy withdraws 2028 guidance citing tariff anxiety',
        'Iran leverages Hormuz transit to pressure regional shipping lanes',
      ]),
      quant: buildQuantContext({
        analogReference: '2025-10-17',
        intradayNet: -0.27,
        label: 'NEUTRAL',
        matchConfidence: 0.81,
        nextSessionDate: '2025-10-20',
        overnightGap: -0.21,
        score: -1,
        sessionRange: 2.14,
        tradeDate: '2026-04-09',
      }),
    },
    {
      expectedOverrideActive: false,
      name: 'Scenario B / The Quiet Tape',
      news: buildNews([
        'Routine auction calendar clears without drama',
        'Apple announces minor software update',
        'S&P futures trade flat overnight ahead of the open',
      ]),
      quant: buildQuantContext({
        analogReference: '2025-02-12',
        intradayNet: 0.18,
        label: 'RISK_ON',
        matchConfidence: 0.76,
        nextSessionDate: '2025-02-13',
        overnightGap: 0.09,
        score: 1,
        sessionRange: 0.88,
        tradeDate: '2026-04-09',
      }),
    },
  ];

  console.log('[regime-test] Starting pre-flight regime test in shadow mode only.');

  const results = [] as Array<Awaited<ReturnType<typeof runScenario>>>;

  for (const scenario of scenarios) {
    results.push(await runScenario(scenario, shadowRunEmail));
  }

  const warningCount = results.reduce(
    (count, result) => count + result.promptWarnings.length,
    0,
  );
  const criticalIssueCount = results.reduce(
    (count, result) => count + result.criticalIssues.length,
    0,
  );

  console.log(
    `[regime-test] Completed ${results.length} regime scenarios. Free and premium shadow emails were dispatched to the configured SHADOW_RUN_EMAIL recipient.`,
  );
  console.log(`[regime-test] Prompt/style warnings raised: ${warningCount}.`);

  if (criticalIssueCount > 0) {
    console.error(`[regime-test] Critical prompt-contract issues raised: ${criticalIssueCount}.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);

  console.error('[regime-test] Pre-flight regime test failed.');
  console.error(message);
  process.exitCode = 1;
});