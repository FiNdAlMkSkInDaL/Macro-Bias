import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { TwitterApi } from 'twitter-api-v2';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isBlueskyConfigured, publishToBluesky } from './bluesky';
import { sanitizeForSocial } from './sanitize';

const CANONICAL_EMAIL_LINK = 'https://macro-bias.com/emails?utm_source=x&utm_campaign=scheduled';
const EMAIL_LINK_PATTERN = /(?:https?:\/\/)?(?:www\.)?macro-bias\.com\/emails\b/gi;
const MAX_X_POST_LENGTH = 280;

type XEnvName = 'X_API_KEY' | 'X_API_SECRET' | 'X_ACCESS_TOKEN' | 'X_ACCESS_SECRET';

type ScheduledPostRow = {
  created_at?: string | null;
  id: string;
  link: string | null;
  post_body: string | null;
  published_at: string | null;
  scheduled_at: string | null;
  status: string | null;
};

class RouteError extends Error {
  constructor(message: string, readonly status: number = 500) {
    super(message);
    this.name = 'RouteError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getOptionalServerEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getRequiredXEnv(name: XEnvName) {
  const value = getOptionalServerEnv(name);

  if (!value) {
    throw new RouteError(`Missing required X environment variable: ${name}`);
  }

  return value;
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
    throw new RouteError('Missing CRON_SECRET. Configure it before enabling the social dispatch cron route.');
  }

  const providedSecret = getProvidedCronSecret(request);

  return Boolean(providedSecret && safeCompare(providedSecret, expectedSecret));
}

function containsEmailLink(value: string) {
  return /(?:https?:\/\/)?(?:www\.)?macro-bias\.com\/emails\b/i.test(value);
}

function normalizeScheduledPostLink(link: string | null) {
  const trimmedLink = link?.trim();

  if (!trimmedLink) {
    return null;
  }

  if (containsEmailLink(trimmedLink)) {
    return CANONICAL_EMAIL_LINK;
  }

  return trimmedLink;
}

function buildTweetContent(post: ScheduledPostRow) {
  const rawBody = post.post_body?.trim();

  if (!rawBody) {
    throw new RouteError(`Scheduled post ${post.id} is empty and cannot be published.`);
  }

  // Strip any markdown emphasis that leaked into post copy
  const trimmedBody = sanitizeForSocial(rawBody);

  const normalizedLink = normalizeScheduledPostLink(post.link);

  // If no link at all, just post the body as-is (engagement posts)
  if (!normalizedLink) {
    if (Array.from(trimmedBody).length > MAX_X_POST_LENGTH) {
      throw new RouteError(
        `Scheduled post ${post.id} exceeds X's ${MAX_X_POST_LENGTH}-character limit.`,
        400,
      );
    }
    return trimmedBody;
  }

  const content = containsEmailLink(trimmedBody)
    ? trimmedBody.replace(EMAIL_LINK_PATTERN, normalizedLink)
    : `${trimmedBody}\n\n${normalizedLink}`;

  if (Array.from(content).length > MAX_X_POST_LENGTH) {
    throw new RouteError(
      `Scheduled post ${post.id} exceeds X's ${MAX_X_POST_LENGTH}-character limit once the link is applied.`,
      400,
    );
  }

  return content;
}

async function publishToX(content: string) {
  const xClient = new TwitterApi({
    appKey: getRequiredXEnv('X_API_KEY'),
    appSecret: getRequiredXEnv('X_API_SECRET'),
    accessToken: getRequiredXEnv('X_ACCESS_TOKEN'),
    accessSecret: getRequiredXEnv('X_ACCESS_SECRET'),
  });

  try {
    const response = await xClient.v2.tweet(content);
    return response.data?.id ?? null;
  } catch (error) {
    if (isRecord(error) && (isRecord(error.data) || isRecord(error.errors) || Array.isArray(error.errors))) {
      const detailSource = isRecord(error.data) ? error.data : error.errors;
      const detail = JSON.stringify(detailSource).slice(0, 500);
      const status = typeof error.code === 'number' ? error.code : 'unknown';
      throw new RouteError(`Twitter API error (HTTP ${status}): ${detail}`, 502);
    }

    const message = error instanceof Error ? error.message : 'Failed to publish scheduled social post to X.';
    throw new RouteError(message, 502);
  }
}

