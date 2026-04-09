import { type NextRequest } from 'next/server';

import { handleSocialDispatch } from '@/lib/social/scheduled-post-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  return handleSocialDispatch(request);
}