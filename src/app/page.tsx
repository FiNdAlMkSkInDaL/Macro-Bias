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

const landingStats = [
  {
    label: "Dominant regime",
    value: "Know the tape",
    detail:
      "Stop fading the market when cross-asset risk is already leaning the other way.",
  },
  {
    label: "Refresh cadence",
    value: "Daily before the open",
    detail:
      "Start every session with a clean macro read instead of reacting headline by headline.",
  },
  {
    label: "Pricing",
    value: "$25 / month",
    detail:
      "Institutional-style context built for self-directed day traders, not fund desks.",
  },
] as const;

const quantPillars = [
  {
    eyebrow: "Volatility",
    title: "VIX Regimes",
    description:
      "Tracks when volatility is compressing, expanding, or breaking out so your intraday bias matches the market's stress state.",
    points: [
      "Identify when trend-following setups have room to work.",
      "Recognize when a rising fear regime demands tighter risk and faster exits.",
    ],
  },
  {
    eyebrow: "Credit Spreads",
    title: "HYG vs TLT",
    description:
      "Measures whether capital is rotating toward corporate risk or defensive duration before equity price action fully confirms it.",
    points: [
      "Spot risk-on participation beneath the surface of index price.",
      "Catch defensive rotation before broad momentum breaks down.",
    ],
  },
  {
    eyebrow: "Momentum & Trend",
    title: "SPY RSI & SMA",
    description:
      "Blends momentum and trend confirmation to tell you whether the benchmark is aligned with the broader macro message.",
    points: [
      "Separate healthy continuation from exhausted squeeze behavior.",
      "Avoid forcing longs or shorts when trend structure is not confirmed.",
    ],
  },
] as const;

