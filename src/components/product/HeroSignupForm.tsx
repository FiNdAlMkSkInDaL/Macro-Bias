'use client';

import { type FormEvent, useId, useState } from 'react';

import { LoadingAnnouncement, LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { trackClientEvent } from '@/lib/analytics/client';
import { customerEmailRejection } from '@/lib/marketing/recipient-policy';

import { ArrowIcon } from './ArrowIcon';
import styles from './HeroSignupForm.module.css';

type SignupLocation = 'landing_hero' | 'landing_footer' | 'stock_daily_hero' | 'stock_daily_footer' | 'crypto_daily_hero' | 'crypto_daily_footer';

export function HeroSignupForm({ location = 'landing_hero', pagePath = '/' }: { location?: SignupLocation; pagePath?: '/' | '/today' | '/crypto' }) {
  const inputId = useId();
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
          pagePath,
          stocksOptedIn: true,
          cryptoOptedIn: true,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to subscribe.');
      }

      setState('success');
      setMessage('You’re on the list. Look out for your daily Macro Bias score and market update.');
      trackClientEvent({
        eventName: 'email_signup_success',
        metadata: { location },
      });
      setEmail('');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Unable to subscribe.';
      setState('error');
      setMessage(text);
      trackClientEvent({
        eventName: 'email_signup_failure',
        metadata: { location, message: text },
      });
    }
  }

  return (
    <><form id={location === 'landing_hero' ? 'free-alerts' : undefined} className={styles.form} noValidate onSubmit={handleSubmit} aria-busy={state === 'loading'}>
      {state === 'success' ? (
        <p className={styles.success} role="status">{message}</p>
      ) : (
        <>
          <div className={styles.fields}>
            <label className="sr-only" htmlFor={inputId}>Email address</label>
            <input
              id={inputId}
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="Your email address"
              value={email}
              aria-invalid={state === 'error'}
              aria-describedby={`${inputId}-helper${message ? ` ${inputId}-error` : ''}`}
              onChange={(event) => setEmail(event.target.value)}
              className={styles.input}
            />
            <button type="submit" disabled={state === 'loading'} className={styles.button}>
              {state === 'loading' ? <LoadingIndicator compact announce={false} label="Adding your email" /> : 'Get the daily score'}
              {state !== 'loading' ? <ArrowIcon /> : null}
            </button>
          </div>
          {message ? (
            <p id={`${inputId}-error`} className={styles.error} role="alert">{message}</p>
          ) : null}
        </>
      )}
      <p id={`${inputId}-helper`} className={styles.helper}>
        Free stock emails on market days; crypto every day. Unsubscribe anytime.
      </p>
    </form>
      {state === 'loading' ? <LoadingAnnouncement label="Adding your email" /> : null}
    </>
  );
}
