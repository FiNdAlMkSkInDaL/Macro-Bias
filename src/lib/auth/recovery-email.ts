import 'server-only';

import { createHmac } from 'node:crypto';
import { Resend } from 'resend';
import type { NextRequest } from 'next/server';

import { createSupabaseAdminClient } from '../supabase/admin';
import { getRequiredServerEnv } from '../server-env';

export const RECOVERY_LIMIT_EVENT = 'auth_password_reset_limit';

export function recoveryRateLimitIdentity(value: string) {
  return createHmac('sha256', getRequiredServerEnv('SUPABASE_SERVICE_ROLE_KEY'))
    .update(`password-recovery-limit:v1:${value.trim().toLowerCase()}`).digest('hex');
}

function claimId(value: string) {
  const hash = recoveryRateLimitIdentity(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function trustedRecoveryOrigin(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const trusted = new Set(['https://macro-bias.com', 'https://www.macro-bias.com']);
  for (const name of ['VERCEL_URL', 'VERCEL_BRANCH_URL']) {
    const host = process.env[name]?.trim();
    if (host && /^[A-Za-z0-9.-]+\.vercel\.app$/.test(host)) trusted.add(`https://${host}`);
  }
  if (trusted.has(origin)) return origin;
  // Local production builds used for development/QA are allowed, while hosted
  // requests cannot choose a localhost or attacker-controlled Host header.
  if (process.env.VERCEL !== '1' && ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname)) return origin;
  return null;
}

type DeliveryResult = { ok: true } | { ok: false; status: 429 | 503; error: string };
const unavailable = (): DeliveryResult => ({ ok: false, status: 503, error: 'We could not send a reset link right now. Please try again shortly.' });
const limited = (): DeliveryResult => ({ ok: false, status: 429, error: 'Too many reset requests. Please wait a few minutes, then try again.' });

async function reserveDelivery(email: string, request: NextRequest, admin: ReturnType<typeof createSupabaseAdminClient>, now = Date.now()): Promise<DeliveryResult> {
  const identity = recoveryRateLimitIdentity(email);
  // Vercel supplies these platform-controlled proxy headers. Outside Vercel,
  // local QA shares a deliberately conservative common caller bucket.
  const ip = process.env.VERCEL === '1'
    ? (request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for'))?.split(',')[0]?.trim() ?? 'unknown-platform-ip'
    : 'local-development';
  const minute = Math.floor(now / 60_000);
  const hour = Math.floor(now / 3_600_000);

  async function claim(scope: string, value: string, expiresAt: number) {
    return admin.from('marketing_event_log').insert({
      id: claimId(value), event_name: RECOVERY_LIMIT_EVENT, page_path: '/forgot-password',
      metadata: { recovery_identity: identity, scope, expires_at: new Date(expiresAt).toISOString() },
    });
  }
  // Unique primary-key slots serialize concurrent requests across all Preview
  // and Production server instances. There is no in-memory-only rate bypass.
  async function reserveSlots(scope: string, subject: string, slots: number): Promise<DeliveryResult> {
    let reserved = false;
    for (let slot = 0; slot < slots; slot++) {
      const result = await claim(scope, `${scope}:${subject}:${hour}:${slot}`, (hour + 1) * 3_600_000);
      if (!result.error) { reserved = true; break; }
      if (result.error.code !== '23505') return unavailable();
    }
    if (!reserved) return limited();
    return { ok: true };
  }
  // Reserve caller capacity first so exhausted clients cannot grow persistent
  // per-email claim rows by repeatedly changing the submitted email address.
  const callerCapacity = await reserveSlots('ip-hour', ip, 10);
  if (!callerCapacity.ok) return callerCapacity;
  const minuteClaim = await claim('email-minute', `email-minute:${email.toLowerCase()}:${minute}`, (minute + 1) * 60_000);
  if (minuteClaim.error) return minuteClaim.error.code === '23505' ? limited() : unavailable();
  return reserveSlots('email-hour', email.toLowerCase(), 5);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** Dedicated transactional mail: no campaigns, shadow recipients or credential logs. */
export async function sendRecoveryEmail(request: NextRequest, email: string, redirectTo: string): Promise<DeliveryResult> {
  const origin = trustedRecoveryOrigin(request);
  if (!origin || !process.env.RESEND_API_KEY) return unavailable();
  const admin = createSupabaseAdminClient();
  const reservation = await reserveDelivery(email, request, admin);
  if (!reservation.ok) return reservation;

  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  if (error) {
    // Unknown accounts get the same generic accepted response as known ones.
    // Never create an identity as a side effect of a recovery request.
    if (error.code === 'user_not_found' || error.status === 404) return { ok: true };
    return unavailable();
  }
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash || data.properties.verification_type !== 'recovery') return unavailable();
  const link = new URL('/auth/recovery', origin);
  link.searchParams.set('redirectTo', redirectTo);
  link.searchParams.set('token_hash', tokenHash);
  link.searchParams.set('type', 'recovery');
  const from = process.env.RESEND_FROM_ADDRESS?.trim() || 'Macro Bias <briefing@macro-bias.com>';
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error: deliveryError } = await resend.emails.send({
    from, to: [email], subject: 'Reset your Macro Bias password',
    html: `<h2>Reset your password</h2><p>Use the link below to choose a new password for your Macro Bias account.</p><p><a href="${escapeHtml(link.toString())}">Choose a new password</a></p><p>This link can be used once and expires shortly. If you did not request a reset, you can ignore this email.</p>`,
    text: `Reset your Macro Bias password\n\nChoose a new password: ${link.toString()}\n\nThis link can be used once and expires shortly. If you did not request a reset, you can ignore this email.`,
  }, { idempotencyKey: `password-recovery-${recoveryRateLimitIdentity(email)}-${Math.floor(Date.now() / 60_000)}` });
  if (deliveryError) return deliveryError.name === 'rate_limit_exceeded' ? limited() : unavailable();
  return { ok: true };
}
