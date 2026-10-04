import 'server-only';

import { normalizeEmailAddress } from '@/lib/marketing/email-preferences';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type AlertPreferences = {
  cryptoOptedIn: boolean;
  status: 'active' | 'inactive' | 'none';
  stocksOptedIn: boolean;
};

function isActiveStatus(status: unknown) {
  return status === 'active';
}

export async function loadAlertPreferences(email: string): Promise<AlertPreferences> {
  const normalizedEmail = normalizeEmailAddress(email);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('free_subscribers')
    .select('crypto_opted_in, status, stocks_opted_in')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load email alerts: ${error.message}`);
  }

  if (!data || !isActiveStatus(data.status)) {
    return {
      cryptoOptedIn: false,
      status: data ? 'inactive' : 'none',
      stocksOptedIn: false,
    };
  }

  return {
    cryptoOptedIn: data.crypto_opted_in === true,
    status: 'active',
    stocksOptedIn: data.stocks_opted_in === true,
  };
}

async function stopScheduledAlerts(email: string) {
  const admin = createSupabaseAdminClient();
  const [{ error: enrollmentError }, { error: deliveryError }] = await Promise.all([
    admin.from('welcome_email_drip_enrollments').update({ status: 'unsubscribed' }).eq('email', email),
    admin
      .from('welcome_email_drip_deliveries')
      .update({
        error_message: 'Subscriber turned email alerts off.',
        status: 'cancelled',
      })
      .eq('email', email)
      .eq('status', 'scheduled'),
  ]);

  if (enrollmentError || deliveryError) {
    throw new Error(enrollmentError?.message ?? deliveryError?.message ?? 'Failed to stop scheduled alerts.');
  }
}

export async function saveAlertPreferences(
  email: string,
  preferences: { cryptoOptedIn: boolean; stocksOptedIn: boolean },
) {
  const normalizedEmail = normalizeEmailAddress(email);
  const stocksOptedIn = preferences.stocksOptedIn;
  const cryptoOptedIn = preferences.cryptoOptedIn;
  const alertsOn = stocksOptedIn || cryptoOptedIn;
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from('free_subscribers')
    .select('email, status, created_at')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to load email alerts: ${existingError.message}`);
  }

  if (!existing && !alertsOn) {
    return;
  }

  const row = {
    crypto_opted_in: cryptoOptedIn,
    status: alertsOn ? 'active' : 'inactive',
    stocks_opted_in: stocksOptedIn,
  };

  let inserted: { created_at: string } | null = null;
  let writeError;
  if (existing) {
    const result = await admin.from('free_subscribers').update(row).eq('email', normalizedEmail);
    writeError = result.error;
  } else {
    const result = await admin.from('free_subscribers').upsert({
      ...row, email: normalizedEmail, tier: 'free',
    }, { onConflict: 'email', ignoreDuplicates: true }).select('created_at').maybeSingle();
    writeError = result.error;
    inserted = result.data;
    // A concurrent signup may have won the insert; this remains a preferences
    // update and cannot produce a second new-subscriber conversion.
    if (!writeError && !inserted) {
      const updated = await admin.from('free_subscribers').update(row).eq('email', normalizedEmail);
      writeError = updated.error;
    }
  }

  if (writeError) {
    throw new Error(`Failed to save email alerts: ${writeError.message}`);
  }

  if (!alertsOn) {
    await stopScheduledAlerts(normalizedEmail);
  }
  return {
    newSubscriber: Boolean(inserted),
    reactivated: alertsOn && existing?.status === 'inactive',
    createdAt: inserted?.created_at ?? existing?.created_at,
  };
}
