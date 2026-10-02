import 'server-only';

import { redirect } from 'next/navigation';

import { getUserSubscriptionStatus } from '../billing/subscription';

/** Verify the server session before a workspace starts loading any data. */
export async function requireWorkspaceStatus(path: '/dashboard' | '/crypto/dashboard') {
  const status = await getUserSubscriptionStatus();
  const user = status.user;

  if (!user?.id) {
    redirect(`/login?redirectTo=${encodeURIComponent(path)}`);
  }

  return { ...status, user };
}
