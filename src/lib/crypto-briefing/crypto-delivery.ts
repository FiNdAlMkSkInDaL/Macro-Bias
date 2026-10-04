import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { Resend } from 'resend';

import { createSupabaseAdminClient } from '../supabase/admin';

const TABLE = 'marketing_event_log';
const LEASE_MS = 10 * 60 * 1_000;
const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const SEND_INTERVAL_MS = 550;
const PAGE_PATH = '/api/cron/crypto-publish';

export type CryptoPublicationClaim = {
  id: string;
  owner: string;
  claimed: boolean;
  completed: boolean;
};

export type CryptoEmailPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type CryptoEmailDeliveryResult = {
  status: 'accepted' | 'already_accepted' | 'in_progress' | 'uncertain' | 'failed';
  emailId?: string;
  error?: string;
};

type PublicationState = 'claimed' | 'completed' | 'published' | 'failed';
type DeliveryState = 'claimed' | 'sending' | 'accepted' | 'failed' | 'uncertain';
type Metadata = Record<string, unknown> & {
  version: 1;
  trade_date: string;
  owner: string;
  state: PublicationState | DeliveryState;
  lease_until: string;
};
type ClaimRow = { id: string; event_name: string; metadata: Metadata };
type Admin = ReturnType<typeof createSupabaseAdminClient>;

function dateIsValid(tradeDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(tradeDate)
    && Number.isFinite(Date.parse(`${tradeDate}T00:00:00Z`))
    && new Date(`${tradeDate}T00:00:00Z`).toISOString().slice(0, 10) === tradeDate;
}

function deterministicId(kind: string, identity: string) {
  const bytes = createHash('sha256').update(`macro-bias:${kind}:v1:${identity}`).digest().subarray(0, 16);
  // Version 8 reserves a UUID format for this application-defined digest.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function instant(value: unknown) {
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

function validMetadata(value: unknown, tradeDate: string): value is Metadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  return metadata.version === 1 && metadata.trade_date === tradeDate
    && typeof metadata.owner === 'string' && metadata.owner.length > 0
    && typeof metadata.state === 'string'
    && Number.isFinite(instant(metadata.lease_until));
}

async function readClaim(admin: Admin, id: string, eventName: string, tradeDate: string) {
  const { data, error } = await admin.from(TABLE)
    .select('id,event_name,metadata').eq('id', id).eq('event_name', eventName).maybeSingle();
  if (error || !data || !validMetadata(data.metadata, tradeDate)) {
    throw new Error('Could not read a valid crypto delivery claim.');
  }
  return data as ClaimRow;
}

async function replaceOwnedMetadata(admin: Admin, row: ClaimRow, metadata: Metadata) {
  const { data, error } = await admin.from(TABLE).update({ metadata })
    .eq('id', row.id).eq('event_name', row.event_name)
    .eq('metadata->>owner', row.metadata.owner)
    .eq('metadata->>state', row.metadata.state)
    .eq('metadata->>lease_until', row.metadata.lease_until)
    .select('id').maybeSingle();
  if (error) throw new Error('Could not persist crypto delivery state.');
  return Boolean(data);
}

export async function claimCryptoPublication(tradeDate: string): Promise<CryptoPublicationClaim> {
  if (!dateIsValid(tradeDate)) throw new Error('Invalid crypto publication date.');
  const admin = createSupabaseAdminClient();
  const id = deterministicId('crypto-publication', tradeDate);
  const owner = randomUUID();
  const now = Date.now();
  const metadata: Metadata = {
    version: 1, trade_date: tradeDate, owner, state: 'claimed',
    lease_until: new Date(now + LEASE_MS).toISOString(),
    claimed_at: new Date(now).toISOString(),
  };
  const { error } = await admin.from(TABLE).insert({
    id, event_name: 'crypto_publication', page_path: PAGE_PATH, metadata,
  });
  if (!error) return { id, owner, claimed: true, completed: false };
  if (error.code !== '23505') throw new Error('Could not persist crypto publication claim.');

  const row = await readClaim(admin, id, 'crypto_publication', tradeDate);
  if (row.metadata.state === 'completed') {
    return { id, owner: row.metadata.owner, claimed: false, completed: true };
  }
  if (!['claimed', 'published', 'failed'].includes(row.metadata.state)) {
    throw new Error('Invalid crypto publication state.');
  }
  if (row.metadata.state === 'claimed' && instant(row.metadata.lease_until) > now) {
    return { id, owner: row.metadata.owner, claimed: false, completed: false };
  }
  const claimed = await replaceOwnedMetadata(admin, row, { ...row.metadata, ...metadata });
  return { id, owner, claimed, completed: false };
}

