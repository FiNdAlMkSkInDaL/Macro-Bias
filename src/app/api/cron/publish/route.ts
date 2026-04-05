import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import type { BiasLabel } from '../../../../lib/macro-bias/types';
import { getAppUrl } from '../../../../lib/server-env';
import { createSupabaseAdminClient } from '../../../../lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_HISTORY_ROWS = 180;
const MIN_ANALOG_FEATURE_OVERLAP = 4;

type StoredBiasSnapshot = {
  trade_date: string;
  score: number;
  bias_label: BiasLabel;
  model_version: string | null;
  engine_inputs: unknown;
  technical_indicators: unknown;
};

type AnalogMatch = {
  tradeDate: string;
  score: number | null;
  biasLabel: string | null;
  similarity: number | null;
  source: 'persisted' | 'derived';
};

type DerivedAnalogMatch = {
  tradeDate: string;
  score: number;
  biasLabel: BiasLabel;
  similarity: number;
  source: 'derived';
};

type PublishPayload = {
  analogs: AnalogMatch[];
  dashboardUrl: string;
  discordText: string;
  headline: string;
  ogImageUrl: string;
  xText: string;
};

type ComparableFeature =
  | 'score'
  | 'SPY'
  | 'QQQ'
  | 'XLP'
  | 'TLT'
  | 'GLD'
  | 'VIX'
  | 'HYG'
  | 'CPER'
  | 'spyRsi14'
  | 'spyDistanceFromSma';

