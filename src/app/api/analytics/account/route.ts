import { NextResponse } from 'next/server';

import { confirmAccountAcquisition } from '@/lib/analytics/conversions';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await confirmAccountAcquisition({ user, headers: request.headers });
  } catch {
    // An attribution outage cannot keep a verified customer out of their account.
    console.warn('[analytics] Account acquisition was not recorded.');
  }
  return NextResponse.json({ ok: true });
}
