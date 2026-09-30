'use client';

import { type FormEvent, useState } from 'react';

import { trackClientEvent } from '@/lib/analytics/client';

export function HeroSignupForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (state === 'loading') {
      return;
    }

    setState('loading');
    setMessage(null);

    try {
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          pagePath: '/',
          stocksOptedIn: true,
          cryptoOptedIn: true,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to subscribe.');
      }

      setState('success');
      setMessage('You are on the list. The next briefing arrives before the open.');
      trackClientEvent({
        eventName: 'email_signup_success',
        metadata: { location: 'landing_hero' },
      });
      setEmail('');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to subscribe.';
      setState('error');
      setMessage(text);
      trackClientEvent({
        eventName: 'email_signup_failure',
        metadata: { location: 'landing_hero', message: text },
      });
    }
  }

  if (state === 'success') {
    return (
      <p className="mt-8 text-sm text-emerald-300" aria-live="polite">
        {message}
      </p>
    );
  }

  return (
    <form id="free-alerts" className="mt-8 flex w-full max-w-xl flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="hero-email">
        Email address
      </label>
      <input
        id="hero-email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="h-12 flex-1 border border-zinc-800 bg-zinc-950 px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-500"
      />
      <button
        type="submit"
        disabled={state === 'loading'}
        className="h-12 bg-white px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === 'loading' ? 'Adding...' : 'Get Free Alerts'}
      </button>
      {message ? (
        <p className="text-sm text-rose-300 sm:basis-full" aria-live="polite">
          {message}
        </p>
      ) : null}
    </form>
  );
}
