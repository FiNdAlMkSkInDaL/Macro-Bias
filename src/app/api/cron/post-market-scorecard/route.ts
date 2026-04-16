import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { TwitterApi } from 'twitter-api-v2';

import {
  getScorecardData,
  buildScorecardPost,
} from '@/lib/social/post-market-scorecard';
import {
  isBlueskyConfigured,
  publishToBluesky,
} from '@/lib/social/bluesky';
import {
  isThreadsConfigured,
  publishToThreads,
} from '@/lib/social/threads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const revalidate = 0;

/* ------------------------------------------------------------------ */
/*  Auth helpers (same pattern as publish cron)                        */
/* ------------------------------------------------------------------ */

function getOptionalServerEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  const expectedSecret =
    getOptionalServerEnv('CRON_SECRET') ??
    getOptionalServerEnv('PUBLISH_CRON_SECRET');

  if (!expectedSecret) {
    throw new Error(
      'Missing CRON_SECRET. Configure it before enabling the post-market scorecard cron.',
    );
  }

  const providedSecret = getProvidedCronSecret(request);

  return Boolean(providedSecret && safeCompare(providedSecret, expectedSecret));
}

/* ------------------------------------------------------------------ */
/*  X (Twitter) publisher                                              */
/* ------------------------------------------------------------------ */

type XEnvName = 'X_API_KEY' | 'X_API_SECRET' | 'X_ACCESS_TOKEN' | 'X_ACCESS_SECRET';

function getRequiredXEnv(name: XEnvName) {
  const value = getOptionalServerEnv(name);

  if (!value) {
    throw new Error(`Missing required X environment variable: ${name}`);
  }

  return value;
}

function getXCredentials() {
  try {
    return {
      apiKey: getRequiredXEnv('X_API_KEY'),
      apiSecret: getRequiredXEnv('X_API_SECRET'),
      accessToken: getRequiredXEnv('X_ACCESS_TOKEN'),
      accessSecret: getRequiredXEnv('X_ACCESS_SECRET'),
    };
  } catch {
    return null;
  }
}

async function publishScorecardToX(content: string) {
  const credentials = getXCredentials();

  if (!credentials) {
    return { ok: false, failure: 'X credentials not configured.' };
  }

  const xClient = new TwitterApi({
    appKey: credentials.apiKey,
    appSecret: credentials.apiSecret,
    accessToken: credentials.accessToken,
    accessSecret: credentials.accessSecret,
  });

  try {
    const response = await xClient.v2.tweet(content);
    return { ok: true, tweetId: response.data?.id ?? null };
  } catch (err: unknown) {
    if (isRecord(err) && (isRecord(err.data) || isRecord(err.errors))) {
      const detail = JSON.stringify(
        isRecord(err.data) ? err.data : err.errors,
      ).slice(0, 500);
      return { ok: false, failure: `Twitter API error: ${detail}` };
    }

    const message =
      err instanceof Error ? err.message : 'Unknown X publish failure.';
    return { ok: false, failure: message };
  }
}

/* ------------------------------------------------------------------ */
/*  Route handler                                                      */
/* ------------------------------------------------------------------ */

async function handlePostMarketScorecard(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const scorecardData = await getScorecardData();

    if (!scorecardData) {
      return NextResponse.json(
        {
          ok: false,
          reason:
            'No scorecard data available. Either no bias score exists for today or SPY data is missing.',
        },
        { status: 404 },
      );
    }

    const postContent = buildScorecardPost(scorecardData);

    console.log(
      `[post-market-scorecard] Built scorecard for ${scorecardData.tradeDate}: ` +
        `score=${scorecardData.score}, SPY=${scorecardData.spyChangePercent.toFixed(2)}%, ` +
        `correct=${scorecardData.callCorrect}`,
    );

    const results: { destination: string; ok: boolean; failure?: string }[] =
      [];

    // Publish to X
    const xResult = await publishScorecardToX(postContent);
    results.push({ destination: 'x', ...xResult });

    if (xResult.ok) {
      console.log('[post-market-scorecard] Published to X.');
    } else {
      console.warn(
        `[post-market-scorecard] X publish failed: ${xResult.failure}`,
      );
    }

    // Publish to Bluesky
    if (isBlueskyConfigured()) {
      try {
        const bskyUri = await publishToBluesky(postContent);
        results.push({ destination: 'bluesky', ok: true });
        console.log(
          `[post-market-scorecard] Published to Bluesky: ${bskyUri}`,
        );
      } catch (bskyErr) {
        const msg =
          bskyErr instanceof Error
            ? bskyErr.message
            : 'Unknown Bluesky error.';
        results.push({ destination: 'bluesky', ok: false, failure: msg });
        console.warn(
          `[post-market-scorecard] Bluesky publish failed: ${msg}`,
        );
      }
    }

    // Publish to Threads
    if (isThreadsConfigured()) {
      try {
        const threadsId = await publishToThreads(postContent);
        results.push({ destination: 'threads', ok: true });
        console.log(
          `[post-market-scorecard] Published to Threads: ${threadsId}`,
        );
      } catch (threadsErr) {
        const msg =
          threadsErr instanceof Error
            ? threadsErr.message
            : 'Unknown Threads error.';
        results.push({ destination: 'threads', ok: false, failure: msg });
        console.warn(
          `[post-market-scorecard] Threads publish failed: ${msg}`,
        );
      }
    }

    const publishedTo = results
      .filter((r) => r.ok)
      .map((r) => r.destination);
    const failures = results
      .filter((r) => !r.ok && r.failure)
      .map((r) => r.failure);

    return NextResponse.json({
      ok: true,
      tradeDate: scorecardData.tradeDate,
      score: scorecardData.score,
      spyChange: scorecardData.spyChangePercent,
      callCorrect: scorecardData.callCorrect,
      rollingHitRate: scorecardData.rollingHitRate,
      publishedTo,
      failures,
      preview: postContent,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to run post-market scorecard.';
    console.error(`[post-market-scorecard] Fatal error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handlePostMarketScorecard(request);
}
