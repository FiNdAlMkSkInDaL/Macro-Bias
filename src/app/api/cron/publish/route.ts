import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { TwitterApi } from 'twitter-api-v2';

import {
  isSubscriptionActive,
  type SubscriptionStatus,
} from '../../../../lib/billing/subscription';
import type { HistoricalAnalogsPayload } from '../../../../lib/market-data/derive-historical-analogs';
import { generateDailyBriefing } from '../../../../lib/briefing/daily-brief-generator';
import { persistDailyBriefing } from '../../../../lib/briefing/persist-daily-briefing';
import type {
  DailyBriefingAnalogMatch,
  StoredBiasSnapshot,
} from '../../../../lib/briefing/types';
import { dispatchQuantBriefing } from '../../../../lib/marketing/email-dispatch';
import type { BiasLabel } from '../../../../lib/macro-bias/types';
import { upsertDailyMarketData } from '../../../../lib/market-data/upsert-daily-market-data';
import { partitionUnlockedSubscribers } from '../../../../lib/referral/premium-unlock';
import { verifyPendingReferrals } from '../../../../lib/referral/verify-referrals';
import { getAppUrl } from '../../../../lib/server-env';
import { isBlueskyConfigured, publishToBluesky } from '../../../../lib/social/bluesky';
import { sanitizeForSocial } from '../../../../lib/social/sanitize';
import { isTelegramConfigured, publishToTelegram } from '../../../../lib/social/telegram';
import { isThreadsConfigured, publishToThreads } from '../../../../lib/social/threads';
import { getWeeklyDigestData } from '../../../../lib/briefing/weekly-digest-data';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const revalidate = 0;

const EMAIL_RECIPIENT_PAGE_SIZE = 1000;
const MAX_HISTORY_ROWS = 180;
const MACRO_OVERRIDE_X_SNIPPET_LENGTH = 120;
const DISCORD_PUBLISHING_ENABLED = false;

type PublishPayload = {
  analogs: DailyBriefingAnalogMatch[];
  dashboardUrl: string;
  discordText: string;
  headline: string;
  ogImageUrl: string;
  playbookSummary: string | null;
  regimeSentence: string;
  shareUrl: string;
  xText: string;
};

type XCredentials = {
  accessToken: string;
  accessSecret: string;
  apiKey: string;
  apiSecret: string;
};

type PublishDestination = 'bluesky' | 'discord' | 'email' | 'telegram' | 'threads' | 'x';

type PublishResult = {
  destination: PublishDestination;
  failure?: string;
  ok: boolean;
};

type BriefingRecipientRow = {
  email: string | null;
  subscription_status: SubscriptionStatus;
};

type FreeSubscriberRow = {
  email: string | null;
  status: 'active' | 'inactive' | null;
  tier: 'free' | null;
};

