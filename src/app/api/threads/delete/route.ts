import { NextResponse, type NextRequest } from 'next/server';

/**
 * Threads data deletion callback (GDPR).
 * Called by Meta when a user requests deletion of their data.
 * Must return a confirmation URL or code.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    console.log('[threads/delete] Data deletion request received:', body.slice(0, 200));
  } catch {
    // Ignore parse errors — acknowledge regardless
  }

  // Meta expects either a status URL or a confirmation_code
  return NextResponse.json({
    url: 'https://www.macro-bias.com/privacy',
    confirmation_code: `delete-${Date.now()}`,
  });
}
