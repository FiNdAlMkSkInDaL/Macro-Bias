import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';
const ADMIN_EMAIL = 'finphillips21@gmail.com';

function getOptionalServerEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorizedCronRequest(request: NextRequest) {
  const expectedSecret = getOptionalServerEnv('CRON_SECRET');
  if (!expectedSecret) return false;

  const authHeader = request.headers.get('authorization');
  const provided = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : request.headers.get('x-cron-secret')?.trim() ?? null;

  return Boolean(provided && safeCompare(provided, expectedSecret));
}

/**
 * Refreshes the Threads long-lived access token.
 * Tokens last 60 days; this cron runs weekly to keep the token fresh.
 * The refreshed token is logged — update THREADS_ACCESS_TOKEN in Vercel env after each refresh.
 *
 * Meta docs: https://developers.facebook.com/docs/threads/get-started/long-lived-tokens
 */
async function refreshThreadsToken(): Promise<{
  refreshed: boolean;
  newToken?: string;
  expiresInDays?: number;
  error?: string;
}> {
  const currentToken = getOptionalServerEnv('THREADS_ACCESS_TOKEN');
  const appSecret = getOptionalServerEnv('THREADS_APP_SECRET');

  if (!currentToken) {
    return { refreshed: false, error: 'THREADS_ACCESS_TOKEN is not set.' };
  }

  if (!appSecret) {
    return { refreshed: false, error: 'THREADS_APP_SECRET is not set.' };
  }

  // Check current token expiry first
  const debugUrl =
    `${THREADS_API_BASE}/debug_token` +
    `?input_token=${currentToken}` +
    `&access_token=${currentToken}`;

  let daysRemaining: number | null = null;

  try {
    const debugRes = await fetch(debugUrl);
    if (debugRes.ok) {
      const debugData = (await debugRes.json()) as {
        data?: { expires_at?: number; is_valid?: boolean };
      };
      const expiresAt = debugData.data?.expires_at;
      if (expiresAt) {
        daysRemaining = Math.round((expiresAt * 1000 - Date.now()) / 86_400_000);
        console.log(`[threads-token-refresh] Token expires in ~${daysRemaining} days.`);
      }
    }
  } catch {
    console.warn('[threads-token-refresh] Could not inspect token expiry, proceeding with refresh anyway.');
  }

  // Only refresh if under 30 days remaining (or if we couldn't check)
  if (daysRemaining !== null && daysRemaining > 30) {
    console.log(`[threads-token-refresh] Token still healthy (${daysRemaining} days). Skipping refresh.`);
    return { refreshed: false, expiresInDays: daysRemaining };
  }

  const refreshUrl =
    `${THREADS_API_BASE}/refresh_access_token` +
    `?grant_type=th_refresh_token` +
    `&access_token=${currentToken}`;

  const refreshRes = await fetch(refreshUrl);

  if (!refreshRes.ok) {
    const body = (await refreshRes.text()).slice(0, 400);
    const error = `Threads token refresh failed (${refreshRes.status}): ${body}`;
    console.error(`[threads-token-refresh] ${error}`);
    return { refreshed: false, error };
  }

  const refreshData = (await refreshRes.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
  };

  const newToken = refreshData.access_token;
  if (!newToken) {
    return { refreshed: false, error: 'Threads API did not return a new token.' };
  }

  const expiresInDays = refreshData.expires_in
    ? Math.round(refreshData.expires_in / 86400)
    : 60;

  console.log(`[threads-token-refresh] Token refreshed successfully. New token expires in ~${expiresInDays} days.`);
  console.log(`[threads-token-refresh] ACTION REQUIRED: Update THREADS_ACCESS_TOKEN in Vercel env to: ${newToken}`);

  // Send email notification
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (resendApiKey) {
    try {
      const resend = new Resend(resendApiKey);
      await resend.emails.send({
        from: 'Macro Bias <briefing@macro-bias.com>',
        to: ADMIN_EMAIL,
        subject: 'Action required: Update Threads access token in Vercel',
        html: `
          <p>Your Threads access token was automatically refreshed and is now valid for ~${expiresInDays} days.</p>
          <p><strong>You need to update the <code>THREADS_ACCESS_TOKEN</code> environment variable in your Vercel dashboard.</strong></p>
          <h3>New token:</h3>
          <pre style="background:#f4f4f4;padding:12px;border-radius:4px;word-break:break-all;">${newToken}</pre>
          <p>Steps:</p>
          <ol>
            <li>Go to <a href="https://vercel.com/findalmkskindals-projects/macro-bias/settings/environment-variables">Vercel Environment Variables</a></li>
            <li>Find <code>THREADS_ACCESS_TOKEN</code> and update its value to the token above</li>
            <li>Redeploy (or the new token will take effect on the next deployment)</li>
          </ol>
          <p style="color:#666;font-size:12px;">This email was sent automatically by the Macro Bias Threads token refresh cron.</p>
        `,
      });
      console.log(`[threads-token-refresh] Notification email sent to ${ADMIN_EMAIL}.`);
    } catch (emailErr) {
      const msg = emailErr instanceof Error ? emailErr.message : 'Unknown';
      console.warn(`[threads-token-refresh] Email notification failed: ${msg}`);
    }
  }

  return { refreshed: true, newToken, expiresInDays };
}

async function handleThreadsTokenRefresh(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await refreshThreadsToken();

    if (result.error) {
      return NextResponse.json({ ok: false, ...result }, { status: 500 });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    console.error('[threads-token-refresh] Fatal error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleThreadsTokenRefresh(request);
}
