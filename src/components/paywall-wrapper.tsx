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
    <div className="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none select-none opacity-70 blur-[10px] saturate-[0.82]"
      >
        {children}
      </div>

      <div className="absolute inset-0 flex items-center justify-center p-3 text-center sm:p-4 lg:p-6">
        <div aria-hidden="true" className="absolute inset-0 bg-black/38 backdrop-blur-[1px]" />

        <div className="relative w-full max-w-[22rem] rounded-2xl border border-white/10 bg-zinc-950/94 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.52)] backdrop-blur-xl sm:max-w-sm sm:p-6 lg:max-w-md lg:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white sm:h-14 sm:w-14">
            <LockIcon />
          </div>

          <h2 className="mt-5 text-2xl font-bold tracking-tighter text-white sm:mt-6">
            Unlock the Historical Playbook
          </h2>

          <p className="mt-3 text-sm text-zinc-400">
            Analyze exactly how the S&P 500 reacted the last 5 times this regime appeared.
          </p>

          <a
            className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-zinc-200 sm:mt-8"
            href={checkoutHref}
          >
            Upgrade to Pro
          </a>
        </div>
      </div>
    </div>
  );
}