import type { ReactNode } from 'react';

import { getUserSubscriptionStatus } from '../lib/billing/subscription';

type PaywallWrapperProps = {
  checkoutHref?: string;
  children: ReactNode;
};

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d="M7 10V7a5 5 0 0 1 10 0v3" />
      <rect height="10" rx="2" width="14" x="5" y="10" />
      <path d="M12 14v2.5" />
    </svg>
  );
}

export async function PaywallWrapper({
  checkoutHref = '/api/checkout?plan=monthly',
  children,
}: PaywallWrapperProps) {
  const { subscriptionStatus } = await getUserSubscriptionStatus();

  if (subscriptionStatus === 'active') {
    return <>{children}</>;
  }

  return (
    <div className="relative isolate overflow-hidden rounded-3xl">
      <div aria-hidden="true" className="pointer-events-none select-none blur-md">
        {children}
      </div>

      <div className="absolute inset-0 flex items-center justify-center bg-slate-950/15 p-6">
        <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white/90 p-6 text-center shadow-2xl backdrop-blur">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white">
            <LockIcon />
          </div>

          <h2 className="mt-4 text-xl font-semibold tracking-tight text-slate-950">
            Upgrade to Pro for $19/mo
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            Unlock the full Macro Bias workspace once your subscription is active.
          </p>

          <a
            className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
            href={checkoutHref}
          >
            Upgrade to Pro
          </a>
        </div>
      </div>
    </div>
  );
}