const dashboardPreview = [
  {
    label: "Macro bias",
    value: "Daily regime score",
    detail:
      "A single read on whether the session favors risk-on, neutral, or risk-off behavior.",
  },
  {
    label: "Cross-asset map",
    value: "ETFs that confirm",
    detail:
      "SPY, QQQ, XLP, TLT, and GLD show whether the move is broad or fragile.",
  },
  {
    label: "Execution context",
    value: "Trade with alignment",
    detail:
      "Use the regime to filter impulsive entries that fight the dominant market weather.",
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
        "Account created. Check your email to confirm access, then you will be returned to your dashboard automatically.",
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
      className={`${headingFont.variable} ${dataFont.variable} min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.12),_transparent_24%),radial-gradient(circle_at_85%_15%,_rgba(148,163,184,0.1),_transparent_18%),linear-gradient(180deg,_#020617_0%,_#0f172a_55%,_#020617_100%)] px-4 py-10 font-sans font-[family:var(--font-heading)] text-slate-100 sm:px-6 lg:px-8`}
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="relative overflow-hidden rounded-[36px] border border-slate-800/80 bg-slate-950/75 p-6 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur-sm sm:p-8 lg:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(56,189,248,0.16),transparent_28%),radial-gradient(circle_at_84%_20%,rgba(34,197,94,0.16),transparent_24%),linear-gradient(135deg,rgba(15,23,42,0.2),rgba(2,6,23,0))]" />

          <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)] xl:items-start">
            <div className="max-w-3xl">
              <span className="inline-flex items-center rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 font-mono font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.32em] text-sky-200">
                Macro Bias for Active Traders
              </span>

              <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight text-white sm:text-5xl xl:text-6xl">
                Institutional Macro Intelligence for Day Traders
              </h1>

              <p className="mt-5 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">
                Stop trading against the dominant market regime. Macro Bias translates
                volatility, credit, and trend structure into a daily institutional-style
                read so you know when the tape wants risk and when it wants defense.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
                  href="#access-console"
                >
                  Start Your Edge
                </a>
                <a
                  className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 px-6 py-3.5 text-sm font-semibold text-slate-100 transition hover:border-slate-500 hover:bg-slate-900"
                  href="#quant-edge"
                >
                  Explore The Model
                </a>
              </div>

              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {landingStats.map((stat) => (
                  <article
                    key={stat.label}
                    className="rounded-[24px] border border-slate-800/80 bg-slate-900/60 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">
                      {stat.label}
                    </p>
                    <p className="mt-4 text-2xl font-semibold text-white">{stat.value}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">
                      {stat.detail}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <aside className="rounded-[30px] border border-slate-800/80 bg-slate-950/85 p-6 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-sm sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
                    Today&apos;s edge
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">
                    Trade with the weather, not against it
                  </h2>
                </div>
                <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.28em] text-emerald-200">
                  Built for the open
                </span>
              </div>

              <div className="mt-7 space-y-3">
                {dashboardPreview.map((item) => (
                  <article
                    key={item.label}
                    className="rounded-[22px] border border-slate-800 bg-slate-900/70 p-4"
                  >
                    <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">
                      {item.label}
                    </p>
                    <p className="mt-3 text-lg font-semibold text-white">{item.value}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.detail}</p>
                  </article>
                ))}
              </div>

              <div className="mt-6 rounded-[24px] border border-sky-400/20 bg-sky-400/10 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-sky-200/75">
                  Why it matters
                </p>
                <p className="mt-3 text-sm leading-6 text-sky-50/90">
                  Most retail traders lose not because they cannot find setups, but because
                  they press those setups into the wrong macro backdrop. Macro Bias gives
                  you the filter first.
                </p>
              </div>
            </aside>
          </div>
        </section>

        <section
          id="quant-edge"
          className="rounded-[32px] border border-slate-800/80 bg-slate-950/80 p-6 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur-sm sm:p-8"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
                The Quant Edge
              </p>
              <h2 className="mt-4 text-3xl font-semibold leading-tight text-white sm:text-4xl">
                Three institutional pillars. One actionable market regime.
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              The model does not guess. It measures whether volatility, credit, and price
              structure are aligned so you can press trades when the evidence is stacked
              and step back when it is not.
            </p>
          </div>

          <div className="mt-8 grid gap-4 xl:grid-cols-3">
            {quantPillars.map((pillar) => (
              <article
                key={pillar.title}
                className="group rounded-[28px] border border-slate-800 bg-slate-900/70 p-6 transition-colors hover:border-slate-700"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-sky-200/80">
                  {pillar.eyebrow}
                </p>
                <h3 className="mt-4 text-2xl font-semibold text-white">{pillar.title}</h3>
                <p className="mt-4 text-sm leading-7 text-slate-300">
                  {pillar.description}
                </p>
                <div className="mt-6 space-y-3 border-t border-slate-800 pt-5">
                  {pillar.points.map((point) => (
                    <div key={point} className="flex gap-3">
                      <span className="mt-2 h-2 w-2 rounded-full bg-sky-300" />
                      <p className="text-sm leading-6 text-slate-400">{point}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          id="access-console"
          className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.82fr)] xl:items-start"
        >
          <div className="rounded-[32px] border border-slate-800/80 bg-slate-950/80 p-6 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur-sm sm:p-8">
            <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 font-mono font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.32em] text-emerald-200">
              Primary CTA
            </span>
            <h2 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Get the macro edge before the opening bell.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-slate-300">
              Create your account or sign back in to access the live Macro Bias dashboard.
              Your redirect path is preserved, so once authentication completes you land
              directly where you intended to go.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <article className="rounded-[24px] border border-slate-800 bg-slate-900/70 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">
                  Destination
                </p>
                <p className="mt-4 font-mono text-lg text-white">{redirectPath}</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  Successful authentication returns you directly to the protected
                  experience you requested.
                </p>
              </article>

              <article className="rounded-[24px] border border-sky-400/25 bg-sky-400/10 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-sky-200/75">
                  Included
                </p>
                <p className="mt-4 text-2xl font-semibold text-white">
                  Daily regime dashboard
                </p>
                <p className="mt-3 text-sm leading-6 text-sky-50/85">
                  Secure access to the live bias read, cross-asset confirmation, and
                  protected member workflow.
                </p>
              </article>

              <article className="rounded-[24px] border border-emerald-500/25 bg-emerald-500/10 p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-emerald-200/75">
                  Positioning
                </p>
                <p className="mt-4 text-2xl font-semibold text-white">
                  Trade with alignment
                </p>
                <p className="mt-3 text-sm leading-6 text-emerald-50/85">
                  Use the macro regime as a daily filter so your intraday setups work with
                  the broader tape instead of against it.
                </p>
              </article>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <article className="rounded-[28px] border border-slate-800/80 bg-slate-950/80 p-6 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-sm">
                <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
                  What you unlock
                </p>
                <div className="mt-5 space-y-4 text-sm leading-7 text-slate-300">
                  <p>Protected dashboard access behind Supabase session validation.</p>
                  <p>
                    Daily macro context that frames whether to lean risk-on, neutral, or
                    risk-off.
                  </p>
                  <p>
                    A clean member entry point that respects redirect flow after sign-in or
                    email confirmation.
                  </p>
                </div>
              </article>

              <article className="rounded-[28px] border border-slate-800/80 bg-slate-950/80 p-6 shadow-[0_24px_60px_rgba(2,6,23,0.45)] backdrop-blur-sm">
                <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
                  Access flow
                </p>
                <div className="mt-5 rounded-[22px] border border-slate-800 bg-slate-900/70 p-4 font-mono text-xs leading-6 text-slate-300">
                  <p>1. You request a protected route</p>
                  <p className="mt-2">2. Macro Bias preserves redirectTo={redirectPath}</p>
                  <p className="mt-2">3. Supabase authenticates the session</p>
                  <p className="mt-2">4. Routing sends you directly back into the dashboard</p>
                </div>
              </article>
            </div>
          </div>

          <section className="rounded-[32px] border border-slate-800/80 bg-slate-950/88 p-6 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur-sm sm:p-8">
            <div className="flex flex-col gap-6 sm:gap-7">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-sm">
                  <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-slate-400">
                    Access Console
                  </p>
                  <h2 className="mt-4 text-[1.95rem] font-semibold leading-tight text-white sm:text-[2.15rem]">
                    Start with secure access
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    {authMode === "signin"
                      ? "Sign in to restore your session and get back to the live macro dashboard."
                      : "Create your account to start using the institutional-style daily regime read."}
                  </p>
                </div>

                <div className="w-full sm:max-w-[340px]">
                  <div className="grid w-full grid-cols-2 rounded-2xl border border-slate-700/90 bg-slate-900/90 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <button
                      className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
                        authMode === "signin"
                          ? "bg-slate-50 text-slate-950 shadow-[0_10px_30px_rgba(255,255,255,0.08)]"
                          : "text-slate-400 hover:text-slate-100"
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
                      className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
                        authMode === "signup"
                          ? "bg-slate-50 text-slate-950 shadow-[0_10px_30px_rgba(255,255,255,0.08)]"
                          : "text-slate-400 hover:text-slate-100"
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
              </div>

              <div className="rounded-[24px] border border-slate-800/80 bg-slate-900/55 px-4 py-3.5 text-sm leading-6 text-slate-300">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">
                  Access note
                </p>
                <p className="mt-2 text-slate-300">
                  {authMode === "signin"
                    ? "Use your existing credentials to continue directly into the protected Macro Bias experience."
                    : "New accounts respect the same redirect target, including email-confirmation-safe routing when enabled."}
                </p>
              </div>
            </div>

            {browserClientConfigError ? (
              <div className="mt-6 rounded-[24px] border border-amber-400/25 bg-amber-400/10 p-5 text-sm leading-6 text-amber-50">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-amber-200/75">
                  Deployment configuration error
                </p>
                <p className="mt-3">{browserClientConfigError}</p>
                <p className="mt-3 text-amber-100/85">
                  Add these variables in Vercel for the Production environment, redeploy,
                  and make sure Supabase redirect URLs include this domain.
                </p>
                <div className="mt-4 rounded-[18px] border border-amber-300/15 bg-slate-950/40 p-4 font-mono text-xs text-amber-50/90">
                  {missingPublicEnvVars.map((name) => (
                    <p key={name}>{name}</p>
                  ))}
                </div>
              </div>
            ) : null}

            <form className="mt-9 space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-3">
                <label
                  className="block font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-300/90"
                  htmlFor="email"
                >
                  Email
                </label>
                <input
                  autoComplete="email"
                  className="w-full rounded-[20px] border border-slate-600/90 bg-slate-900/85 px-4 py-3.5 text-base text-white outline-none transition duration-200 placeholder:text-slate-500 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/50"
                  id="email"
                  onChange={(event) => updateField("email", event.target.value)}
                  placeholder="you@macro-bias.com"
                  required
                  type="email"
                  value={credentials.email}
                />
              </div>

              <div className="space-y-3">
                <label
                  className="block font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-300/90"
                  htmlFor="password"
                >
                  Password
                </label>
                <input
                  autoComplete={
                    authMode === "signin" ? "current-password" : "new-password"
                  }
                  className="w-full rounded-[20px] border border-slate-600/90 bg-slate-900/85 px-4 py-3.5 text-base text-white outline-none transition duration-200 placeholder:text-slate-500 focus:border-sky-400/70 focus:ring-2 focus:ring-sky-500/50"
                  id="password"
                  minLength={8}
                  onChange={(event) => updateField("password", event.target.value)}
                  placeholder="Minimum 8 characters"
                  required
                  type="password"
                  value={credentials.password}
                />
              </div>

              <div className="rounded-[24px] border border-slate-800 bg-slate-900/70 p-5 text-sm leading-6 text-slate-300">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">
                  Redirect after auth
                </p>
                <p className="mt-3 font-mono text-slate-100">{redirectPath}</p>
                <p className="mt-3 text-slate-400">
                  {authMode === "signin"
                    ? "Successful sign-in routes immediately to the protected dashboard."
                    : "If email confirmation is enabled, the confirmation link returns here first and then forwards you into the dashboard."}
                </p>
              </div>

              {statusMessage ? (
                <div
                  className="rounded-[20px] border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-50"
                  role="status"
                >
                  {statusMessage}
                </div>
              ) : null}

              {errorMessage ? (
                <div
                  className="rounded-[20px] border border-rose-500/25 bg-rose-500/10 p-4 text-sm leading-6 text-rose-100"
                  role="alert"
                >
                  {errorMessage}
                </div>
              ) : null}

              <button
                className="inline-flex w-full items-center justify-center rounded-full bg-white px-5 py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={isSubmitting || isRedirecting || !supabase}
                type="submit"
              >
                {getSubmitLabel(authMode, isSubmitting, isRedirecting)}
              </button>
            </form>
          </section>
        </section>
      </div>
    </main>
  );
}
