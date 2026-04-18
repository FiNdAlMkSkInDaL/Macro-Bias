import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_QUERY_BATCH_SIZE = 500;

type FreeSubscriberStatusRow = {
  email: string | null;
  status?: string | null;
};

type FilterSubscribedEmailRecipientsResult = {
  deliverableEmails: string[];
  unsubscribedEmails: string[];
};

type UnsubscribeEmailAddressResult = {
  alreadyUnsubscribed: boolean;
};

export function normalizeEmailAddress(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidEmailAddress(email: string) {
  return email.length > 3 && email.length <= 320 && EMAIL_PATTERN.test(email);
}

function chunkValues<T>(values: readonly T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

export async function filterSubscribedEmailRecipients(
  supabase: SupabaseClient,
  emails: readonly string[],
): Promise<FilterSubscribedEmailRecipientsResult> {
  if (emails.length === 0) {
    return {
      deliverableEmails: [],
      unsubscribedEmails: [],
    };
  }

  const normalizedEmails = new Set<string>();
  const originalEmailByNormalizedValue = new Map<string, string>();

  for (const email of emails) {
    const normalizedEmail = normalizeEmailAddress(email);

    if (!normalizedEmail) {
      continue;
    }

    normalizedEmails.add(normalizedEmail);

    if (!originalEmailByNormalizedValue.has(normalizedEmail)) {
      originalEmailByNormalizedValue.set(normalizedEmail, email.trim());
    }
  }

  if (normalizedEmails.size === 0) {
    return {
      deliverableEmails: [],
      unsubscribedEmails: [],
    };
  }

  const unsubscribedEmailSet = new Set<string>();

  for (const batch of chunkValues([...normalizedEmails], EMAIL_QUERY_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('free_subscribers')
      .select('email')
      .in('email', batch)
      .eq('status', 'inactive');

    if (error) {
      throw new Error(`Failed to load unsubscribe state: ${error.message}`);
    }

    for (const row of (data as FreeSubscriberStatusRow[] | null) ?? []) {
      const normalizedEmail = normalizeEmailAddress(row.email);

      if (normalizedEmail) {
        unsubscribedEmailSet.add(normalizedEmail);
      }
    }
  }

  const deliverableEmailByNormalizedValue = new Map<string, string>();
  const unsubscribedEmailByNormalizedValue = new Map<string, string>();

  for (const email of emails) {
    const normalizedEmail = normalizeEmailAddress(email);

    if (!normalizedEmail) {
      continue;
    }

    const originalEmail = originalEmailByNormalizedValue.get(normalizedEmail) ?? email.trim();

    if (unsubscribedEmailSet.has(normalizedEmail)) {
      unsubscribedEmailByNormalizedValue.set(normalizedEmail, originalEmail);
      continue;
    }

    deliverableEmailByNormalizedValue.set(normalizedEmail, originalEmail);
  }

  return {
    deliverableEmails: [...deliverableEmailByNormalizedValue.values()],
    unsubscribedEmails: [...unsubscribedEmailByNormalizedValue.values()],
  };
}

export async function unsubscribeEmailAddress(
  supabase: SupabaseClient,
  email: string,
): Promise<UnsubscribeEmailAddressResult> {
  const normalizedEmail = normalizeEmailAddress(email);

  if (!isValidEmailAddress(normalizedEmail)) {
    throw new Error('Cannot unsubscribe an invalid email address.');
  }

  const { data: existingSubscriber, error: existingSubscriberError } = await supabase
    .from('free_subscribers')
    .select('status')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingSubscriberError) {
    throw new Error(`Failed to load existing subscriber status: ${existingSubscriberError.message}`);
  }

  const [{ error: subscriberError }, { error: enrollmentError }, { error: deliveryError }] = await Promise.all([
    supabase.from('free_subscribers').upsert(
      {
        crypto_opted_in: false,
        email: normalizedEmail,
        status: 'inactive',
        stocks_opted_in: false,
        tier: 'free',
      },
      {
        onConflict: 'email',
      },
    ),
    supabase
      .from('welcome_email_drip_enrollments')
      .update({ status: 'unsubscribed' })
      .eq('email', normalizedEmail),
    supabase
      .from('welcome_email_drip_deliveries')
      .update({
        error_message: 'Subscriber unsubscribed.',
        status: 'cancelled',
      })
      .eq('email', normalizedEmail)
      .eq('status', 'scheduled'),
  ]);

  if (subscriberError || enrollmentError || deliveryError) {
    const errorMessage = subscriberError?.message ?? enrollmentError?.message ?? deliveryError?.message;
    throw new Error(errorMessage ?? 'Unknown unsubscribe error.');
  }

  return {
    alreadyUnsubscribed: existingSubscriber?.status === 'inactive',
  };
}