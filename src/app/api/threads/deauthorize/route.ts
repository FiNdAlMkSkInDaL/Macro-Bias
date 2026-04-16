import { NextResponse, type NextRequest } from 'next/server';

/**
 * Threads deauthorize callback.
 * Called by Meta when a user removes the Macro Bias app from their Threads account.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    console.log('[threads/deauthorize] User deauthorized Threads app:', body.slice(0, 200));
  } catch {
    // Ignore parse errors — just acknowledge
  }

  return NextResponse.json({ ok: true });
}
