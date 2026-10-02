'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Daily publications can arrive while this page is open; this is not a live quote feed. */
export function DailyReadingRefresh() {
  const router = useRouter();

  useEffect(() => {
    let refreshedAt = 0;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - refreshedAt < 5_000) return;
      refreshedAt = Date.now();
      startTransition(() => router.refresh());
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);

  return null;
}
