import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { TwitterApi } from 'twitter-api-v2';

import {
  deriveHistoricalAnalogs,
  type HistoricalAnalogsPayload,
} from '../../../../lib/market-data/derive-historical-analogs';
import type { BiasLabel } from '../../../../lib/macro-bias/types';
import { upsertDailyMarketData } from '../../../../lib/market-data/upsert-daily-market-data';
import { getAppUrl } from '../../../../lib/server-env';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_HISTORY_ROWS = 180;
const DISCORD_PUBLISHING_ENABLED = false;

type StoredBiasSnapshot = {
  trade_date: string;
  score: number;
  bias_label: BiasLabel;
  component_scores: unknown;
  model_version: string | null;
  engine_inputs: unknown;
  technical_indicators: unknown;
};

type AnalogMatch = {
  tradeDate: string;
  nextSessionDate: string;
  score: number | null;
  biasLabel: string | null;
  matchConfidence: number;
  intradayNet: number | null;
  overnightGap: number | null;
  sessionRange: number | null;
};

type PublishPayload = {
  analogs: AnalogMatch[];
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

function getRegimeTone(label: BiasLabel) {
  switch (label) {
    case 'EXTREME_RISK_ON':
    case 'RISK_ON':
      return 'Risk appetite is broadening and continuation setups have room to breathe.';
    case 'EXTREME_RISK_OFF':
    case 'RISK_OFF':
      return 'Defensive flows are taking control and loose risk is getting punished quickly.';
    default:
      return 'Cross-asset signals are mixed, so the tape still demands selectivity and discipline.';
  }
}

function getRegimeSentence(label: BiasLabel) {
  switch (label) {
    case 'EXTREME_RISK_ON':
      return 'The tape is explosive. Risk-on leadership is widening fast.';
    case 'RISK_ON':
      return 'Risk appetite is widening. Buyers still have control.';
    case 'EXTREME_RISK_OFF':
      return 'The tape is breaking down. Defensive leadership is taking over.';
    case 'RISK_OFF':
      return 'The tape is heavy. Risk-off leadership is taking over.';
    default:
      return 'The tape is split. Selectivity matters more than conviction.';
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

function buildPublishedAnalogs(
  historicalAnalogs: HistoricalAnalogsPayload | null,
  snapshotsByDate: Map<string, StoredBiasSnapshot>,
) {
  if (!historicalAnalogs) {
    return [] as AnalogMatch[];
  }

  return historicalAnalogs.topMatches.map((analog) => {
    const snapshot = snapshotsByDate.get(analog.tradeDate);

    return {
      tradeDate: analog.tradeDate,
      nextSessionDate: analog.nextSessionDate,
      score: snapshot?.score ?? null,
      biasLabel: snapshot?.bias_label ?? null,
      matchConfidence: analog.matchConfidence,
      intradayNet: analog.intradayNet,
      overnightGap: analog.overnightGap,
      sessionRange: analog.sessionRange,
    } satisfies AnalogMatch;
  });
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
      ? `Decayed KNN playbook avg (${analogCount})`
      : `Decayed KNN playbook avg across ${analogCount} exact analogs`;

  return `${prefix}: Gap ${formatOptionalSignedPercent(historicalAnalogs.clusterAveragePlaybook.overnightGap)} | Intraday Drift ${formatOptionalSignedPercent(historicalAnalogs.clusterAveragePlaybook.intradayNet)} | Session Range ${formatOptionalUnsignedPercent(historicalAnalogs.clusterAveragePlaybook.sessionRange)}`;
}

function buildAnalogSection(analogs: AnalogMatch[]) {
  if (analogs.length === 0) {
    return 'Closest historical analogs are still warming up as more model history accumulates.';
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

function buildPublishPayload(
  snapshot: StoredBiasSnapshot,
  historicalAnalogs: HistoricalAnalogsPayload | null,
  analogs: AnalogMatch[],
) {
  const appUrl = getAppUrl();
  const dashboardUrl = new URL('/dashboard', appUrl).toString();
  const ogImageUrl = new URL('/api/og', appUrl).toString();
  const shareUrl = 'https://macro-bias.com';
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
  const xText = [
    `Today's Macro Bias Score: ${formatSignedNumber(snapshot.score)}`,
    `Regime: ${regimeSentence}`,
    xPlaybookSummary,
    shareUrl,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n');

  return {
    analogs,
    dashboardUrl,
    discordText,
    headline,
    ogImageUrl,
    playbookSummary: discordPlaybookSummary,
    regimeSentence,
    shareUrl,
    xText,
  } satisfies PublishPayload;
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

    await upsertDailyMarketData();

    const discordWebhookUrl = DISCORD_PUBLISHING_ENABLED
      ? getOptionalServerEnv('DISCORD_PUBLISH_WEBHOOK_URL')
      : null;
    const xCredentials = getXCredentials();

    if (!discordWebhookUrl && !xCredentials) {
      return NextResponse.json(
        {
          error:
            'No active publish destinations are configured. Discord publishing is temporarily disabled, so configure the X API credentials to enable cron publishing.',
        },
        { status: 500 },
      );
    }

    const snapshots = await getRecentSnapshots();

    if (snapshots.length === 0) {
      return NextResponse.json({ error: 'No macro bias snapshots are available to publish.' }, { status: 404 });
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

    const latestSnapshot = snapshots[latestSnapshotIndex];
    const snapshotsByDate = new Map(snapshots.map((snapshot) => [snapshot.trade_date, snapshot]));
    const historicalAnalogs = deriveHistoricalAnalogs(
      latestSnapshot.engine_inputs,
      latestSnapshot.component_scores,
      latestSnapshot.technical_indicators,
    );
    const analogs = buildPublishedAnalogs(historicalAnalogs, snapshotsByDate);
    const publishPayload = buildPublishPayload(latestSnapshot, historicalAnalogs, analogs);
    const publishJobs = [
      DISCORD_PUBLISHING_ENABLED && discordWebhookUrl
        ? publishToDiscord(discordWebhookUrl, latestSnapshot, publishPayload).then(() => 'discord')
        : null,
      xCredentials
        ? publishToX(xCredentials, publishPayload).then(() => 'x')
        : null,
    ].filter((job): job is Promise<'discord' | 'x'> => Boolean(job));

    const publishResults = await Promise.allSettled(publishJobs);
    const publishedTo = publishResults
      .filter((result): result is PromiseFulfilledResult<'discord' | 'x'> => result.status === 'fulfilled')
      .map((result) => result.value);
    const failures = publishResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : 'Unknown publish failure.');

    if (failures.length > 0) {
      return NextResponse.json(
        {
          error: 'One or more publish destinations failed.',
          publishedTo,
          failures,
          preview: publishPayload.xText,
          analogs,
          playbook: historicalAnalogs?.clusterAveragePlaybook ?? null,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      publishedTo,
      analogs,
      playbook: historicalAnalogs?.clusterAveragePlaybook ?? null,
      preview: publishPayload.xText,
      tradeDate: latestSnapshot.trade_date,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to publish the daily Macro Bias payload.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handlePublish(request);
}

export async function POST(request: NextRequest) {
  return handlePublish(request);
}
