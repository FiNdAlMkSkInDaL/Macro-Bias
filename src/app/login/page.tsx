'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';

import { continuationFromSearchParams } from '@/lib/auth/continuation';
import { getAcquisitionAttribution } from '@/lib/analytics/client';
import {
  createSupabaseBrowserClient,
  getSupabaseBrowserClientConfigError,
} from '@/lib/supabase/browser';

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

  function continueAfterSignIn(path: string) {
    window.location.assign(path);
  }

  async function confirmAccount() {
    try { await fetch('/api/analytics/account', { method: 'POST', signal: AbortSignal.timeout(3000) }); }
    catch { /* Authentication succeeds even when attribution is unavailable. */ }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const explicitContinuation = continuationFromSearchParams({
      redirectTo: params.get('redirectTo'),
      plan: params.get('plan'),
      coupon: params.get('coupon'),
    });
    setRedirectPath(explicitContinuation ?? DEFAULT_SIGNED_IN_PATH);
    const authError = params.get('authError');

    if (authError) {
      setErrorMessage(authError);
    }

    // A plain visit from the header has no return path. Keep the form on screen
    // even when this browser already has a session.
    if (!supabase || !explicitContinuation || authError) {
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

        await confirmAccount();
        continueAfterSignIn(redirectPath);
        return;
      }

      const emailRedirectUrl = new URL('/auth/callback', window.location.origin);
      emailRedirectUrl.searchParams.set('redirectTo', redirectPath);
      const acquisition = getAcquisitionAttribution();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: emailRedirectUrl.toString(),
          ...(acquisition ? { data: { acquisition_v2: acquisition } } : {}),
        },
      });

      if (error) {
        throw error;
      }

      if (data.session?.user) {
        await confirmAccount();
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
    <main className="mx-auto max-w-md px-6 py-16">
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
        Account
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
        {authMode === 'signin' ? 'Sign in' : 'Create account'}
      </h1>
      <p className="mt-3 text-sm leading-6 text-zinc-400">
        Checkout on /pricing uses this account. The webhook grants access after Stripe confirms the subscription.
      </p>
      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm text-zinc-300">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 h-12 w-full border border-zinc-800 bg-zinc-950 px-4 text-white outline-none focus:border-zinc-500"
          />
        </label>
        <label className="block text-sm text-zinc-300">
          Password
          <input
            type="password"
            required
            autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 h-12 w-full border border-zinc-800 bg-zinc-950 px-4 text-white outline-none focus:border-zinc-500"
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="h-12 w-full bg-white text-sm font-semibold text-black disabled:opacity-60"
        >
          {isSubmitting ? 'Working' : authMode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <a
        href={`/forgot-password?${new URLSearchParams({ redirectTo: redirectPath }).toString()}`}
        className="mt-4 inline-block text-sm text-zinc-300 underline underline-offset-4"
      >
        Forgot password?
      </a>
      <button
        type="button"
        className="mt-4 text-sm text-zinc-500"
        onClick={() => {
          setAuthMode((mode) => (mode === 'signin' ? 'signup' : 'signin'));
          setErrorMessage(null);
          setStatusMessage(null);
        }}
      >
        {authMode === 'signin' ? 'Need an account?' : 'Already have an account?'}
      </button>
      {errorMessage && <p className="mt-4 text-sm text-rose-300">{errorMessage}</p>}
      {statusMessage && <p className="mt-4 text-sm text-emerald-300">{statusMessage}</p>}
    </main>
  );
}
