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
      <div aria-hidden="true" className="pointer-events-none select-none blur-md">
        {children}
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
        <div aria-hidden="true" className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />

        <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950/92 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white">
            <LockIcon />
          </div>

          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.36em] text-zinc-500">
            Premium unlock
          </p>

          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">
            Upgrade to Pro for $19/mo
          </h2>

          <p className="mt-3 text-sm leading-7 text-zinc-300">
            Unlock the proprietary Quant Breakdown, the historical analog table, and the live Cross-Asset Heatmap to see which prior sessions today's tape most closely resembles and where the next move usually lands.
          </p>

          <a
            className="mt-8 inline-flex items-center justify-center rounded-md bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-zinc-200"
            href={checkoutHref}
          >
            Upgrade to Pro
          </a>
        </div>
      </div>
    </div>
  );
}