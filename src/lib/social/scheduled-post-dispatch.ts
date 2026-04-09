import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { TwitterApi } from 'twitter-api-v2';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const CANONICAL_EMAIL_LINK = 'https://www.macro-bias.com/emails';
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
    return CANONICAL_EMAIL_LINK;
  }

  if (containsEmailLink(trimmedLink)) {
    return CANONICAL_EMAIL_LINK;
  }

  return trimmedLink;
}

function buildTweetContent(post: ScheduledPostRow) {
  const trimmedBody = post.post_body?.trim();

  if (!trimmedBody) {
    throw new RouteError(`Scheduled post ${post.id} is empty and cannot be published.`);
  }

  const normalizedLink = normalizeScheduledPostLink(post.link);
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

async function getDueScheduledPost(nowIsoString: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id, post_body, scheduled_at, status, link, created_at, published_at')
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIsoString)
    .order('scheduled_at', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    throw new RouteError(`Failed to load due scheduled posts: ${error.message}`);
  }

  const rows = (data as ScheduledPostRow[] | null) ?? [];

  return rows[0] ?? null;
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

async function dispatchDueScheduledPost() {
  const checkedAt = new Date().toISOString();
  const duePost = await getDueScheduledPost(checkedAt);

  if (!duePost) {
    return {
      checkedAt,
      ok: true,
      published: false,
      reason: 'No scheduled social post is due.',
    };
  }

  const tweetContent = buildTweetContent(duePost);
  const tweetId = await publishToX(tweetContent);
  const publishedAt = new Date().toISOString();

  await markScheduledPostPublished(duePost.id, publishedAt);

  return {
    checkedAt,
    id: duePost.id,
    ok: true,
    postBody: duePost.post_body,
    published: true,
    publishedAt,
    scheduledAt: duePost.scheduled_at,
    tweetId,
  };
}

export async function handleSocialDispatch(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await dispatchDueScheduledPost();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[social-dispatch] Failed to execute scheduled social dispatch.', error);

    const message = error instanceof Error ? error.message : 'Unable to execute scheduled social dispatch.';
    const status = error instanceof RouteError ? error.status : 500;

    return NextResponse.json({ error: message }, { status });
  }
}