type TieredQuantBriefingRecipients = {
  freeRecipients: string[];
  premiumRecipients: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatDisplayDate(tradeDate: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${tradeDate}T00:00:00Z`));
}

function formatSignedNumber(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function formatSignedPercent(value: number) {
  const roundedValue = Number(value.toFixed(2));
  return `${roundedValue > 0 ? '+' : ''}${roundedValue}%`;
}

function formatOptionalSignedPercent(value: number | null) {
  return value == null ? 'n/a' : formatSignedPercent(value);
}

function formatOptionalUnsignedPercent(value: number | null) {
  if (value == null) {
    return 'n/a';
  }

  return `${Math.abs(Number(value.toFixed(2)))}%`;
}

function buildXSnippet(text: string, maxLength: number) {
  // Collapse to single line for snippet use
  const normalizedText = sanitizeForSocial(text).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

  if (normalizedText.length <= maxLength) {
    return normalizedText;
  }

  return `${normalizedText.slice(0, maxLength - 1).trimEnd()}…`;
}

function getRegimeTone(label: BiasLabel) {
  switch (label) {
    case 'EXTREME_RISK_ON':
    case 'RISK_ON':
      return 'Buyers are in control and the market has room to run.';
    case 'EXTREME_RISK_OFF':
    case 'RISK_OFF':
      return 'Sellers are in control and risk is getting punished.';
    default:
      return 'Signals are mixed, so being selective matters more than usual.';
  }
}

function getRegimeSentence(label: BiasLabel) {
  switch (label) {
    case 'EXTREME_RISK_ON':
      return 'The market is running hot. Aggressive buying across the board.';
    case 'RISK_ON':
      return 'Buyers are stepping in. Momentum is building.';
    case 'EXTREME_RISK_OFF':
      return 'Selling is accelerating. Defensive names are leading.';
    case 'RISK_OFF':
      return 'The market is heavy. Money is rotating into safety.';
    default:
      return 'No clear direction. Picking your spots carefully matters here.';
  }
}

function getColorForLabel(label: BiasLabel) {
  switch (label) {
    case 'EXTREME_RISK_ON':
    case 'RISK_ON':
      return 0x22c55e;
    case 'EXTREME_RISK_OFF':
    case 'RISK_OFF':
      return 0xf97316;
    default:
      return 0xf59e0b;
  }
}

function getOptionalServerEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getRequiredXEnv(name: 'X_API_KEY' | 'X_API_SECRET' | 'X_ACCESS_TOKEN' | 'X_ACCESS_SECRET') {
  const value = getOptionalServerEnv(name);

  if (!value) {
    throw new Error(`Missing required X environment variable: ${name}`);
  }

  return value;
}

function getXCredentials() {
  const legacyApiSecret = getOptionalServerEnv('X_API_KEY_SECRET');
  const legacyAccessSecret = getOptionalServerEnv('X_ACCESS_TOKEN_SECRET');
  const hasAnyXCredential = Boolean(
    getOptionalServerEnv('X_API_KEY') ||
      getOptionalServerEnv('X_API_SECRET') ||
      getOptionalServerEnv('X_ACCESS_TOKEN') ||
      getOptionalServerEnv('X_ACCESS_SECRET') ||
      legacyApiSecret ||
      legacyAccessSecret,
  );

  if (!hasAnyXCredential) {
    return null;
  }

  return {
    apiKey: getRequiredXEnv('X_API_KEY'),
    apiSecret: getOptionalServerEnv('X_API_SECRET') ?? legacyApiSecret ?? getRequiredXEnv('X_API_SECRET'),
    accessToken: getRequiredXEnv('X_ACCESS_TOKEN'),
    accessSecret:
      getOptionalServerEnv('X_ACCESS_SECRET') ?? legacyAccessSecret ?? getRequiredXEnv('X_ACCESS_SECRET'),
  } satisfies XCredentials;
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getProvidedCronSecret(request: NextRequest) {
  const authorizationHeader = request.headers.get('authorization');

  if (authorizationHeader?.startsWith('Bearer ')) {
    return authorizationHeader.slice('Bearer '.length).trim();
  }

  return request.headers.get('x-cron-secret')?.trim() ?? null;
}

function isAuthorizedCronRequest(request: NextRequest) {
  const expectedSecret = getOptionalServerEnv('CRON_SECRET') ?? getOptionalServerEnv('PUBLISH_CRON_SECRET');

  if (!expectedSecret) {
    throw new Error('Missing CRON_SECRET. Configure it before enabling the publish cron route.');
  }

  const providedSecret = getProvidedCronSecret(request);

  return Boolean(providedSecret && safeCompare(providedSecret, expectedSecret));
}

function getTickerPercentChange(
  engineInputs: unknown,
  section: 'coreTickerChanges' | 'supplementalTickerChanges',
  ticker: string,
) {
  if (!isRecord(engineInputs)) {
    return null;
  }

  const sectionValue = engineInputs[section];

  if (!isRecord(sectionValue)) {
    return null;
  }

  const tickerValue = sectionValue[ticker];

  if (!isRecord(tickerValue)) {
    return null;
  }

  return getNumber(tickerValue.percentChange);
}

function buildPlaybookSummary(
  historicalAnalogs: HistoricalAnalogsPayload | null,
  variant: 'discord' | 'x',
) {
  if (!historicalAnalogs || historicalAnalogs.topMatches.length === 0) {
    return null;
  }

  const analogCount = historicalAnalogs.topMatches.length;
  const prefix =
    variant === 'x'
      ? `Historical pattern avg (${analogCount} matches)`
      : `Historical pattern avg across ${analogCount} closest matches`;

  return `${prefix}: Gap ${formatOptionalSignedPercent(historicalAnalogs.clusterAveragePlaybook.overnightGap)}, Intraday ${formatOptionalSignedPercent(historicalAnalogs.clusterAveragePlaybook.intradayNet)}, Range ${formatOptionalUnsignedPercent(historicalAnalogs.clusterAveragePlaybook.sessionRange)}`;
}

function buildAnalogSection(analogs: DailyBriefingAnalogMatch[]) {
  if (analogs.length === 0) {
    return 'Not enough history yet to show pattern matches. More data is accumulating.';
  }

  return analogs
    .map((analog, index) => {
      const scoreText = analog.score == null ? '' : ` ${formatSignedNumber(analog.score)}`;
      const labelText = analog.biasLabel ? ` ${analog.biasLabel.replace(/_/g, ' ')}` : '';
      return `${index + 1}. ${formatDisplayDate(analog.tradeDate)}${labelText}${scoreText} (${analog.matchConfidence}%)`;
    })
    .join(' | ');
}

function buildSignalContext(snapshot: StoredBiasSnapshot) {
  const spy = getTickerPercentChange(snapshot.engine_inputs, 'coreTickerChanges', 'SPY');
  const vix = getTickerPercentChange(snapshot.engine_inputs, 'supplementalTickerChanges', 'VIX');
  const hyg = getTickerPercentChange(snapshot.engine_inputs, 'supplementalTickerChanges', 'HYG');
  const contextFragments = [
    spy == null ? null : `SPY ${formatSignedPercent(spy)}`,
    vix == null ? null : `VIX ${formatSignedPercent(vix)}`,
    hyg == null ? null : `HYG ${formatSignedPercent(hyg)}`,
  ].filter((fragment): fragment is string => Boolean(fragment));

  return contextFragments.join(' | ');
}

async function getTieredQuantBriefingRecipients(): Promise<TieredQuantBriefingRecipients> {
  const supabase = createSupabaseAdminClient();
  const freeEmailsByNormalizedValue = new Map<string, string>();
  const premiumEmailsByNormalizedValue = new Map<string, string>();

  for (let offset = 0; ; offset += EMAIL_RECIPIENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('users')
      .select('email, subscription_status')
      .in('subscription_status', ['active', 'trialing'])
      .not('email', 'is', null)
      .order('email', { ascending: true })
      .range(offset, offset + EMAIL_RECIPIENT_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load email recipients for publish cron: ${error.message}`);
    }

    const rows = (data as BriefingRecipientRow[] | null) ?? [];
    console.log(`[publish-cron] Loaded ${rows.length} user billing rows at offset ${offset}`);

    for (const row of rows) {
      if (typeof row.email !== 'string') {
        continue;
      }

      const email = row.email.trim();

      if (!email) {
        continue;
      }

      const normalizedEmail = email.toLowerCase();
      const subscriptionStatus = row.subscription_status ?? 'inactive';

      if (isSubscriptionActive(subscriptionStatus)) {
        premiumEmailsByNormalizedValue.set(normalizedEmail, email);
        freeEmailsByNormalizedValue.delete(normalizedEmail);
      }
    }

    if (rows.length < EMAIL_RECIPIENT_PAGE_SIZE) {
      break;
    }
  }

  for (let offset = 0; ; offset += EMAIL_RECIPIENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('free_subscribers')
      .select('email, status, tier')
      .eq('status', 'active')
      .eq('tier', 'free')
      .eq('stocks_opted_in', true)
      .order('email', { ascending: true })
      .range(offset, offset + EMAIL_RECIPIENT_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load free subscriber recipients for publish cron: ${error.message}`);
    }

    const rows = (data as FreeSubscriberRow[] | null) ?? [];
    console.log(`[publish-cron] Loaded ${rows.length} free subscriber rows at offset ${offset}`);

    for (const row of rows) {
      if (typeof row.email !== 'string') {
        continue;
      }

      const email = row.email.trim();

      if (!email) {
        continue;
      }

      const normalizedEmail = email.toLowerCase();

      if (!premiumEmailsByNormalizedValue.has(normalizedEmail)) {
        freeEmailsByNormalizedValue.set(normalizedEmail, email);
      }
    }

    if (rows.length < EMAIL_RECIPIENT_PAGE_SIZE) {
      break;
    }
  }

  return {
    freeRecipients: [...freeEmailsByNormalizedValue.values()],
    premiumRecipients: [...premiumEmailsByNormalizedValue.values()],
  };
}

function buildPublishPayload(
  snapshot: StoredBiasSnapshot,
  historicalAnalogs: HistoricalAnalogsPayload | null,
  analogs: DailyBriefingAnalogMatch[],
) {
  const appUrl = getAppUrl();
  const dashboardUrl = new URL('/dashboard', appUrl).toString();
  const ogImageUrl = new URL('/api/og', appUrl).toString();
  const shareUrl = new URL('/', appUrl);
  shareUrl.searchParams.set('d', snapshot.trade_date);
  shareUrl.searchParams.set('utm_source', 'twitter');
  shareUrl.searchParams.set('utm_medium', 'social');
  shareUrl.searchParams.set('utm_campaign', 'daily_briefing');
  const formattedDate = formatDisplayDate(snapshot.trade_date);
  const label = snapshot.bias_label.replace(/_/g, ' ');
  const headline = `Today's Macro Weather Report: ${label} (${formatSignedNumber(snapshot.score)})`;
  const regimeTone = getRegimeTone(snapshot.bias_label);
  const regimeSentence = getRegimeSentence(snapshot.bias_label);
  const signalContext = buildSignalContext(snapshot);
  const analogSection = buildAnalogSection(analogs);
  const discordPlaybookSummary = buildPlaybookSummary(historicalAnalogs, 'discord');
  const xPlaybookSummary = buildPlaybookSummary(historicalAnalogs, 'x');
  const discordText = [
    `**${headline}**`,
    `${formattedDate}`,
    regimeTone,
    signalContext ? `Signal tape: ${signalContext}` : null,
    discordPlaybookSummary,
    `Closest historical analogs: ${analogSection}`,
    `Open the live dashboard: ${dashboardUrl}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
  const xText = sanitizeForSocial([
    `Today's Macro Bias: ${formatSignedNumber(snapshot.score)} (${label})`,
    regimeSentence,
    xPlaybookSummary,
    `Free daily briefing: macro-bias.com/emails?utm_source=x&utm_campaign=daily`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n'));

  return {
    analogs,
    dashboardUrl,
    discordText,
    headline,
    ogImageUrl,
    playbookSummary: discordPlaybookSummary,
    regimeSentence,
    shareUrl: shareUrl.toString(),
    xText,
  } satisfies PublishPayload;
}

function buildMacroOverrideXText(
  snapshot: StoredBiasSnapshot,
  publishPayload: PublishPayload,
  newsletterCopy: string,
) {
  const label = snapshot.bias_label.replace(/_/g, ' ');
  const rationaleSnippet = buildXSnippet(newsletterCopy, MACRO_OVERRIDE_X_SNIPPET_LENGTH);

  return [
    'MACRO OVERRIDE ACTIVE',
    `Today's Macro Bias Score: ${formatSignedNumber(snapshot.score)} (${label})`,
    rationaleSnippet,
    `Free daily briefing: macro-bias.com/emails?utm_source=x&utm_campaign=override`,
  ].join('\n\n');
}

async function postJson(url: string, payload: unknown, destinationName: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (response.ok) {
    return;
  }

  const responseText = (await response.text()).slice(0, 400);
  throw new Error(`${destinationName} responded with ${response.status}: ${responseText}`);
}

async function publishToDiscord(webhookUrl: string, snapshot: StoredBiasSnapshot, payload: PublishPayload) {
  await postJson(
    webhookUrl,
    {
      username: 'Macro Bias',
      allowed_mentions: {
        parse: [],
      },
      content: payload.discordText,
      embeds: [
        {
          title: payload.headline,
          description: payload.discordText,
          url: payload.dashboardUrl,
          color: getColorForLabel(snapshot.bias_label),
          image: {
            url: payload.ogImageUrl,
          },
          footer: {
            text: `Model ${snapshot.model_version ?? 'macro-model-v2'} · ${snapshot.trade_date}`,
          },
        },
      ],
    },
    'Discord webhook',
  );
}

async function publishToX(credentials: XCredentials, payload: PublishPayload) {
  const xClient = new TwitterApi({
    appKey: credentials.apiKey,
    appSecret: credentials.apiSecret,
    accessToken: credentials.accessToken,
    accessSecret: credentials.accessSecret,
  });

  try {
    await xClient.v2.tweet(payload.xText);
  } catch (err: unknown) {
    if (isRecord(err) && (isRecord(err.data) || isRecord(err.errors))) {
      const twitterData = isRecord(err.data) ? err.data : err.errors;
      const detail = JSON.stringify(twitterData).slice(0, 500);
      const status = typeof err.code === 'number' ? err.code : 'unknown';
      throw new Error(`Twitter API error (HTTP ${status}): ${detail}`);
    }

    throw err;
  }
}

async function safePublish(destination: PublishDestination, publish: () => Promise<void>) {
  try {
    await publish();

    return {
      destination,
      ok: true,
    } satisfies PublishResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown publish failure.';
    console.warn(`[publish-cron] ${destination} publish failed: ${message}`);

    return {
      destination,
      failure: message,
      ok: false,
    } satisfies PublishResult;
  }
}

async function getRecentSnapshots() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('macro_bias_scores')
    .select('trade_date, score, bias_label, component_scores, model_version, engine_inputs, technical_indicators')
    .order('trade_date', { ascending: false })
    .limit(MAX_HISTORY_ROWS);

  if (error) {
    throw error;
  }

  return (data as StoredBiasSnapshot[] | null) ?? [];
}

async function hasDailyBriefingForDate(briefingDate: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('daily_market_briefings')
    .select('id')
    .eq('briefing_date', briefingDate)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check existing daily briefing state: ${error.message}`);
  }

  return Boolean(data);
}

const VALID_BIAS_LABELS = new Set<BiasLabel>([
  'EXTREME_RISK_OFF',
  'RISK_OFF',
  'NEUTRAL',
  'RISK_ON',
  'EXTREME_RISK_ON',
]);

function isValidSnapshot(snapshot: StoredBiasSnapshot): boolean {
  return (
    VALID_BIAS_LABELS.has(snapshot.bias_label) &&
    typeof snapshot.score === 'number' &&
    Number.isFinite(snapshot.score) &&
    isRecord(snapshot.engine_inputs)
  );
}

async function handlePublish(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const skipEmail = request.nextUrl.searchParams.get('skipEmail') === 'true';
    const briefingDate = new Date().toISOString().slice(0, 10);
    const briefingAlreadyGenerated = await hasDailyBriefingForDate(briefingDate);

    const discordWebhookUrl = DISCORD_PUBLISHING_ENABLED
      ? getOptionalServerEnv('DISCORD_PUBLISH_WEBHOOK_URL')
      : null;
    const resendApiKeyConfigured = Boolean(getOptionalServerEnv('RESEND_API_KEY'));
    const xCredentials = getXCredentials();

    if (!discordWebhookUrl && !resendApiKeyConfigured && !xCredentials && !isBlueskyConfigured()) {
      return NextResponse.json(
        {
          error:
            'No active publish destinations are configured. Set RESEND_API_KEY, X API credentials, and/or Bluesky credentials to enable cron publishing.',
        },
        { status: 500 },
      );
    }

    let dailyBriefing: Awaited<ReturnType<typeof generateDailyBriefing>>;
    let latestSnapshot: StoredBiasSnapshot;
    const warnings: string[] = [];

    if (briefingAlreadyGenerated) {
      // Briefing already generated today – load it from the database for re-publishing.
      // This handles the case where a previous run generated the briefing but publishing
      // (email, X, or Bluesky) failed.
      console.log(
        `[publish-cron] Briefing already generated for ${briefingDate}; attempting to re-publish.`,
      );

      const snapshots = await getRecentSnapshots();

      if (snapshots.length === 0) {
        return NextResponse.json(
          { error: 'Briefing generated but no macro bias snapshots available for publish payload.' },
          { status: 404 },
        );
      }

      let latestSnapshotIndex = 0;
      while (
        latestSnapshotIndex < snapshots.length &&
        !isValidSnapshot(snapshots[latestSnapshotIndex])
      ) {
        latestSnapshotIndex += 1;
      }

      if (latestSnapshotIndex >= snapshots.length) {
        return NextResponse.json(
          { error: 'No valid macro bias snapshots found for re-publish.' },
          { status: 404 },
        );
      }

      latestSnapshot = snapshots[latestSnapshotIndex];

      // Re-generate the briefing from context so we have all the data needed for publishing
      dailyBriefing = await generateDailyBriefing(latestSnapshot, snapshots);
      warnings.push('Re-publish run: briefing was already persisted from a prior invocation.');
    } else {
      // Normal flow: sync market data, generate, persist, then publish.
      let upsertSucceeded = false;

      try {
        console.log('[publish-cron] Starting upsertDailyMarketData()');
        const upsertedBias = await upsertDailyMarketData();
        console.log(
          `[publish-cron] Finished upsertDailyMarketData() with trade date ${upsertedBias.tradeDate}`,
        );
        upsertSucceeded = true;
      } catch (upsertError) {
        const upsertMessage = upsertError instanceof Error ? upsertError.message : 'Unknown market data sync failure.';
        console.warn(`[publish-cron] upsertDailyMarketData() failed: ${upsertMessage}. Falling back to cached snapshots.`);
        warnings.push(`Market data sync failed (falling back to cached data): ${upsertMessage}`);
      }

      const snapshots = await getRecentSnapshots();

      if (snapshots.length === 0) {
        return NextResponse.json(
          {
            error: upsertSucceeded
              ? 'No macro bias snapshots are available to publish.'
              : 'Market data sync failed and no cached snapshots are available.',
          },
          { status: 404 },
        );
      }

      let latestSnapshotIndex = 0;

      while (
        latestSnapshotIndex < snapshots.length &&
        !isValidSnapshot(snapshots[latestSnapshotIndex])
      ) {
        console.warn(
          `[publish-cron] Skipping snapshot for ${snapshots[latestSnapshotIndex].trade_date} - missing or incomplete data (market holiday?). Stepping back to prior session.`,
        );
        latestSnapshotIndex += 1;
      }

      if (latestSnapshotIndex >= snapshots.length) {
        return NextResponse.json(
          { error: 'No valid macro bias snapshots found. The most recent trading sessions may all be missing data.' },
          { status: 404 },
        );
      }

      latestSnapshot = snapshots[latestSnapshotIndex];
      console.log('[publish-cron] Starting generateDailyBriefing()');
      dailyBriefing = await generateDailyBriefing(latestSnapshot, snapshots);
      console.log(
        `[publish-cron] Finished generateDailyBriefing() with overrideActive=${dailyBriefing.isOverrideActive} via ${dailyBriefing.generatedBy}`,
      );

      console.log('[publish-cron] Starting persistDailyBriefing()');
      await persistDailyBriefing({
        briefing: dailyBriefing,
        briefingDate,
      });
      console.log(`[publish-cron] Finished persistDailyBriefing() for ${briefingDate}`);
    }

    const failures = [...warnings, ...dailyBriefing.warnings];
    const publishPayload = buildPublishPayload(
      latestSnapshot,
      dailyBriefing.quant.historicalAnalogs,
      dailyBriefing.quant.analogs,
    );
    const finalPublishPayload = dailyBriefing.isOverrideActive
      ? {
          ...publishPayload,
          xText: buildMacroOverrideXText(
            latestSnapshot,
            publishPayload,
            dailyBriefing.newsletterCopy,
          ),
        }
      : publishPayload;
    const publishResults: PublishResult[] = [];

    if (DISCORD_PUBLISHING_ENABLED && discordWebhookUrl) {
      publishResults.push(
        await safePublish('discord', () =>
          publishToDiscord(discordWebhookUrl, latestSnapshot, finalPublishPayload),
        ),
      );
    }

    if (xCredentials) {
      publishResults.push(await safePublish('x', () => publishToX(xCredentials, finalPublishPayload)));
    }

    if (isBlueskyConfigured()) {
      publishResults.push(
        await safePublish('bluesky', () => publishToBluesky(finalPublishPayload.xText).then(() => undefined)),
      );
    }

    if (isTelegramConfigured()) {
      publishResults.push(
        await safePublish('telegram', () => publishToTelegram(finalPublishPayload.xText).then(() => undefined)),
      );
    }

    if (isThreadsConfigured()) {
      publishResults.push(
        await safePublish('threads', () => publishToThreads(finalPublishPayload.xText).then(() => undefined)),
      );
    }

    if (resendApiKeyConfigured && !skipEmail) {
      publishResults.push(
        await safePublish('email', async () => {
          const supabase = createSupabaseAdminClient();
          const { freeRecipients, premiumRecipients } = await getTieredQuantBriefingRecipients();

          // On Mondays, fetch last week's data to embed in the daily email
          const isMonday = new Date().getUTCDay() === 1;
          let weeklyDigest = null;
          if (isMonday) {
            try {
              weeklyDigest = await getWeeklyDigestData();
              console.log(
                `[publish-cron] Monday: embedding weekly recap (${weeklyDigest?.sessionCount ?? 0} sessions, avg ${weeklyDigest?.avgScore ?? 'n/a'})`,
              );
            } catch (error) {
              const msg = error instanceof Error ? error.message : 'Unknown';
              console.warn(`[publish-cron] Weekly digest fetch failed (non-fatal): ${msg}`);
            }
          }

          console.log(
            `[publish-cron] Starting dispatchQuantBriefing() with ${premiumRecipients.length} premium recipients and ${freeRecipients.length} free recipients`,
          );

          const { unlockedEmails, regularFreeEmails } = await partitionUnlockedSubscribers(
            supabase,
            freeRecipients,
          );

          const premiumDispatchResult = await dispatchQuantBriefing(
            dailyBriefing.newsletterCopy,
            dailyBriefing.quant.score,
            dailyBriefing.quant.label,
            dailyBriefing.isOverrideActive,
            {
              recipients: premiumRecipients,
              tier: 'premium',
              weeklyDigest,
            },
          );
          const unlockedDispatchResult =
            unlockedEmails.length > 0
              ? await dispatchQuantBriefing(
                  dailyBriefing.newsletterCopy,
                  dailyBriefing.quant.score,
                  dailyBriefing.quant.label,
                  dailyBriefing.isOverrideActive,
                  {
                    recipients: unlockedEmails,
                    tier: 'premium',
                    weeklyDigest,
                  },
                )
              : { batchCount: 0, emailIds: [], recipientCount: 0 };
          const freeDispatchResult =
            regularFreeEmails.length > 0
              ? await dispatchQuantBriefing(
                  dailyBriefing.newsletterCopy,
                  dailyBriefing.quant.score,
                  dailyBriefing.quant.label,
                  dailyBriefing.isOverrideActive,
                  {
                    recipients: regularFreeEmails,
                    tier: 'free',
                    weeklyDigest,
                  },
                )
              : { batchCount: 0, emailIds: [], recipientCount: 0 };

          await verifyPendingReferrals(supabase);

          const totalBatchCount =
            premiumDispatchResult.batchCount +
            unlockedDispatchResult.batchCount +
            freeDispatchResult.batchCount;
          const totalRecipientCount =
            premiumDispatchResult.recipientCount +
            unlockedDispatchResult.recipientCount +
            freeDispatchResult.recipientCount;

          console.log(
            `[publish-cron] Finished dispatchQuantBriefing() with ${totalRecipientCount} recipients across ${totalBatchCount} batches (${premiumDispatchResult.recipientCount} premium, ${unlockedDispatchResult.recipientCount} unlocked, ${freeDispatchResult.recipientCount} free)`,
          );
        }),
      );
    } else {
      if (skipEmail) {
        console.log('[publish-cron] skipEmail=true; skipping email dispatch.');
        failures.push('Email dispatch skipped: skipEmail param set.');
      } else {
        console.warn('[publish-cron] RESEND_API_KEY is not configured; skipping email dispatch.');
        failures.push('Email dispatch skipped: RESEND_API_KEY is not configured.');
      }
    }

    const publishedTo = publishResults.flatMap((result) => (result.ok ? [result.destination] : []));
    failures.push(...publishResults.flatMap((result) => (result.ok || !result.failure ? [] : [result.failure])));

    return NextResponse.json({
      ok: true,
      publishedTo,
      failures,
      analogs: dailyBriefing.quant.analogs,
      briefingGeneratedBy: dailyBriefing.generatedBy,
      newsStatus: dailyBriefing.news.status,
      newsSummary: dailyBriefing.news.summary,
      playbook: dailyBriefing.quant.historicalAnalogs?.clusterAveragePlaybook ?? null,
      preview: finalPublishPayload.xText,
      tradeDate: dailyBriefing.quant.tradeDate,
      overrideTriggered: dailyBriefing.isOverrideActive,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to publish the daily Macro Bias payload.';
    console.error(`[publish-cron] Fatal error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handlePublish(request);
}

export async function POST(request: NextRequest) {
  return handlePublish(request);
}