const FEATURE_CONFIG: Record<ComparableFeature, { scale: number; weight: number }> = {
  score: { scale: 25, weight: 2.4 },
  SPY: { scale: 2.5, weight: 1.2 },
  QQQ: { scale: 2.75, weight: 1.1 },
  XLP: { scale: 1.75, weight: 0.9 },
  TLT: { scale: 1.75, weight: 1 },
  GLD: { scale: 2, weight: 0.9 },
  VIX: { scale: 10, weight: 1.8 },
  HYG: { scale: 1.5, weight: 1.3 },
  CPER: { scale: 2, weight: 1 },
  spyRsi14: { scale: 18, weight: 1.1 },
  spyDistanceFromSma: { scale: 2.5, weight: 1.4 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoTradeDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : null;
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

function getSpyTechnicalIndicator(technicalIndicators: unknown, key: 'rsi14' | 'distanceFromSmaPercent') {
  if (!isRecord(technicalIndicators)) {
    return null;
  }

  const spyIndicators = technicalIndicators.SPY;

  if (!isRecord(spyIndicators)) {
    return null;
  }

  return getNumber(spyIndicators[key]);
}

function buildFeatureVector(snapshot: StoredBiasSnapshot): Partial<Record<ComparableFeature, number>> {
  return {
    score: snapshot.score,
    SPY: getTickerPercentChange(snapshot.engine_inputs, 'coreTickerChanges', 'SPY') ?? undefined,
    QQQ: getTickerPercentChange(snapshot.engine_inputs, 'coreTickerChanges', 'QQQ') ?? undefined,
    XLP: getTickerPercentChange(snapshot.engine_inputs, 'coreTickerChanges', 'XLP') ?? undefined,
    TLT: getTickerPercentChange(snapshot.engine_inputs, 'coreTickerChanges', 'TLT') ?? undefined,
    GLD: getTickerPercentChange(snapshot.engine_inputs, 'coreTickerChanges', 'GLD') ?? undefined,
    VIX: getTickerPercentChange(snapshot.engine_inputs, 'supplementalTickerChanges', 'VIX') ?? undefined,
    HYG: getTickerPercentChange(snapshot.engine_inputs, 'supplementalTickerChanges', 'HYG') ?? undefined,
    CPER: getTickerPercentChange(snapshot.engine_inputs, 'supplementalTickerChanges', 'CPER') ?? undefined,
    spyRsi14: getSpyTechnicalIndicator(snapshot.technical_indicators, 'rsi14') ?? undefined,
    spyDistanceFromSma:
      getSpyTechnicalIndicator(snapshot.technical_indicators, 'distanceFromSmaPercent') ?? undefined,
  };
}

function computeAnalogDistance(
  latestVector: Partial<Record<ComparableFeature, number>>,
  candidateVector: Partial<Record<ComparableFeature, number>>,
) {
  let weightedDistance = 0;
  let totalWeight = 0;
  let sharedFeatureCount = 0;

  (Object.keys(FEATURE_CONFIG) as ComparableFeature[]).forEach((feature) => {
    const latestValue = latestVector[feature];
    const candidateValue = candidateVector[feature];

    if (latestValue == null || candidateValue == null) {
      return;
    }

    const { scale, weight } = FEATURE_CONFIG[feature];
    const normalizedDifference = Math.min(Math.abs(latestValue - candidateValue) / scale, 3);

    weightedDistance += normalizedDifference * weight;
    totalWeight += weight;
    sharedFeatureCount += 1;
  });

  if (sharedFeatureCount < MIN_ANALOG_FEATURE_OVERLAP || totalWeight === 0) {
    return null;
  }

  return weightedDistance / totalWeight;
}

function parseAnalogMatch(value: unknown): AnalogMatch | null {
  if (isIsoTradeDate(value)) {
    return {
      tradeDate: value,
      score: null,
      biasLabel: null,
      similarity: null,
      source: 'persisted',
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const tradeDate =
    getString(value.tradeDate) ??
    getString(value.trade_date) ??
    getString(value.date) ??
    getString(value.analogDate) ??
    getString(value.analog_trade_date);

  if (!isIsoTradeDate(tradeDate)) {
    return null;
  }

  return {
    tradeDate,
    score:
      getNumber(value.score) ??
      getNumber(value.analogScore) ??
      getNumber(value.biasScore) ??
      null,
    biasLabel:
      getString(value.biasLabel) ??
      getString(value.bias_label) ??
      getString(value.label) ??
      getString(value.regime) ??
      null,
    similarity:
      getNumber(value.similarity) ??
      getNumber(value.confidence) ??
      getNumber(value.matchScore) ??
      null,
    source: 'persisted',
  };
}

function collectPersistedAnalogs(value: unknown, path: string[] = []): AnalogMatch[] {
  if (Array.isArray(value)) {
    const isAnalogPath = path.some((segment) => segment.toLowerCase().includes('analog'));

    if (!isAnalogPath) {
      return [];
    }

    return value.map(parseAnalogMatch).filter((match): match is AnalogMatch => Boolean(match));
  }

  if (!isRecord(value) || path.length > 8) {
    return [];
  }

  return Object.entries(value).flatMap(([key, childValue]) =>
    collectPersistedAnalogs(childValue, [...path, key]),
  );
}

function enrichAnalogMatches(analogs: AnalogMatch[], snapshotsByDate: Map<string, StoredBiasSnapshot>) {
  const seenTradeDates = new Set<string>();

  return analogs
    .map((analog) => {
      if (seenTradeDates.has(analog.tradeDate)) {
        return null;
      }

      seenTradeDates.add(analog.tradeDate);

      const snapshot = snapshotsByDate.get(analog.tradeDate);

      return {
        ...analog,
        score: analog.score ?? snapshot?.score ?? null,
        biasLabel: analog.biasLabel ?? snapshot?.bias_label ?? null,
      };
    })
    .filter((analog): analog is AnalogMatch => Boolean(analog));
}

function deriveAnalogMatches(
  latestSnapshot: StoredBiasSnapshot,
  historicalSnapshots: StoredBiasSnapshot[],
) {
  const latestVector = buildFeatureVector(latestSnapshot);

  return historicalSnapshots
    .map((snapshot) => {
      const distance = computeAnalogDistance(latestVector, buildFeatureVector(snapshot));

      if (distance == null) {
        return null;
      }

      return {
        tradeDate: snapshot.trade_date,
        score: snapshot.score,
        biasLabel: snapshot.bias_label,
        similarity: Number((1 / (1 + distance)).toFixed(3)),
        source: 'derived' as const,
      };
    })
    .filter((analog): analog is DerivedAnalogMatch => Boolean(analog))
    .sort((left, right) => {
      const leftSimilarity = left.similarity ?? 0;
      const rightSimilarity = right.similarity ?? 0;
      return rightSimilarity - leftSimilarity;
    })
    .slice(0, 2);
}

function buildAnalogSection(analogs: AnalogMatch[]) {
  if (analogs.length === 0) {
    return 'Closest historical analogs are still warming up as more model history accumulates.';
  }

  return analogs
    .map((analog, index) => {
      const scoreText = analog.score == null ? '' : ` ${formatSignedNumber(analog.score)}`;
      const labelText = analog.biasLabel ? ` ${analog.biasLabel.replace(/_/g, ' ')}` : '';
      return `${index + 1}. ${formatDisplayDate(analog.tradeDate)}${labelText}${scoreText}`;
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

function buildPublishPayload(snapshot: StoredBiasSnapshot, analogs: AnalogMatch[]) {
  const appUrl = getAppUrl();
  const dashboardUrl = new URL('/dashboard', appUrl).toString();
  const ogImageUrl = new URL('/api/og', appUrl).toString();
  const formattedDate = formatDisplayDate(snapshot.trade_date);
  const label = snapshot.bias_label.replace(/_/g, ' ');
  const headline = `Today's Macro Weather Report: ${label} (${formatSignedNumber(snapshot.score)})`;
  const regimeTone = getRegimeTone(snapshot.bias_label);
  const signalContext = buildSignalContext(snapshot);
  const analogSection = buildAnalogSection(analogs);
  const discordText = [
    `**${headline}**`,
    `${formattedDate}`,
    regimeTone,
    signalContext ? `Signal tape: ${signalContext}` : null,
    `Closest historical analogs: ${analogSection}`,
    `Open the live dashboard: ${dashboardUrl}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
  const xText = [
    `${headline}`,
    regimeTone,
    signalContext ? `${signalContext}.` : null,
    analogs.length > 0
      ? `Closest analogs: ${analogs
          .map((analog) => `${formatDisplayDate(analog.tradeDate)}${analog.biasLabel ? ` ${analog.biasLabel.replace(/_/g, ' ')}` : ''}`)
          .join(' • ')}.`
      : 'Closest historical analogs are still warming up.',
    dashboardUrl,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n');

  return {
    analogs,
    dashboardUrl,
    discordText,
    headline,
    ogImageUrl,
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

async function publishToX(webhookUrl: string, payload: PublishPayload) {
  await postJson(
    webhookUrl,
    {
      text: payload.xText,
      url: payload.dashboardUrl,
      ogImageUrl: payload.ogImageUrl,
      analogs: payload.analogs,
      source: 'macro-bias',
    },
    'X publish endpoint',
  );
}

async function getRecentSnapshots() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('macro_bias_scores')
    .select('trade_date, score, bias_label, model_version, engine_inputs, technical_indicators')
    .order('trade_date', { ascending: false })
    .limit(MAX_HISTORY_ROWS);

  if (error) {
    throw error;
  }

  return (data as StoredBiasSnapshot[] | null) ?? [];
}

async function handlePublish(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const discordWebhookUrl = getOptionalServerEnv('DISCORD_PUBLISH_WEBHOOK_URL');
    const xPublishWebhookUrl = getOptionalServerEnv('X_PUBLISH_WEBHOOK_URL');

    if (!discordWebhookUrl && !xPublishWebhookUrl) {
      return NextResponse.json(
        {
          error:
            'No publish destinations are configured. Set DISCORD_PUBLISH_WEBHOOK_URL and/or X_PUBLISH_WEBHOOK_URL.',
        },
        { status: 500 },
      );
    }

    const snapshots = await getRecentSnapshots();

    if (snapshots.length === 0) {
      return NextResponse.json({ error: 'No macro bias snapshots are available to publish.' }, { status: 404 });
    }

    const [latestSnapshot, ...historicalSnapshots] = snapshots;
    const snapshotsByDate = new Map(snapshots.map((snapshot) => [snapshot.trade_date, snapshot]));
    const persistedAnalogs = enrichAnalogMatches(
      [
        ...collectPersistedAnalogs(latestSnapshot.engine_inputs),
        ...collectPersistedAnalogs(latestSnapshot.technical_indicators),
      ],
      snapshotsByDate,
    ).slice(0, 2);
    const derivedAnalogs = deriveAnalogMatches(latestSnapshot, historicalSnapshots);
    const analogs = [...persistedAnalogs, ...derivedAnalogs]
      .filter(
        (analog, index, allAnalogs) =>
          allAnalogs.findIndex(
            (candidateAnalog) => candidateAnalog.tradeDate === analog.tradeDate,
          ) === index,
      )
      .slice(0, 2);
    const publishPayload = buildPublishPayload(latestSnapshot, analogs);
    const publishJobs = [
      discordWebhookUrl
        ? publishToDiscord(discordWebhookUrl, latestSnapshot, publishPayload).then(() => 'discord')
        : null,
      xPublishWebhookUrl
        ? publishToX(xPublishWebhookUrl, publishPayload).then(() => 'x')
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
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      publishedTo,
      analogs,
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