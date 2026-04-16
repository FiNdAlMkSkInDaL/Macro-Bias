import { NextResponse, type NextRequest } from 'next/server';

import { logMarketingEvent } from '@/lib/analytics/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(email: string) {
  return email.length > 3 && email.length <= 320 && EMAIL_PATTERN.test(email);
}

export async function GET(request: NextRequest) {
  const email = normalizeEmail(request.nextUrl.searchParams.get('email'));

  if (!isValidEmail(email)) {
    return new NextResponse(buildResultHtml('Invalid unsubscribe link.', false), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const supabase = createSupabaseAdminClient();

  // Check if already unsubscribed to prevent duplicate analytics events
  // (email clients pre-fetch links, users double-click, etc.)
  const { data: existing } = await supabase
    .from('free_subscribers')
    .select('status')
    .eq('email', email)
    .single();

  if (existing?.status === 'inactive') {
    return new NextResponse(buildResultHtml('You have been unsubscribed.', true), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const [{ error: subscriberError }, { error: enrollmentError }, { error: deliveryError }] = await Promise.all([
    supabase
      .from('free_subscribers')
      .update({ status: 'inactive' })
      .eq('email', email),
    supabase
      .from('welcome_email_drip_enrollments')
      .update({ status: 'unsubscribed' })
      .eq('email', email),
    supabase
      .from('welcome_email_drip_deliveries')
      .update({
        error_message: 'Subscriber unsubscribed.',
        status: 'cancelled',
      })
      .eq('email', email)
      .eq('status', 'scheduled'),
  ]);

  if (subscriberError || enrollmentError || deliveryError) {
    return new NextResponse(buildResultHtml('Something went wrong. Try again later.', false), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    await logMarketingEvent({
      eventName: 'email_unsubscribed',
      metadata: {
        source: 'unsubscribe_route',
      },
      pagePath: request.nextUrl.pathname,
      referrer: request.headers.get('referer'),
      subscriberEmail: email,
    });
  } catch (analyticsError) {
    console.error('[unsubscribe] analytics logging failed', analyticsError);
  }

  return new NextResponse(buildResultHtml('You have been unsubscribed.', true), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
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
