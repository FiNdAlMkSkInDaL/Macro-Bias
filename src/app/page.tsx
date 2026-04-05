"use client";

import type { FormEvent } from "react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import {
  createSupabaseBrowserClient,
  getMissingSupabasePublicEnvVars,
  getSupabaseBrowserClientConfigError,
} from "../lib/supabase/browser";

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

const heroStats = [
  {
    label: "Update cadence",
    value: "Daily before the bell",
  },
  {
    label: "Coverage",
    value: "Volatility, credit, trend",
  },
  {
    label: "Price",
    value: "$25 / month",
  },
] as const;

const quantPillars = [
  {
    symbol: "^VIX",
    title: "Volatility",
    description:
      "Detects whether the session is opening inside a stable trend regime or a stress regime that punishes loose risk and late entries.",
    details: [
      "Regime shifts change how far momentum can realistically travel.",
      "Rising volatility reframes position sizing and exit speed before price structure breaks.",
    ],
  },
  {
    symbol: "HYG vs TLT",
    title: "Credit Spreads",
    description:
      "Measures whether capital is leaning toward corporate risk or defensive duration before index price fully reflects that internal rotation.",
    details: [
      "Credit strength confirms healthier risk appetite under the surface.",
      "Defensive bond demand often shows up before equity traders fully price the shift.",
    ],
  },
  {
    symbol: "SPY RSI / SMA",
    title: "Trend",
    description:
      "Combines momentum and structure so you can tell whether the benchmark is aligned with the broader macro message or fighting it.",
    details: [
      "Momentum without structure is noise.",
      "Trend confirmation keeps you from forcing conviction into a mixed tape.",
    ],
  },
] as const;

const consoleNotes = [
  {
    label: "Redirect",
    value: "Route preserved",
    detail:
      "Authentication returns you to the protected destination you originally requested.",
  },
  {
    label: "Delivery",
    value: "Browser auth",
    detail:
      "Supabase handles sign-in, sign-up, session restore, and callback routing safely in the browser.",
  },
] as const;

function sanitizeRedirectPath(rawRedirectPath: string | null): string {
  if (
    !rawRedirectPath ||
    !rawRedirectPath.startsWith("/") ||
    rawRedirectPath.startsWith("//")
  ) {
    return "/dashboard";
  }

  return rawRedirectPath;
}

function getSubmitLabel(
  mode: AuthMode,
  isSubmitting: boolean,
  isRedirecting: boolean,
) {
  if (isRedirecting) {
    return "Routing you in";
  }

  if (isSubmitting) {
    return mode === "signin" ? "Signing in" : "Creating account";
  }

  return mode === "signin" ? "Sign in to Dashboard" : "Create your account";
}