async function getDueScheduledPosts(nowIsoString: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id, post_body, scheduled_at, status, link, created_at, published_at')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIsoString)
    .order('scheduled_at', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new RouteError(`Failed to load due scheduled posts: ${error.message}`);
  }

  return (data as ScheduledPostRow[] | null) ?? [];
}

async function markScheduledPostPublished(postId: string, publishedAt: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('scheduled_posts')
    .update({
      published_at: publishedAt,
      status: 'published',
    })
    .eq('id', postId)
    .eq('status', 'scheduled')
    .select('id');

  if (error) {
    throw new RouteError(`Tweet posted, but failed to mark scheduled post ${postId} as published: ${error.message}`);
  }

  const updatedRows = (data as Array<{ id: string }> | null) ?? [];

  if (updatedRows.length === 0) {
    throw new RouteError(`Tweet posted, but scheduled post ${postId} was not updated because its status changed concurrently.`);
  }
}

const INTER_TWEET_DELAY_MS = 5_000;

type DispatchedPost = {
  id: string;
  ok: boolean;
  postBody: string | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  tweetId: string | null;
  blueskyUri: string | null;
  failure?: string;
};

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function dispatchAllDueScheduledPosts() {
  const checkedAt = new Date().toISOString();
  const duePosts = await getDueScheduledPosts(checkedAt);
  const blueskyEnabled = isBlueskyConfigured();

  if (blueskyEnabled) {
    console.log('[social-dispatch] Bluesky is configured. Posts will be cross-posted.');
  }

  if (duePosts.length === 0) {
    return {
      checkedAt,
      ok: true,
      published: 0,
      results: [] as DispatchedPost[],
      reason: 'No scheduled social posts are due.',
    };
  }

  const results: DispatchedPost[] = [];

  for (let index = 0; index < duePosts.length; index += 1) {
    const duePost = duePosts[index];

    if (index > 0) {
      await delay(INTER_TWEET_DELAY_MS);
    }

    try {
      const tweetContent = buildTweetContent(duePost);
      const tweetId = await publishToX(tweetContent);

      let blueskyUri: string | null = null;

      if (blueskyEnabled) {
        try {
          blueskyUri = await publishToBluesky(tweetContent);
          console.log(`[social-dispatch] Bluesky post published: ${blueskyUri}`);
        } catch (bskyError) {
          const bskyMessage = bskyError instanceof Error ? bskyError.message : 'Unknown Bluesky error';
          console.warn(`[social-dispatch] Bluesky failed for post ${duePost.id} (X succeeded): ${bskyMessage}`);
        }
      }

      const publishedAt = new Date().toISOString();

      await markScheduledPostPublished(duePost.id, publishedAt);

      results.push({
        id: duePost.id,
        ok: true,
        postBody: duePost.post_body,
        publishedAt,
        scheduledAt: duePost.scheduled_at,
        tweetId,
        blueskyUri,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown dispatch failure.';
      console.warn(`[social-dispatch] Failed to publish post ${duePost.id}: ${message}`);

      results.push({
        id: duePost.id,
        ok: false,
        postBody: duePost.post_body,
        publishedAt: null,
        scheduledAt: duePost.scheduled_at,
        tweetId: null,
        blueskyUri: null,
        failure: message,
      });
    }
  }

  const published = results.filter((r) => r.ok).length;

  return {
    checkedAt,
    ok: true,
    published,
    total: duePosts.length,
    results,
  };
}

export async function handleSocialDispatch(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await dispatchAllDueScheduledPosts();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[social-dispatch] Failed to execute scheduled social dispatch.', error);

    const message = error instanceof Error ? error.message : 'Unable to execute scheduled social dispatch.';
    const status = error instanceof RouteError ? error.status : 500;

    return NextResponse.json({ error: message }, { status });
  }
}