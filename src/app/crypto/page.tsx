"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";

import { trackClientEvent } from "@/lib/analytics/client";
import { useReferralCode } from "@/lib/referral/client";

type SubmissionState = "idle" | "loading" | "success" | "error";

export default function CryptoLandingPage() {
  const [email, setEmail] = useState("");
  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const refCode = useReferralCode();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionState === "loading") return;

    setSubmissionState("loading");
    setStatusMessage("Adding...");

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          pagePath: window.location.pathname,
          stocksOptedIn: false,
          cryptoOptedIn: true,
          ref: refCode,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to add email.");
      }

      setSubmissionState("success");
      setStatusMessage("You are on the list. First crypto briefing arrives tomorrow morning.");
      trackClientEvent({
        eventName: "email_signup_success",
        metadata: { location: "crypto_landing", crypto: "true", stocks: "false" },
      });
      setEmail("");
    } catch (error) {
      setSubmissionState("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to add email.",
      );
    }
  }

  const isLoading = submissionState === "loading";
  const statusColor =
    submissionState === "error" ? "text-red-400" : "text-emerald-400";

  return (
    <main className="min-h-screen text-white">
      <div className="mx-auto max-w-5xl px-6 py-20 sm:px-8">
        {/* Hero */}
        <section className="text-center">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-sky-400/70">
            [ Crypto Regime Engine ]
          </p>
          <h1 className="mt-6 text-balance font-[family:var(--font-heading)] text-4xl font-bold tracking-tighter text-white sm:text-5xl md:text-6xl">
            +41,576% long-only vs +941% BTC.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg leading-8 text-zinc-300">
            The same regime-scoring discipline that works for stocks, tuned for
            crypto volatility. One daily read. 90 seconds. Before the US session
            opens.
          </p>
        </section>

        {/* Email signup */}
        <section className="mx-auto mt-12 max-w-xl text-center">
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={handleSubmit}
          >
            <label className="sr-only" htmlFor="crypto-email">
              Email address
            </label>
            <input
              id="crypto-email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 flex-1 border border-zinc-800 bg-zinc-950 px-4 text-white outline-none placeholder:text-zinc-600 focus:border-sky-500/50"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="h-12 border border-sky-400/50 bg-sky-500/10 px-5 text-sm font-medium text-sky-300 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Adding..." : "Get the crypto briefing"}
            </button>
          </form>
          <p
            className={`mt-3 text-center text-sm ${statusColor}`}
            aria-live="polite"
          >
            {statusMessage ?? "\u00A0"}
          </p>
          <p className="mt-1 text-center text-xs text-zinc-500">
            Already subscribed? Invite 3 traders and unlock 7 days of Premium {"->"}{" "}
            <a
              href="/refer"
              className="text-sky-400 underline"
              data-analytics-event="referral_cta_click"
              data-analytics-label="Crypto Page Referral Teaser"
              data-analytics-location="crypto_page"
            >
              See referral rewards
            </a>
          </p>
          {submissionState === "success" && (
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-center">
              <p className="text-sm text-zinc-400">Know other crypto traders who would use this?</p>
              <p className="mt-1 text-xs text-zinc-500">
                Invite 3 traders, unlock 7 days of Premium {"->"}{" "}
                <a
                  href="/refer"
                  className="text-sky-400 underline"
                  data-analytics-event="referral_cta_click"
                  data-analytics-label="Crypto Signup Success"
                  data-analytics-location="crypto_page"
                >
                  See referral program
                </a>
              </p>
            </div>
          )}
          <p className="mt-1 text-xs text-zinc-600">
            Free daily email. No account required. Unsubscribe anytime.
          </p>
        </section>

        {/* Track record stats */}
        <section className="mx-auto mt-16 grid max-w-3xl gap-6 sm:grid-cols-3">
          <div className="border border-zinc-800 bg-zinc-950/60 p-6 text-center">
            <p className="font-[family:var(--font-data)] text-3xl font-bold text-white">
              +41,576%
            </p>
            <p className="mt-2 text-xs uppercase tracking-widest text-zinc-500">
              Long-only strategy
            </p>
          </div>
          <div className="border border-zinc-800 bg-zinc-950/60 p-6 text-center">
            <p className="font-[family:var(--font-data)] text-3xl font-bold text-zinc-400">
              +941%
            </p>
            <p className="mt-2 text-xs uppercase tracking-widest text-zinc-500">
              BTC buy-and-hold
            </p>
          </div>
          <div className="border border-zinc-800 bg-zinc-950/60 p-6 text-center">
            <p className="font-[family:var(--font-data)] text-3xl font-bold text-sky-400">
              2,297
            </p>
            <p className="mt-2 text-xs uppercase tracking-widest text-zinc-500">
              Days backtested
            </p>
          </div>
        </section>

        {/* How it works */}
        <section className="mt-20">
          <h2 className="text-center text-sm uppercase tracking-[0.3em] text-zinc-500">
            What you get every morning
          </h2>
          <div className="mx-auto mt-8 grid max-w-3xl gap-8 sm:grid-cols-2">
            <div className="border-t border-sky-400/20 pt-5">
              <p className="font-[family:var(--font-data)] text-[10px] font-bold uppercase tracking-[0.3em] text-sky-400/70">
                Bottom Line
              </p>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                What BTC and the broader crypto market are doing today, in plain
                English, before you open a single chart.
              </p>
            </div>
            <div className="border-t border-violet-400/20 pt-5">
              <p className="font-[family:var(--font-data)] text-[10px] font-bold uppercase tracking-[0.3em] text-violet-400/70">
                Market Breakdown
              </p>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                Bitcoin, Altcoins, DeFi/L1s, and Stablecoin flows — each rated
                Strong, Neutral, or Under Pressure.
              </p>
            </div>
            <div className="border-t border-orange-400/20 pt-5">
              <p className="font-[family:var(--font-data)] text-[10px] font-bold uppercase tracking-[0.3em] text-orange-400/70">
                Risk Check
              </p>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                Exchange risk, regulatory news, whale movements, funding
                rates — anything that changes the picture the model is painting.
              </p>
            </div>
            <div className="border-t border-emerald-400/20 pt-5">
              <p className="font-[family:var(--font-data)] text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-400/70">
                Model Notes
              </p>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                Closest historical analog, BTC realized vol, ETH/BTC ratio,
                and what the pattern suggests for the next session.
              </p>
            </div>
          </div>
        </section>

        {/* Sample briefing */}
        <section className="mt-20">
          <h2 className="text-center text-sm uppercase tracking-[0.3em] text-zinc-500">
            Sample briefing
          </h2>
          <div className="mx-auto mt-6 max-w-lg border border-zinc-800 bg-zinc-950/80 p-6">
            <div className="flex items-baseline justify-between">
              <p className="text-xs uppercase tracking-widest text-zinc-500">
                Crypto Regime Briefing
              </p>
              <p className="text-xs font-medium text-emerald-500">
                RISK ON (+38)
              </p>
            </div>
            <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-zinc-300">
              <p className="text-xs font-medium uppercase tracking-widest text-sky-400/80">
                Bottom Line
              </p>
              <p>
                <strong className="text-white">BTC</strong> reclaimed the
                200-day moving average with volume confirmation. Funding rates
                are positive but not overheated. The regime favors continuation.
              </p>
              <p className="mt-4 text-xs font-medium uppercase tracking-widest text-violet-400/80">
                Market Breakdown
              </p>
              <p>
                <strong className="text-white">Bitcoin:</strong> Strong —
                breaking above key resistance with spot-led demand.
              </p>
              <p>
                <strong className="text-white">Altcoins:</strong> Neutral —
                ETH/BTC ratio holding but not leading.
              </p>
              <p className="text-zinc-600">
                DeFi/L1s + risk check + model notes in the full briefing...
              </p>
            </div>
            <div className="mt-5 border-t border-zinc-800 pt-4">
              <p className="text-center text-xs text-zinc-500">
                Delivered to your inbox at 9:00 AM ET, every day.
              </p>
            </div>
          </div>
        </section>

        {/* Why crypto needs a model */}
        <section className="mt-20">
          <h2 className="text-center text-sm uppercase tracking-[0.3em] text-zinc-500">
            Why crypto traders need this
          </h2>
          <div className="mx-auto mt-8 max-w-2xl space-y-6 text-[15px] leading-relaxed text-zinc-300">
            <p>
              Crypto volatility is 3-4x equities. The market never closes. The
              information environment is a firehose of unverified rumors. Every
              mistake is amplified.
            </p>
            <p>
              The regime model tracks BTC realized volatility, ETH/BTC ratio,
              DXY correlation, and funding rates. It compresses those inputs into
              a single daily score and compares today to over 2,000 historical
              sessions.
            </p>
            <p>
              The edge is not better entries. It is knowing which days to show up
              and which days to sit out. That single decision is the difference
              between +41,576% and +941%.
            </p>
          </div>
        </section>

        {/* Navigation links */}
        <section className="mt-20 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/crypto/dashboard"
            className="border border-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white"
          >
            Live Dashboard
          </Link>
          <Link
            href="/crypto/track-record"
            className="border border-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white"
          >
            Full Track Record
          </Link>
          <Link
            href="/crypto/briefings"
            className="border border-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white"
          >
            Briefing Archive
          </Link>
          <Link
            href="/pricing"
            className="border border-sky-400/30 bg-sky-500/10 px-5 py-2.5 text-sm font-medium text-sky-300 transition hover:bg-sky-500/20"
          >
            See Pricing
          </Link>
        </section>

        {/* Bottom CTA */}
        <section className="mt-20 text-center">
          <p className="text-sm text-zinc-500">
            No spam. No coin picks. Just data. Unsubscribe anytime.
          </p>
        </section>
      </div>
    </main>
  );
}

