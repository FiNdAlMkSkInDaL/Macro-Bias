"use client";

import type { ReactNode } from 'react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { createSupabaseBrowserClient } from '../lib/supabase/browser';

type PaywallWrapperProps = {
  checkoutHref?: string;
  children: ReactNode;
  initialIsPro: boolean;
  userId: string | null;
};

function isActiveSubscriptionStatus(status: unknown): boolean {
  return status === 'active' || status === 'trialing';
}

function readSubscriptionStatus(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const subscriptionStatus = (value as { subscription_status?: unknown }).subscription_status;

  return typeof subscriptionStatus === 'string' ? subscriptionStatus : null;
}

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

export function PaywallWrapper({
  checkoutHref = '/api/checkout?plan=monthly',
  children,
  initialIsPro,
  userId,
}: PaywallWrapperProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isUnlocked, setIsUnlocked] = useState(initialIsPro);
  const refreshFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setIsUnlocked(initialIsPro);
  }, [initialIsPro]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const supabase = createSupabaseBrowserClient();

    const requestRefresh = (unlock = false) => {
      if (unlock) {
        setIsUnlocked(true);
      }

      if (refreshFrameRef.current !== null) {
        window.cancelAnimationFrame(refreshFrameRef.current);
      }

      refreshFrameRef.current = window.requestAnimationFrame(() => {
        startTransition(() => {
          router.refresh();
        });
      });
    };

    const checkLatestSubscriptionStatus = async () => {
      if (!userId) {
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('subscription_status')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        return;
      }

      if (isActiveSubscriptionStatus(data?.subscription_status)) {
        requestRefresh(true);
      }
    };

    const handleFocus = () => {
      requestRefresh();
      void checkLatestSubscriptionStatus();
    };

    const handlePageShow = () => {
      requestRefresh();
      void checkLatestSubscriptionStatus();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      requestRefresh();
      void checkLatestSubscriptionStatus();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED'
      ) {
        requestRefresh();
        void checkLatestSubscriptionStatus();
      }
    });

    const usersChannel = userId
      ? supabase
          .channel(`dashboard-subscription-status-${userId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              filter: `id=eq.${userId}`,
              schema: 'public',
              table: 'users',
            },
            (payload) => {
              const nextStatus = readSubscriptionStatus(payload.new);

              requestRefresh(isActiveSubscriptionStatus(nextStatus));
            },
          )
          .subscribe()
      : null;

    const pollingInterval =
      userId && !isUnlocked
        ? window.setInterval(() => {
            if (document.visibilityState === 'visible') {
              void checkLatestSubscriptionStatus();
            }
          }, 4000)
        : null;

    void checkLatestSubscriptionStatus();

    return () => {
      if (refreshFrameRef.current !== null) {
        window.cancelAnimationFrame(refreshFrameRef.current);
      }

      if (pollingInterval !== null) {
        window.clearInterval(pollingInterval);
      }

      authSubscription.unsubscribe();
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (usersChannel) {
        void supabase.removeChannel(usersChannel);
      }
    };
  }, [isUnlocked, router, startTransition, userId]);

  if (isUnlocked) {
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
            {isPending ? 'Refreshing access...' : 'Start 7-Day Free Trial'}
          </a>

          <p className="mt-2 text-center text-xs text-zinc-600">
            Full access for 7 days. No charge until day 8. Cancel anytime.
          </p>
        </div>
      </div>
    </div>
  );
}