export async function finishCryptoPublication(
  claim: CryptoPublicationClaim,
  status: 'completed' | 'published' | 'failed',
  summary: Record<string, unknown>,
): Promise<void> {
  if (!claim.claimed) throw new Error('Crypto publication claim is not owned.');
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from(TABLE).select('id,event_name,metadata')
    .eq('id', claim.id).eq('event_name', 'crypto_publication').maybeSingle();
  if (error || !data || typeof data.metadata?.trade_date !== 'string'
    || !validMetadata(data.metadata, data.metadata.trade_date)
    || data.metadata.owner !== claim.owner || data.metadata.state !== 'claimed') {
    throw new Error('Crypto publication ownership changed.');
  }
  const row = data as ClaimRow;
  const now = new Date().toISOString();
  const updated = await replaceOwnedMetadata(admin, row, {
    ...row.metadata, state: status, lease_until: now, finished_at: now, summary: jsonCopy(summary),
  });
  if (!updated) throw new Error('Crypto publication ownership changed.');
}

let sendQueue: Promise<void> = Promise.resolve();
let nextSendAt = 0;

async function withSendSlot<T>(run: () => Promise<T>): Promise<T> {
  const turn = sendQueue.then(async () => {
    const delay = Math.max(0, nextSendAt - Date.now());
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    return run();
  });
  sendQueue = turn.then(() => undefined, () => undefined);
  return turn;
}

function validPayload(value: unknown, recipient: string): value is CryptoEmailPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as CryptoEmailPayload;
  return typeof payload.from === 'string' && typeof payload.subject === 'string'
    && typeof payload.html === 'string' && typeof payload.text === 'string'
    && Array.isArray(payload.to) && payload.to.length === 1
    && typeof payload.to[0] === 'string' && payload.to[0].trim().toLowerCase() === recipient
    && !('cc' in payload) && !('bcc' in payload) && !('react' in payload);
}

function providerErrorCode(value: unknown) {
  if (!value || typeof value !== 'object') return 'unknown_provider_error';
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' && /^[a-z_]{1,64}$/.test(name) ? name : 'unknown_provider_error';
}

async function saveDeliveryOutcome(admin: Admin, row: ClaimRow, metadata: Metadata) {
  try { return await replaceOwnedMetadata(admin, row, metadata); } catch { return false; }
}

