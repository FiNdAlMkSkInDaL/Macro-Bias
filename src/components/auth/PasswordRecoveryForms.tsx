'use client';

import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import styles from '@/app/login/login.module.css';
import { continuationFromSearchParams } from '@/lib/auth/continuation';

const ENDPOINT = '/api/auth/password-reset';
const DEFAULT_CONTINUATION = '/dashboard';
const RESET_CONFIRMATION = 'If an account uses this email address, you’ll receive a password reset link. Check your inbox and spam folder.';
const INVALID_LINK = 'That reset link is invalid or has expired. Request a new link to continue.';

type RecoveryResponse = {
  ok?: boolean;
  canReset?: boolean;
  redirectTo?: string;
  error?: string;
};

function continuationHref(path: string, redirectTo: string, params?: Record<string, string>) {
  return `${path}?${new URLSearchParams({ redirectTo, ...params }).toString()}`;
}

async function responseData(response: Response): Promise<RecoveryResponse> {
  return response.json().catch(() => ({}));
}

function responseError(response: Response, data: RecoveryResponse, fallback: string) {
  if (typeof data.error === 'string' && data.error.length > 0) return data.error;
  if (response.status === 429) return 'Too many requests. Please wait a few minutes and try again.';
  return fallback;
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [redirectTo, setRedirectTo] = useState(DEFAULT_CONTINUATION);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRedirectTo(continuationFromSearchParams({
      redirectTo: params.get('redirectTo') ?? params.get('next'),
      plan: params.get('plan'),
      coupon: params.get('coupon'),
    }) ?? DEFAULT_CONTINUATION);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectTo }),
      });
      const data = await responseData(response);
      if (!response.ok || !data.ok) {
        setErrorMessage(responseError(response, data, 'We couldn’t send a reset link right now. Please try again shortly.'));
        return;
      }
      setIsSent(true);
    } catch {
      setErrorMessage('We couldn’t connect. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page} data-member-page>
      <header className={styles.header}>
        <h1>Reset your password</h1>
        <p>Enter your account email to request a password reset link.</p>
      </header>
      <div className={styles.panel}>
        {isSent ? (
          <p className={styles.stateText} role="status">{RESET_CONFIRMATION}</p>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit} aria-busy={isSubmitting} aria-describedby={errorMessage ? 'recovery-request-error' : undefined}>
            <label className={styles.field}>
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <button type="submit" className={styles.submit} disabled={isSubmitting}>
              {isSubmitting ? 'Sending reset link…' : 'Send reset link'}
            </button>
          </form>
        )}
        <div className={styles.secondaryActions}>
          {isSent ? <button type="button" className={styles.switchMode} onClick={() => setIsSent(false)}>Use a different email</button> : null}
          <a className={styles.textLink} href={continuationHref('/login', redirectTo)}>Back to sign in</a>
        </div>
        {errorMessage ? <p id="recovery-request-error" className={`${styles.message} ${styles.error}`} role="alert">{errorMessage}</p> : null}
      </div>
    </main>
  );
}

export function ResetPasswordForm() {
  const [linkState, setLinkState] = useState<'checking' | 'valid' | 'invalid' | 'unavailable' | 'complete'>('checking');
  const [redirectTo, setRedirectTo] = useState(DEFAULT_CONTINUATION);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmationInvalid, setConfirmationInvalid] = useState(false);
  const confirmationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(window.location.search);
    // A failed link may retain an internal destination for requesting another
    // email. A valid reset always takes its destination from the server grant.
    const retryRedirectTo = continuationFromSearchParams({
      redirectTo: params.get('redirectTo') ?? params.get('next'),
      plan: params.get('plan'),
      coupon: params.get('coupon'),
    }) ?? DEFAULT_CONTINUATION;
    async function checkLink() {
      try {
        const response = await fetch(ENDPOINT, { cache: 'no-store', signal: controller.signal });
        const data = await responseData(response);
        if (controller.signal.aborted) return;
        if (!response.ok && response.status !== 401) {
          setRedirectTo(retryRedirectTo);
          setLinkState('unavailable');
          return;
        }
        if (!data.canReset) {
          setRedirectTo(retryRedirectTo);
          setLinkState('invalid');
          return;
        }
        setRedirectTo(continuationFromSearchParams({ redirectTo: data.redirectTo }) ?? DEFAULT_CONTINUATION);
        setLinkState('valid');
      } catch {
        if (!controller.signal.aborted) {
          setRedirectTo(retryRedirectTo);
          setLinkState('unavailable');
        }
      }
    }
    void checkLink();
    return () => controller.abort();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (linkState !== 'valid' || isSubmitting) return;
    if (password !== confirmation) {
      setConfirmationInvalid(true);
      setErrorMessage('Passwords do not match. Enter the same password in both fields.');
      confirmationRef.current?.focus();
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await responseData(response);
      if (!response.ok || !data.ok) {
        if (response.status === 401 || response.status === 403) setLinkState('invalid');
        else setErrorMessage(responseError(response, data, 'We couldn’t save your new password. Please try again.'));
        return;
      }
      setPassword('');
      setConfirmation('');
      setRedirectTo(continuationFromSearchParams({ redirectTo: data.redirectTo }) ?? redirectTo);
      setLinkState('complete');
    } catch {
      setErrorMessage('We couldn’t connect. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page} data-member-page>
      <header className={styles.header}>
        <h1>{linkState === 'complete' ? 'Your password has been updated' : 'Choose a new password'}</h1>
        <p>{linkState === 'complete' ? 'Sign in with your new password to continue.' : 'Save a new password for your Macro Bias account.'}</p>
      </header>
      <div className={styles.panel}>
        {linkState === 'checking' ? <p className={styles.stateText} role="status">Checking your reset link…</p> : null}
        {linkState === 'invalid' || linkState === 'unavailable' ? (
          <>
            <p className={styles.stateText} role="alert">{linkState === 'invalid' ? INVALID_LINK : 'We couldn’t check your reset link. Check your connection and reload this page, or request a new link.'}</p>
            <a className={styles.textLink} href={continuationHref('/forgot-password', redirectTo)}>Request a new link</a>
          </>
        ) : null}
        {linkState === 'valid' ? (
          <form className={styles.form} onSubmit={handleSubmit} aria-busy={isSubmitting} aria-describedby={errorMessage ? 'recovery-reset-error' : 'password-requirements'}>
            <label className={styles.field}>
              New password
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                aria-describedby="password-requirements"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setConfirmationInvalid(false);
                }}
              />
            </label>
            <p id="password-requirements" className={styles.help}>Use at least 8 characters.</p>
            <label className={styles.field}>
              Confirm new password
              <input
                ref={confirmationRef}
                name="password-confirmation"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                aria-invalid={confirmationInvalid || undefined}
                aria-describedby={confirmationInvalid ? 'recovery-reset-error' : undefined}
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setConfirmationInvalid(false);
                }}
              />
            </label>
            <button type="submit" className={styles.submit} disabled={isSubmitting}>
              {isSubmitting ? 'Saving password…' : 'Save new password'}
            </button>
          </form>
        ) : null}
        {linkState === 'complete' ? (
          <a className={`${styles.submit} ${styles.successLink}`} href={continuationHref('/login', redirectTo, { passwordReset: 'success' })}>Sign in</a>
        ) : null}
        {errorMessage && linkState === 'valid' ? <p id="recovery-reset-error" className={`${styles.message} ${styles.error}`} role="alert">{errorMessage}</p> : null}
      </div>
    </main>
  );
}
