import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { TwitterApi } from 'twitter-api-v2';

import {
  MARKETING_POST_TYPES,
  getAllMarketingPosts,
  isMarketingPostType,
} from '@/lib/marketing/markdown-parser';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DUPLICATE_KEY_ERROR_CODE = '23505';
const MAX_X_POST_LENGTH = 280;

type XEnvName = 'X_API_KEY' | 'X_API_SECRET' | 'X_ACCESS_TOKEN' | 'X_ACCESS_SECRET';

type PublishedMarketingPostRow = {
  published_at: string | null;
  slug: string;
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
    throw new RouteError('Missing CRON_SECRET. Configure it before enabling the marketing cron route.');
  }

  const providedSecret = getProvidedCronSecret(request);

  return Boolean(providedSecret && safeCompare(providedSecret, expectedSecret));
}

function getRequestedPostType(request: NextRequest) {
  const requestedType = request.nextUrl.searchParams.get('type')?.trim() ?? null;

  if (!isMarketingPostType(requestedType)) {
    throw new RouteError(
      `Invalid marketing post type. Expected one of: ${MARKETING_POST_TYPES.join(', ')}.`,
      400,
    );
  }

  return requestedType;
}

function getTweetContent(content: string, slug: string) {
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    throw new RouteError(`Marketing post \"${slug}\" is empty and cannot be published.`);
  }

  if (Array.from(trimmedContent).length > MAX_X_POST_LENGTH) {
    throw new RouteError(
      `Marketing post \"${slug}\" exceeds X's ${MAX_X_POST_LENGTH}-character limit.`,
      400,
    );
  }

  return trimmedContent;
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

    const message = error instanceof Error ? error.message : 'Failed to publish marketing post to X.';
    throw new RouteError(message, 502);
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const type = getRequestedPostType(request);
    const candidatePosts = await getAllMarketingPosts(type);

    if (candidatePosts.length === 0) {
      return NextResponse.json({ ok: true, published: false, reason: `No ${type} posts are available.` });
    }

    const supabase = createSupabaseAdminClient();
    const candidateSlugs = candidatePosts.map((post) => post.slug);

    const { data: publishedPosts, error: publishedPostsError } = await supabase
      .from('published_marketing_posts')
      .select('slug, published_at')
      .in('slug', candidateSlugs);

    if (publishedPostsError) {
      throw new RouteError(`Failed to load previously published marketing posts: ${publishedPostsError.message}`);
    }

    const publishedSlugs = new Set(
      ((publishedPosts as PublishedMarketingPostRow[] | null) ?? []).map((post) => post.slug),
    );
    const nextPost = candidatePosts.find((post) => !publishedSlugs.has(post.slug));

    if (!nextPost) {
      return NextResponse.json({
        ok: true,
        published: false,
        reason: `No unpublished ${type} posts are available.`,
      });
    }

    const tweetContent = getTweetContent(nextPost.content, nextPost.slug);
    const tweetId = await publishToX(tweetContent);
    const publishedAt = new Date().toISOString();
    const { error: insertError } = await supabase.from('published_marketing_posts').insert({
      slug: nextPost.slug,
      published_at: publishedAt,
    });

    if (insertError && insertError.code !== DUPLICATE_KEY_ERROR_CODE) {
      throw new RouteError(
        `Tweet posted, but failed to mark marketing post \"${nextPost.slug}\" as published: ${insertError.message}`,
      );
    }

    if (insertError?.code === DUPLICATE_KEY_ERROR_CODE) {
      console.warn(`[marketing-cron] Marketing post \"${nextPost.slug}\" was already marked as published.`);
    }

    return NextResponse.json({
      ok: true,
      published: true,
      publishedAt,
      slug: nextPost.slug,
      tweetId,
      type,
    });
  } catch (error) {
    console.error('[marketing-cron] Failed to execute marketing cron.', error);

    const message = error instanceof Error ? error.message : 'Unable to execute marketing cron.';
    const status = error instanceof RouteError ? error.status : 500;

    return NextResponse.json({ error: message }, { status });
  }
}