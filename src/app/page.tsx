"use client";

import type { FormEvent } from "react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import { createSupabaseBrowserClient } from "../lib/supabase/browser";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const dataFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-data",
});

type AuthMode = "signin" | "signup";

type Credentials = {
  email: string;
  password: string;
};

function sanitizeRedirectPath(rawRedirectPath: string | null): string {
  if (!rawRedirectPath || !rawRedirectPath.startsWith("/") || rawRedirectPath.startsWith("//")) {
    return "/dashboard";
  }

  return rawRedirectPath;
}

function getSubmitLabel(mode: AuthMode, isSubmitting: boolean, isRedirecting: boolean) {
  if (isRedirecting) {
    return "Routing you in";
  }

  if (isSubmitting) {
    return mode === "signin" ? "Signing in" : "Creating account";
  }

  return mode === "signin" ? "Sign in to Dashboard" : "Create your account";
}

export default function HomePage() {
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [credentials, setCredentials] = useState<Credentials>({
    email: "",
    password: "",
  });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [redirectPath, setRedirectPath] = useState("/dashboard");
  const [isRedirecting, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const resolvedRedirectPath = sanitizeRedirectPath(
      new URLSearchParams(window.location.search).get("redirectTo"),
    );

    setRedirectPath(resolvedRedirectPath);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "INITIAL_SESSION" || event === "SIGNED_IN") && session?.user) {
        startTransition(() => {
          router.replace(resolvedRedirectPath);
          router.refresh();
        });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  function updateField(field: keyof Credentials, value: string) {
    setCredentials((currentCredentials) => ({
      ...currentCredentials,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      if (authMode === "signin") {
        const { error } = await supabase.auth.signInWithPassword(credentials);

        if (error) {
          throw error;
        }

        setStatusMessage("Authentication complete. Routing you to your dashboard.");
        startTransition(() => {
          router.replace(redirectPath);
          router.refresh();
        });
        return;
      }

      const emailRedirectUrl = new URL("/", window.location.origin);
      emailRedirectUrl.searchParams.set("redirectTo", redirectPath);

      const { data, error } = await supabase.auth.signUp({
        email: credentials.email,
        password: credentials.password,
        options: {
          emailRedirectTo: emailRedirectUrl.toString(),
        },
      });

      if (error) {
        throw error;
      }

      if (data.session?.user) {
        setStatusMessage("Account created. Routing you to your dashboard.");
        startTransition(() => {
          router.replace(redirectPath);
          router.refresh();
        });
        return;
      }

      setStatusMessage(
        "Account created. Check your email to confirm access, then you will be returned to your dashboard automatically.",
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Authentication failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main
      className={`${headingFont.variable} ${dataFont.variable} min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.12),_transparent_24%),radial-gradient(circle_at_85%_15%,_rgba(148,163,184,0.1),_transparent_18%),linear-gradient(180deg,_#020617_0%,_#0f172a_55%,_#020617_100%)] px-4 py-10 font-sans font-[family:var(--font-heading)] text-slate-100 sm:px-6 lg:px-8`}
    >
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
        <section className="overflow-hidden rounded-[32px] border border-slate-800/80 bg-slate-950/75 p-6 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur-sm sm:p-8">
          <span className="inline-flex items-center rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 font-mono font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.32em] text-sky-200">
            Macro Weather Report
          </span>

          <h1 className="mt-5 max-w-3xl text-4xl font-semibold text-white sm:text-5xl">
            Secure access to the live macro regime dashboard.
          </h1>

          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            Sign in or create an account to unlock the protected Macro Bias workspace. Your route back to the dashboard is preserved automatically.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <article className="rounded-[24px] border border-slate-800 bg-slate-900/70 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">
                Destination
              </p>
              <p className="mt-4 font-mono text-lg text-white">{redirectPath}</p>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Middleware set this return path so successful authentication drops you straight into the protected experience.
              </p>
            </article>

            <article className="rounded-[24px] border border-emerald-500/25 bg-emerald-500/10 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-emerald-200/75">
                Live Signal
              </p>
              <p className="mt-4 text-2xl font-semibold text-white">Daily bias snapshot</p>
              <p className="mt-3 text-sm leading-6 text-emerald-50/80">
                The dashboard reads directly from the latest server snapshot written to Supabase.
              </p>
            </article>

            <article className="rounded-[24px] border border-sky-400/25 bg-sky-400/10 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-sky-200/75">
                Paywall Shape
              </p>
              <p className="mt-4 text-2xl font-semibold text-white">Gauge free, heatmap gated</p>
              <p className="mt-3 text-sm leading-6 text-sky-50/80">
                Users see the macro score first, then upgrade for the full cross-asset premium view.
              </p>
            </article>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <article className="rounded-[28px] border border-slate-800/80 bg-slate-950/80 p-6 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-sm">
              <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
                What unlocks
              </p>
              <div className="mt-5 space-y-4 text-sm leading-6 text-slate-300">
                <p>Protected dashboard access behind Supabase session validation.</p>
                <p>Stripe-powered upgrade path for premium cross-asset heatmap exposure.</p>
                <p>Email-confirmation-safe callback handling that preserves the original dashboard redirect.</p>
              </div>
            </article>

            <article className="rounded-[28px] border border-slate-800/80 bg-slate-950/80 p-6 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-sm">
              <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
                Session routing
              </p>
              <div className="mt-5 rounded-[22px] border border-slate-800 bg-slate-900/70 p-4 font-mono text-xs text-slate-300">
                <p>1. Middleware guards /dashboard</p>
                <p className="mt-2">2. Root page receives redirectTo={redirectPath}</p>
                <p className="mt-2">3. Supabase auth completes</p>
                <p className="mt-2">4. Router returns user to {redirectPath}</p>
              </div>
            </article>
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-800/80 bg-slate-950/80 p-6 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur-sm sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
                Access Console
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-white">Authenticate to continue</h2>
            </div>
            <div className="rounded-full border border-slate-700 bg-slate-900/80 p-1 text-sm text-slate-300">
              <button
                className={`rounded-full px-4 py-2 transition ${
                  authMode === "signin" ? "bg-white text-slate-950" : "text-slate-300"
                }`}
                onClick={() => {
                  setAuthMode("signin");
                  setErrorMessage(null);
                  setStatusMessage(null);
                }}
                type="button"
              >
                Sign in
              </button>
              <button
                className={`rounded-full px-4 py-2 transition ${
                  authMode === "signup" ? "bg-white text-slate-950" : "text-slate-300"
                }`}
                onClick={() => {
                  setAuthMode("signup");
                  setErrorMessage(null);
                  setStatusMessage(null);
                }}
                type="button"
              >
                Create account
              </button>
            </div>
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-400" htmlFor="email">
                Email
              </label>
              <input
                autoComplete="email"
                className="mt-2 w-full rounded-[20px] border border-slate-700 bg-slate-900/80 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-sky-400/60"
                id="email"
                onChange={(event) => updateField("email", event.target.value)}
                placeholder="you@macro-bias.com"
                required
                type="email"
                value={credentials.email}
              />
            </div>

            <div>
              <label className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-400" htmlFor="password">
                Password
              </label>
              <input
                autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                className="mt-2 w-full rounded-[20px] border border-slate-700 bg-slate-900/80 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-sky-400/60"
                id="password"
                minLength={8}
                onChange={(event) => updateField("password", event.target.value)}
                placeholder="Minimum 8 characters"
                required
                type="password"
                value={credentials.password}
              />
            </div>

            <div className="rounded-[24px] border border-slate-800 bg-slate-900/70 p-4 text-sm leading-6 text-slate-300">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">Redirect after auth</p>
              <p className="mt-3 font-mono text-slate-100">{redirectPath}</p>
              <p className="mt-3 text-slate-400">
                {authMode === "signin"
                  ? "Successful sign-in routes immediately to the protected dashboard."
                  : "If email confirmation is enabled, the confirmation link returns here first and then forwards you into the dashboard."}
              </p>
            </div>

            {statusMessage ? (
              <div className="rounded-[20px] border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-50" role="status">
                {statusMessage}
              </div>
            ) : null}

            {errorMessage ? (
              <div className="rounded-[20px] border border-rose-500/25 bg-rose-500/10 p-4 text-sm leading-6 text-rose-100" role="alert">
                {errorMessage}
              </div>
            ) : null}

            <button
              className="inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={isSubmitting || isRedirecting}
              type="submit"
            >
              {getSubmitLabel(authMode, isSubmitting, isRedirecting)}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}