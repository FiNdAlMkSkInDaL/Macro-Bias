'use client';

import { type FormEvent, useState } from 'react';

import { trackClientEvent } from '@/lib/analytics/client';
import { customerEmailRejection } from '@/lib/marketing/recipient-policy';

export function HeroSignupForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (state === 'loading') {
      return;
    }

    const rejection = customerEmailRejection(email);

    if (rejection) {
      setState('error');
      setMessage(rejection);
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
    <form id="free-alerts" className="mt-8 w-full max-w-xl" noValidate onSubmit={handleSubmit}>
      <div className="flex w-full flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="hero-email">
          Email address
        </label>
        <input
          id="hero-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="name@domain.com"
          value={email}
          aria-invalid={state === 'error'}
          onChange={(event) => setEmail(event.target.value)}
          className="h-12 min-w-0 flex-1 border border-zinc-800 bg-zinc-950 px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={state === 'loading'}
          className="inline-flex h-12 w-max max-w-full shrink-0 items-center justify-center whitespace-nowrap bg-white px-4 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
        >
          {state === 'loading' ? 'Adding...' : 'Email me the morning score.'}
        </button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-rose-300" aria-live="polite">
          {message}
        </p>
      ) : null}
    </form>
  );
}
