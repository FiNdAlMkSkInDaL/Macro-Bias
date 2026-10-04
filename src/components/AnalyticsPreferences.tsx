"use client";

import { useEffect, useState } from 'react';
import { browserPrivacyOptOut, CONSENT_CHANGE_EVENT, getAnalyticsConsent, setAnalyticsConsent } from '@/lib/analytics/client';
import { isExcludedAnalyticsPath } from '@/lib/analytics/attribution';

export function AnalyticsPreferences({ pagePath }: { pagePath: string }) {
  const [consent, setConsent] = useState<'granted' | 'denied' | 'pending' | null>(null);
  const [editing, setEditing] = useState(false);
  const [optOut, setOptOut] = useState(false);

  useEffect(() => {
    const update = () => { setConsent(getAnalyticsConsent()); setOptOut(browserPrivacyOptOut()); };
    update();
    window.addEventListener(CONSENT_CHANGE_EVENT, update);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, update);
  }, []);

  if (consent === null || isExcludedAnalyticsPath(pagePath)) return null;
  if (consent !== 'pending' && !editing) {
    return pagePath === '/privacy' ? (
      <button type="button" onClick={() => setEditing(true)} className="fixed bottom-5 left-5 z-50 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-xs text-zinc-300 shadow-xl hover:border-zinc-500">
        Analytics preferences
      </button>
    ) : null;
  }

  function choose(value: 'granted' | 'denied') {
    setAnalyticsConsent(value);
    setEditing(false);
  }

  return (
    <section aria-label="Analytics preferences" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl sm:left-6 sm:right-auto sm:mx-0 sm:p-6">
      <p className="font-[family:var(--font-heading)] text-base font-semibold text-white">Help us understand what works</p>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        {optOut ? 'Your browser asks us not to track you. We respect that choice and keep analytics anonymous.' : 'Optional analytics remembers how you found Macro Bias and which pages you visit for 90 days. Essential only keeps anonymous page totals.'}
        {' '}<a href="/privacy" className="text-zinc-200 underline underline-offset-4">Privacy details</a>
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {!optOut && <button type="button" onClick={() => choose('granted')} className="min-h-11 rounded-lg bg-lime-300 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-lime-200">Accept analytics</button>}
        <button type="button" onClick={() => choose('denied')} className="min-h-11 rounded-lg border border-zinc-600 bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800">Essential only</button>
      </div>
    </section>
  );
}