export async function sendCryptoEmailOnce({ tradeDate, recipient, payload, resend }: {
  tradeDate: string;
  recipient: string;
  payload: CryptoEmailPayload;
  resend: Pick<Resend, 'emails'>;
}): Promise<CryptoEmailDeliveryResult> {
  const email = recipient.trim().toLowerCase();
  if (!dateIsValid(tradeDate) || !/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 320
    || !validPayload(payload, email)) {
    return { status: 'failed', error: 'Invalid crypto email delivery input.' };
  }
  let admin: Admin;
  let row: ClaimRow;
  try {
    admin = createSupabaseAdminClient();
    const recipientHash = createHash('sha256').update(email).digest('hex');
    const id = deterministicId('crypto-email', `${tradeDate}:${recipientHash}`);
    const now = Date.now();
    const metadata: Metadata = {
      version: 1, trade_date: tradeDate, owner: randomUUID(), state: 'claimed',
      lease_until: new Date(now + LEASE_MS).toISOString(),
      recipient_hash: recipientHash,
      idempotency_key: `crypto-email-${tradeDate}-${recipientHash}`,
      payload: jsonCopy(payload), first_attempt_at: null, attempts: 0,
    };
    const { error } = await admin.from(TABLE).insert({
      id, event_name: 'crypto_email_delivery', page_path: PAGE_PATH,
      subscriber_email: email, metadata,
    });
    if (!error) {
      row = { id, event_name: 'crypto_email_delivery', metadata };
    } else {
      if (error.code !== '23505') throw new Error('Could not persist crypto email claim.');
      row = await readClaim(admin, id, 'crypto_email_delivery', tradeDate);
      if (row.metadata.state === 'accepted') {
        const emailId = row.metadata.email_id;
        return typeof emailId === 'string' && emailId.length > 0
          ? { status: 'already_accepted', emailId }
          : { status: 'uncertain', error: 'Crypto email receipt is unavailable.' };
      }
      if (!['claimed', 'sending', 'failed', 'uncertain'].includes(row.metadata.state)
        || row.metadata.recipient_hash !== recipientHash
        || row.metadata.idempotency_key !== metadata.idempotency_key
        || !validPayload(row.metadata.payload, email)) {
        return { status: 'uncertain', error: 'Crypto email claim could not be verified.' };
      }
      const firstAttempt = instant(row.metadata.first_attempt_at);
      if (row.metadata.first_attempt_at !== null && !Number.isFinite(firstAttempt)) {
        return { status: 'uncertain', error: 'Crypto email attempt time is unavailable.' };
      }
      if (Number.isFinite(firstAttempt) && (firstAttempt > now || now - firstAttempt >= REPLAY_WINDOW_MS)) {
        return { status: 'uncertain', error: 'Crypto email retry window has expired; automatic resend is blocked.' };
      }
      if (row.metadata.state !== 'failed' && instant(row.metadata.lease_until) > now) {
        return { status: 'in_progress' };
      }
      const claimed = await replaceOwnedMetadata(admin, row, {
        ...row.metadata, owner: metadata.owner, state: 'claimed', lease_until: metadata.lease_until,
      });
      if (!claimed) return { status: 'in_progress' };
      row = { ...row, metadata: {
        ...row.metadata, owner: metadata.owner, state: 'claimed', lease_until: metadata.lease_until,
      } };
    }
  } catch {
    return { status: 'failed', error: 'Could not persist crypto email claim before sending.' };
  }

  return withSendSlot(async (): Promise<CryptoEmailDeliveryResult> => {
    try {
      const firstAttempt = instant(row.metadata.first_attempt_at);
      if (Number.isFinite(firstAttempt) && Date.now() - firstAttempt >= REPLAY_WINDOW_MS) {
        return { status: 'uncertain', error: 'Crypto email retry window has expired; automatic resend is blocked.' };
      }
      const started = new Date().toISOString();
      const sending: Metadata = {
        ...row.metadata, state: 'sending',
        lease_until: new Date(Date.now() + LEASE_MS).toISOString(),
        first_attempt_at: row.metadata.first_attempt_at ?? started, last_attempt_at: started,
        attempts: (typeof row.metadata.attempts === 'number' ? row.metadata.attempts : 0) + 1,
      };
      if (!await replaceOwnedMetadata(admin, row, sending)) return { status: 'in_progress' };
      row = { ...row, metadata: sending };
    } catch {
      return { status: 'failed', error: 'Could not persist crypto email claim before sending.' };
    }

    try {
      // Mark the actual request start, rather than reserving a slot before a DB await.
      nextSendAt = Date.now() + SEND_INTERVAL_MS;
      const firstAttempt = instant(row.metadata.first_attempt_at);
      if (Number.isFinite(firstAttempt) && Date.now() - firstAttempt >= REPLAY_WINDOW_MS) {
        return { status: 'uncertain', error: 'Crypto email retry window has expired; automatic resend is blocked.' };
      }
      const response = await resend.emails.send(jsonCopy(row.metadata.payload as CryptoEmailPayload), {
        idempotencyKey: row.metadata.idempotency_key as string,
      });
      if (response.error) {
        const code = providerErrorCode(response.error);
        const rejected = typeof response.error.statusCode === 'number'
          && response.error.statusCode >= 400 && response.error.statusCode < 500
          && code !== 'invalid_idempotent_request' && code !== 'concurrent_idempotent_requests';
        const state = rejected ? 'failed' : 'uncertain';
        const saved = await saveDeliveryOutcome(admin, row, {
          ...row.metadata, state,
          lease_until: rejected ? new Date().toISOString() : row.metadata.lease_until,
          provider_error: { code, status: response.error.statusCode },
        });
        return {
          status: saved && rejected ? 'failed' : 'uncertain',
          error: `Crypto email provider ${rejected ? 'rejected' : 'could not confirm'} the request (${code}).`,
        };
      }
      if (typeof response.data?.id !== 'string' || !response.data.id) {
        await saveDeliveryOutcome(admin, row, { ...row.metadata, state: 'uncertain' });
        return { status: 'uncertain', error: 'Crypto email provider receipt is unavailable.' };
      }
      const emailId = response.data.id;
      const saved = await saveDeliveryOutcome(admin, row, {
        ...row.metadata, state: 'accepted', email_id: emailId,
        accepted_at: new Date().toISOString(), lease_until: new Date().toISOString(),
      });
      return saved ? { status: 'accepted', emailId }
        : { status: 'uncertain', emailId, error: 'Crypto email receipt could not be persisted; retry is held.' };
    } catch {
      await saveDeliveryOutcome(admin, row, { ...row.metadata, state: 'uncertain' });
      return { status: 'uncertain', error: 'Crypto email provider outcome is unknown; retry is held.' };
    }
  });
}
