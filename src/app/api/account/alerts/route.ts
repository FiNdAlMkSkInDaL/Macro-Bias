import { NextResponse } from 'next/server';

import { saveAlertPreferences } from '@/lib/account/alert-preferences';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function readFlag(value: unknown) {
  return value === true;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.email) {
    return NextResponse.json({ error: 'Sign in to manage alerts.' }, { status: 401 });
  }

  let payload: { cryptoOptedIn?: unknown; stocksOptedIn?: unknown };

  try {
    payload = (await request.json()) as { cryptoOptedIn?: unknown; stocksOptedIn?: unknown };
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  try {
    await saveAlertPreferences(user.email, {
      cryptoOptedIn: readFlag(payload.cryptoOptedIn),
      stocksOptedIn: readFlag(payload.stocksOptedIn),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save email alerts.';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
