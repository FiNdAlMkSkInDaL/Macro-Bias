'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';

import { LoadingAnnouncement, LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { continuationFromSearchParams } from '@/lib/auth/continuation';
import {
  createSupabaseBrowserClient,
  getSupabaseBrowserClientConfigError,
} from '@/lib/supabase/browser';
import styles from './login.module.css';

type AuthMode = 'signin' | 'signup';

const DEFAULT_SIGNED_IN_PATH = '/dashboard';

export default function LoginPage() {
  const browserClientConfigError = getSupabaseBrowserClientConfigError();
  const [supabase] = useState(() => (browserClientConfigError ? null : createSupabaseBrowserClient()));
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [redirectPath, setRedirectPath] = useState(DEFAULT_SIGNED_IN_PATH);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const forgotPasswordHref = `/forgot-password?${new URLSearchParams({ redirectTo: redirectPath }).toString()}`;

  function continueAfterSignIn(path: string) {
    window.location.assign(path);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'signup') setAuthMode('signup');
    const explicitContinuation = continuationFromSearchParams({
      redirectTo: params.get('redirectTo') ?? params.get('next'),
      plan: params.get('plan'),
      coupon: params.get('coupon'),
    });
    setRedirectPath(explicitContinuation ?? DEFAULT_SIGNED_IN_PATH);
    const authError = params.get('authError');

    if (authError) {
      setErrorMessage(authError);
    } else if (params.get('passwordReset') === 'success') {
      setStatusMessage('Password updated. Sign in with your new password.');
    }

    // A plain visit from the header has no return path. Keep the form on screen
    // even when this browser already has a session.
    if (!supabase || !explicitContinuation || params.get('passwordReset') === 'success') {
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' && session?.user) {
        window.location.assign(explicitContinuation);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setErrorMessage(browserClientConfigError ?? 'Sign-in is not configured.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      // signInWithPassword does not wait for initialize(). A refresh of a stale
      // cookie can still be in flight, fail, and delete the session just saved.
      // /dashboard then redirects back here with no error on the form.
      await supabase.auth.initialize();

      if (authMode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
          throw error;
        }

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !sessionData.session) {
          throw new Error('Sign-in did not keep a session. Submit again.');
        }

        continueAfterSignIn(redirectPath);
        return;
      }

      const emailRedirectUrl = new URL('/auth/callback', window.location.origin);
      emailRedirectUrl.searchParams.set('redirectTo', redirectPath);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: emailRedirectUrl.toString() },
      });

      if (error) {
        throw error;
      }

      if (data.session?.user) {
        continueAfterSignIn(redirectPath);
        return;
      }

      setStatusMessage('Account created. Check your email to confirm it, then sign in.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page} data-member-page>
      <header className={styles.header}>
        <h1>{authMode === 'signin' ? 'Sign in' : 'Create account'}</h1>
        <p>
          Read older full briefings and manage your account. If you choose Pro, your access begins once your subscription is confirmed.
        </p>
      </header>
      <div className={styles.panel}>
        <form className={styles.form} onSubmit={handleSubmit} aria-busy={isSubmitting} aria-describedby={errorMessage ? 'auth-error' : statusMessage ? 'auth-status' : undefined}>
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
          <div className={styles.field}>
            <div className={styles.fieldHeading}>
              <label htmlFor="login-password">Password</label>
              {authMode === 'signin' ? (
                <a className={styles.forgotPassword} href={forgotPasswordHref}>Forgot password?</a>
              ) : null}
            </div>
            <input
              id="login-password"
              name="password"
              type="password"
              required
              autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className={styles.submit}
          >
            {isSubmitting ? <LoadingIndicator compact announce={false} label={authMode === 'signin' ? 'Signing in' : 'Creating account'} /> : authMode === 'signin' ? 'Sign in' : 'Create your free account'}
          </button>
        </form>
        {isSubmitting ? <LoadingAnnouncement label={authMode === 'signin' ? 'Signing in' : 'Creating account'} /> : null}
        <button
          type="button"
          disabled={isSubmitting}
          className={styles.switchMode}
          onClick={() => {
            setAuthMode((mode) => (mode === 'signin' ? 'signup' : 'signin'));
            setErrorMessage(null);
            setStatusMessage(null);
          }}
        >
          {authMode === 'signin' ? 'Need an account?' : 'Already have an account?'}
        </button>
        {errorMessage ? <p id="auth-error" className={`${styles.message} ${styles.error}`} role="alert">{errorMessage}</p> : null}
        {statusMessage ? <p id="auth-status" className={styles.message} role="status">{statusMessage}</p> : null}
      </div>
    </main>
  );
}