export default function HomePage() {
  const browserClientConfigError = getSupabaseBrowserClientConfigError();
  const missingPublicEnvVars = getMissingSupabasePublicEnvVars();
  const [supabase] = useState(() =>
    browserClientConfigError ? null : createSupabaseBrowserClient(),
  );
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
    if (!supabase) {
      return;
    }

    const urlSearchParams = new URLSearchParams(window.location.search);
    const resolvedRedirectPath = sanitizeRedirectPath(
      urlSearchParams.get("redirectTo"),
    );
    const callbackError = urlSearchParams.get("authError");

    setRedirectPath(resolvedRedirectPath);

    if (callbackError) {
      setErrorMessage(callbackError);
    }

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

  function switchAuthMode(mode: AuthMode) {
    setAuthMode(mode);
    setErrorMessage(null);
    setStatusMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setErrorMessage(
        browserClientConfigError ??
          "Supabase browser authentication is not configured for this deployment.",
      );
      return;
    }

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

      const emailRedirectUrl = new URL("/auth/callback", window.location.origin);
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
        "Account created. Check your email to verify your account, and the confirmation link will sign you in and send you straight to the dashboard.",
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Authentication failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main
      className={`${headingFont.variable} ${dataFont.variable} min-h-screen bg-zinc-950 font-sans text-zinc-100`}
    >
      <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-10">
        <header className="flex h-16 items-center justify-between border-b border-white/10">
          <a
            className="font-[family:var(--font-heading)] text-sm font-semibold tracking-[0.18em] text-white uppercase"
            href="#top"
          >
            Macro Bias
          </a>
          <a
            className="inline-flex items-center rounded-md px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.04] hover:text-white"
            href="#auth-console"
          >
            Sign In
          </a>
        </header>

        <section
          id="top"
          className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center py-24 text-center"
        >
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Live Macro Regime Engine ]
          </p>
          <h1 className="mt-8 max-w-5xl text-balance font-[family:var(--font-heading)] text-5xl font-bold tracking-tighter text-white md:text-7xl xl:text-[5.75rem]">
            Trade with the weather. Not against it.
          </h1>
          <p className="mt-6 max-w-3xl text-balance text-lg leading-8 text-zinc-300 md:text-xl">
            Macro Bias gives day traders an institutional-grade regime read before the
            open, so you stop forcing trades into the wrong volatility, credit, and trend
            backdrop.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              className="inline-flex min-w-[220px] items-center justify-center rounded-md bg-white px-6 py-3.5 text-sm font-semibold text-black transition hover:bg-zinc-200"
              href="#auth-console"
            >
              Access the Dashboard
            </a>
            <a
              className="inline-flex min-w-[220px] items-center justify-center rounded-md bg-white/[0.03] px-6 py-3.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.06] hover:text-white"
              href="#the-edge"
            >
              View the Model
            </a>
          </div>

          <div className="mt-16 grid w-full max-w-5xl gap-8 border-y border-white/10 py-6 sm:grid-cols-3">
            {heroStats.map((stat) => (
              <div key={stat.label} className="text-left sm:text-center">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  {stat.label}
                </p>
                <p className="mt-3 text-base font-medium text-white md:text-lg">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="the-edge" className="py-24">
          <div className="max-w-3xl">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              The Edge
            </p>
            <h2 className="mt-5 max-w-4xl font-[family:var(--font-heading)] text-4xl font-semibold tracking-tighter text-white md:text-5xl">
              Three market inputs. One cleaner decision framework.
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-300">
              The engine compresses the macro picture into the signals that matter most for
              intraday decision-making: stress, sponsorship, and structural trend.
            </p>
          </div>

          <div className="mt-16 grid gap-14 lg:grid-cols-3 lg:gap-10">
            {quantPillars.map((pillar) => (
              <article key={pillar.title} className="border-t border-white/10 pt-6">
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-emerald-300/70">
                  {pillar.symbol}
                </p>
                <h3 className="mt-5 font-[family:var(--font-heading)] text-2xl font-semibold tracking-tight text-white">
                  {pillar.title}
                </h3>
                <p className="mt-4 text-base leading-7 text-zinc-300">
                  {pillar.description}
                </p>
                <div className="mt-6 space-y-4">
                  {pillar.details.map((detail) => (
                    <p key={detail} className="text-sm leading-7 text-zinc-400">
                      {detail}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="auth-console" className="border-t border-white/10 py-24">
          <div className="grid gap-16 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
            <div className="max-w-3xl">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                Access Console
              </p>
              <h2 className="mt-5 max-w-4xl font-[family:var(--font-heading)] text-4xl font-semibold tracking-tighter text-white md:text-5xl">
                Enter the live macro regime dashboard.
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-300">
                Authenticate below to access the protected Macro Bias workspace. The route
                you originally requested stays intact through sign-in, sign-up, and email
                confirmation.
              </p>

              <div className="mt-12 grid gap-10 sm:grid-cols-2">
                {consoleNotes.map((note) => (
                  <div key={note.label} className="border-t border-white/10 pt-4">
                    <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                      {note.label}
                    </p>
                    <p className="mt-3 text-lg font-medium text-white">{note.value}</p>
                    <p className="mt-3 text-sm leading-7 text-zinc-400">{note.detail}</p>
                  </div>
                ))}
                <div className="border-t border-white/10 pt-4 sm:col-span-2 lg:col-span-1">
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                    Active destination
                  </p>
                  <p className="mt-3 font-[family:var(--font-data)] text-sm text-white">
                    {redirectPath}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    Successful authentication routes you back to this protected path without
                    dropping context.
                  </p>
                </div>
              </div>
            </div>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 sm:p-10">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
                    Sign In / Create Account
                  </p>
                  <h3 className="mt-4 font-[family:var(--font-heading)] text-2xl font-semibold tracking-tight text-white">
                    Secure access
                  </h3>
                </div>
                <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-emerald-300/70">
                  Live auth
                </p>
              </div>

              <div className="mt-8 flex gap-6 border-b border-white/10">
                <button
                  className={`relative pb-4 text-sm font-medium transition ${
                    authMode === "signin"
                      ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                  onClick={() => switchAuthMode("signin")}
                  type="button"
                >
                  Sign in
                </button>
                <button
                  className={`relative pb-4 text-sm font-medium transition ${
                    authMode === "signup"
                      ? "text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                  onClick={() => switchAuthMode("signup")}
                  type="button"
                >
                  Create account
                </button>
              </div>

              <p className="mt-6 text-sm leading-7 text-zinc-400">
                {authMode === "signin"
                  ? "Restore your session and continue directly into the protected Macro Bias dashboard."
                  : "Create your account and preserve the same redirect target through the full auth flow."}
              </p>

              {browserClientConfigError ? (
                <div className="mt-8 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm leading-6 text-amber-100">
                  <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-amber-200/80">
                    Deployment configuration error
                  </p>
                  <p className="mt-3">{browserClientConfigError}</p>
                  <div className="mt-4 space-y-1 font-[family:var(--font-data)] text-[11px] text-amber-100/90">
                    {missingPublicEnvVars.map((name) => (
                      <p key={name}>{name}</p>
                    ))}
                  </div>
                </div>
              ) : null}

              <form className="mt-8 space-y-7" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <label
                    className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500"
                    htmlFor="email"
                  >
                    Email
                  </label>
                  <div className="border-b border-white/10 transition-colors focus-within:border-white/40">
                    <input
                      autoComplete="email"
                      className="w-full bg-transparent px-0 py-3 text-base text-white outline-none placeholder:text-zinc-600"
                      id="email"
                      onChange={(event) => updateField("email", event.target.value)}
                      placeholder="you@macro-bias.com"
                      required
                      type="email"
                      value={credentials.email}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500"
                    htmlFor="password"
                  >
                    Password
                  </label>
                  <div className="border-b border-white/10 transition-colors focus-within:border-white/40">
                    <input
                      autoComplete={
                        authMode === "signin" ? "current-password" : "new-password"
                      }
                      className="w-full bg-transparent px-0 py-3 text-base text-white outline-none placeholder:text-zinc-600"
                      id="password"
                      minLength={8}
                      onChange={(event) => updateField("password", event.target.value)}
                      placeholder="Minimum 8 characters"
                      required
                      type="password"
                      value={credentials.password}
                    />
                  </div>
                </div>

                <div className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.36em] text-zinc-500">
                  Redirect after auth
                  <p className="mt-3 text-[11px] normal-case tracking-normal text-zinc-300">
                    {redirectPath}
                  </p>
                </div>

                {statusMessage ? (
                  <div
                    className="rounded-xl bg-emerald-500/[0.08] px-4 py-3 text-sm leading-6 text-emerald-50"
                    role="status"
                  >
                    {statusMessage}
                  </div>
                ) : null}

                {errorMessage ? (
                  <div
                    className="rounded-xl bg-rose-500/[0.08] px-4 py-3 text-sm leading-6 text-rose-100"
                    role="alert"
                  >
                    {errorMessage}
                  </div>
                ) : null}

                <button
                  className="inline-flex w-full items-center justify-center rounded-md bg-white px-5 py-3.5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-500"
                  disabled={isSubmitting || isRedirecting || !supabase}
                  type="submit"
                >
                  {getSubmitLabel(authMode, isSubmitting, isRedirecting)}
                </button>
              </form>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
