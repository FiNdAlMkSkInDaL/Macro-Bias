import { NextResponse, type NextRequest } from 'next/server';

import { logMarketingEvent } from '@/lib/analytics/server';
import {
  isValidEmailAddress,
  normalizeEmailAddress,
  unsubscribeEmailAddress,
} from '@/lib/marketing/email-preferences';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function extractEmailFromRequest(request: NextRequest) {
  const emailFromQuery = normalizeEmailAddress(request.nextUrl.searchParams.get('email'));

  if (emailFromQuery) {
    return emailFromQuery;
  }

  if (request.method === 'GET') {
    return '';
  }

  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const payload = await request.clone().json().catch(() => null) as { email?: unknown } | null;
    return normalizeEmailAddress(payload?.email);
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const formData = await request.clone().formData().catch(() => null);
    return normalizeEmailAddress(formData?.get('email'));
  }

  const rawBody = await request.clone().text().catch(() => '');

  if (!rawBody) {
    return '';
  }

  return normalizeEmailAddress(new URLSearchParams(rawBody).get('email'));
}

async function handleUnsubscribe(request: NextRequest) {
  const email = await extractEmailFromRequest(request);

  if (!isValidEmailAddress(email)) {
    return new NextResponse(buildResultHtml('Invalid unsubscribe link.', false), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const supabase = createSupabaseAdminClient();

  let alreadyUnsubscribed = false;

  try {
    const result = await unsubscribeEmailAddress(supabase, email);
    alreadyUnsubscribed = result.alreadyUnsubscribed;
  } catch (unsubscribeError) {
    console.error('[unsubscribe] failed', unsubscribeError);
    return new NextResponse(buildResultHtml('Something went wrong. Try again later.', false), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!alreadyUnsubscribed) {
    try {
      await logMarketingEvent({
        eventName: 'email_unsubscribed',
        metadata: {
          request_method: request.method,
          source: 'unsubscribe_route',
        },
        pagePath: request.nextUrl.pathname,
        referrer: request.headers.get('referer'),
        subscriberEmail: email,
      });
    } catch (analyticsError) {
      console.error('[unsubscribe] analytics logging failed', analyticsError);
    }
  }

  return new NextResponse(buildResultHtml('You have been unsubscribed.', true), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(request: NextRequest) {
  return handleUnsubscribe(request);
}

export async function POST(request: NextRequest) {
  return handleUnsubscribe(request);
}

function buildResultHtml(message: string, success: boolean) {
  const color = success ? '#22c55e' : '#ef4444';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Unsubscribe — Macro Bias</title>
  <style>
    body { margin: 0; padding: 0; background: #020617; color: #e2e8f0; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { text-align: center; max-width: 420px; padding: 40px 24px; }
    h1 { font-size: 20px; font-weight: 700; color: ${color}; margin: 0 0 12px; }
    p { font-size: 14px; color: #94a3b8; margin: 0; }
    a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${message}</h1>
    <p>${success ? 'You will no longer receive daily briefing emails from Macro Bias.' : 'Please check the link and try again.'}</p>
    <p style="margin-top: 24px;"><a href="/">Back to Macro Bias</a></p>
  </div>
</body>
</html>`;
}
