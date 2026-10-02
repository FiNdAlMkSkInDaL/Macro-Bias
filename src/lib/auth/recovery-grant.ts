import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { sanitizeRedirectPath } from './continuation';
import { getRequiredServerEnv } from '../server-env';

export const RECOVERY_COOKIE = 'mb-password-recovery';
export const RECOVERY_GRANT_SECONDS = 10 * 60;

export type RecoveryGrant = {
  version: 1;
  userId: string;
  userUpdatedAt: string;
  accessTokenHash: string;
  origin: string;
  redirectTo: string;
  expiresAt: number;
};

function signingKey() {
  const dedicated = process.env.AUTH_RECOVERY_SECRET?.trim();
  if (dedicated && dedicated.length < 32) throw new Error('AUTH_RECOVERY_SECRET must contain at least 32 characters.');
  return dedicated || getRequiredServerEnv('SUPABASE_SERVICE_ROLE_KEY');
}

export function recoveryTokenHash(accessToken: string) {
  return createHash('sha256').update(accessToken).digest('hex');
}

function sign(payload: string) {
  return createHmac('sha256', signingKey()).update(`password-recovery:v1:${payload}`).digest();
}

/** Issued only after Supabase verifies a recovery OTP, never from an ordinary session. */
export function createRecoveryGrant(params: {
  userId: string;
  userUpdatedAt: string;
  accessToken: string;
  origin: string;
  redirectTo: string;
}, now = Date.now()) {
  const grant: RecoveryGrant = {
    version: 1,
    userId: params.userId,
    userUpdatedAt: params.userUpdatedAt,
    accessTokenHash: recoveryTokenHash(params.accessToken),
    origin: params.origin,
    redirectTo: sanitizeRedirectPath(params.redirectTo) ?? '/dashboard',
    expiresAt: now + RECOVERY_GRANT_SECONDS * 1000,
  };
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  return `${payload}.${sign(payload).toString('base64url')}`;
}

export function readRecoveryGrant(value: string | undefined, origin: string, now = Date.now()): RecoveryGrant | null {
  if (!value || value.length > 8192) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;

  try {
    const supplied = Buffer.from(signature, 'base64url');
    const expected = sign(payload);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as RecoveryGrant;
    if (
      grant.version !== 1 ||
      typeof grant.userId !== 'string' || !grant.userId ||
      typeof grant.userUpdatedAt !== 'string' || !grant.userUpdatedAt ||
      typeof grant.accessTokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(grant.accessTokenHash) ||
      grant.origin !== origin ||
      typeof grant.redirectTo !== 'string' || sanitizeRedirectPath(grant.redirectTo) !== grant.redirectTo ||
      typeof grant.expiresAt !== 'number' || !Number.isFinite(grant.expiresAt) ||
      grant.expiresAt <= now || grant.expiresAt > now + RECOVERY_GRANT_SECONDS * 1000
    ) return null;
    return grant;
  } catch {
    return null;
  }
}

export function recoveryGrantMatchesUser(grant: RecoveryGrant, user: { id: string; updated_at?: string }, accessToken: string) {
  return grant.userId === user.id &&
    grant.userUpdatedAt === user.updated_at &&
    grant.accessTokenHash === recoveryTokenHash(accessToken);
}

/** Inspect only an access token that getUser has already verified with Supabase. */
export function hasFreshRecoveryAuthentication(accessToken: string, now = Date.now()) {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      amr?: Array<{ method?: string; timestamp?: number }>;
    };
    return Array.isArray(claims.amr) && claims.amr.some((entry) =>
      entry.method === 'recovery' && typeof entry.timestamp === 'number' &&
      entry.timestamp * 1000 > now - RECOVERY_GRANT_SECONDS * 1000 &&
      entry.timestamp * 1000 <= now + 60_000,
    );
  } catch {
    return false;
  }
}
