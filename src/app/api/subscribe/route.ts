import { NextResponse } from 'next/server';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SUBSCRIBE_SUCCESS_MESSAGE = '[SYSTEM OUTPUT]: EMAIL ADDED TO PROTOCOL.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SubscribeRequestBody = {
  email?: unknown;
};

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(email: string) {
  return email.length > 3 && email.length <= 320 && EMAIL_PATTERN.test(email);
}

export async function POST(request: Request) {
  let payload: SubscribeRequestBody;

  try {
    payload = (await request.json()) as SubscribeRequestBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const email = normalizeEmail(payload.email);

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from('free_subscribers').upsert(
    {
      email,
      status: 'active',
      tier: 'free',
    },
    {
      onConflict: 'email',
    },
  );

  if (error) {
    return NextResponse.json(
      { error: `Unable to add email to protocol: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ message: SUBSCRIBE_SUCCESS_MESSAGE, ok: true }, { status: 200 });
}
