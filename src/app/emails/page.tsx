"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import { trackClientEvent } from "@/lib/analytics/client";
import { useReferralCode } from "@/lib/referral/client";

type SubmissionState = "idle" | "loading" | "success" | "error";

export default function EmailsPage() {
  const [email, setEmail] = useState("");
  const [stocksOptedIn, setStocksOptedIn] = useState(true);
  const [cryptoOptedIn, setCryptoOptedIn] = useState(true);
  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const refCode = useReferralCode();

  const neitherSelected = !stocksOptedIn && !cryptoOptedIn;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submissionState === "loading" || neitherSelected) {
      return;
    }

    setSubmissionState("loading");
    setStatusMessage("Adding...");

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          pagePath: window.location.pathname,
          stocksOptedIn,
          cryptoOptedIn,
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
      setStatusMessage("You are on the list. Check your inbox.");
      trackClientEvent({
        eventName: "email_signup_success",
        metadata: {
          location: "emails_page",
          stocks: stocksOptedIn ? "true" : "false",
          crypto: cryptoOptedIn ? "true" : "false",
        },
      });
      setEmail("");
    } catch (error) {
      setSubmissionState("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to add email.",
      );
      trackClientEvent({
        eventName: "email_signup_failure",
        metadata: {
          location: "emails_page",
          message: error instanceof Error ? error.message : "Unable to add email.",
        },
      });
    }
  }

  const isLoading = submissionState === "loading";
  const statusColor = submissionState === "error" ? "text-red-400" : "text-emerald-400";

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-20 text-white">
      <div className="w-full max-w-2xl">
        {/* Headline */}
        <h1 className="text-balance text-center text-4xl font-semibold tracking-tight sm:text-5xl">
          Know what the market is doing before you trade.
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-center text-lg text-zinc-400">
          Free daily email. 90 seconds. Before the bell.
        </p>

        {/* Form */}
        <form className="mx-auto mt-8 flex max-w-xl flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-12 flex-1 border border-zinc-800 bg-zinc-950 px-4 text-white outline-none placeholder:text-zinc-600 focus:border-zinc-600"
          />
          <button
            type="submit"
            disabled={isLoading || neitherSelected}
            className="h-12 border border-white px-5 text-sm font-medium text-white transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Adding..." : "Get the daily briefing"}
          </button>
        </form>

        {/* Newsletter preference checkboxes */}
        <div className="mx-auto mt-4 flex max-w-xl items-center justify-center gap-6">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={stocksOptedIn}
              onChange={(e) => setStocksOptedIn(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-white accent-white"
            />
            Stocks
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={cryptoOptedIn}
              onChange={(e) => setCryptoOptedIn(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-white accent-white"
            />
            Crypto
          </label>
        </div>
        {neitherSelected && (
          <p className="mt-2 text-center text-xs text-red-400">Select at least one newsletter.</p>
        )}

        <p className={`mt-3 text-center text-sm ${statusColor}`} aria-live="polite">
          {statusMessage ?? "\u00A0"}
        </p>
        <p className="mt-1 text-center text-xs text-zinc-500">
          Already subscribed? Invite 3 traders and unlock 7 days of Premium {"->"}{" "}
          <a
            href="/refer"
            className="text-sky-400 underline"
            data-analytics-event="referral_cta_click"
            data-analytics-label="Emails Page Referral Teaser"
            data-analytics-location="emails_page"
          >
            See referral rewards
          </a>
        </p>

        {submissionState === "success" && (
          <div className="mx-auto mt-6 max-w-xl rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center">
            <p className="text-sm text-zinc-400">Know someone who'd find this useful?</p>
            <p className="mt-1 text-xs text-zinc-500">
              Invite 3 traders, unlock 7 days of Premium {"->"}{" "}
              <a
                href="/refer"
                className="text-sky-400 underline"
                data-analytics-event="referral_cta_click"
                data-analytics-label="Emails Signup Success"
                data-analytics-location="emails_page"
              >
                See referral program
              </a>
            </p>
          </div>
        )}

        {/* Track Record Stats */}
        <div className="mx-auto mt-12 grid max-w-lg gap-4 sm:grid-cols-2">
          {/* Stocks stat */}
          <div className="flex items-center justify-between gap-4 border border-zinc-800 bg-zinc-950/60 px-6 py-5">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-2xl font-semibold text-white">+295%</p>
                <p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Macro Bias</p>
              </div>
              <div className="text-center text-zinc-600">vs</div>
              <div className="text-center">
                <p className="text-2xl font-semibold text-zinc-400">+116%</p>
                <p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">S&amp;P 500</p>
              </div>
            </div>
            <a href="/track-record" className="text-xs text-zinc-500 underline hover:text-zinc-300">
              Stocks
            </a>
          </div>
          {/* Crypto stat */}
          <div className="flex items-center justify-between gap-4 border border-zinc-800 bg-zinc-950/60 px-6 py-5">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-xl font-semibold text-white">+41,576%</p>
                <p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Long Only</p>
              </div>
              <div className="text-center text-zinc-600">vs</div>
              <div className="text-center">
                <p className="text-xl font-semibold text-zinc-400">+941%</p>
                <p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">BTC</p>
              </div>
            </div>
            <a href="/crypto/track-record" className="text-xs text-zinc-500 underline hover:text-zinc-300">
              Crypto
            </a>
          </div>
        </div>

        {/* What You Get */}
        <div className="mt-12">
          <h2 className="text-center text-sm uppercase tracking-[0.3em] text-zinc-500">
            What you get every morning
          </h2>
          <ul className="mx-auto mt-6 max-w-lg space-y-4 text-[15px] leading-relaxed text-zinc-300">
            <li className="flex gap-3">
              <span className="mt-0.5 text-zinc-600">&#9656;</span>
              <span><strong className="text-white">Daily bias score</strong> &mdash; Risk-On, Neutral, or Risk-Off, based on cross-asset data across stocks, bonds, commodities, and volatility.</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 text-zinc-600">&#9656;</span>
              <span><strong className="text-white">Bottom line</strong> &mdash; What the market is actually doing today, in plain English, before you open a single chart.</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 text-zinc-600">&#9656;</span>
              <span><strong className="text-white">Sector snapshot</strong> &mdash; Which sectors are leading, which are under pressure, and why it matters for your trades.</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 text-zinc-600">&#9656;</span>
              <span><strong className="text-white">Historical context</strong> &mdash; How similar market conditions played out in the past, so you know what to expect.</span>
            </li>
            {cryptoOptedIn && (
              <li className="flex gap-3">
                <span className="mt-0.5 text-zinc-600">&#9656;</span>
                <span><strong className="text-white">Crypto regime scoring</strong> &mdash; Daily BTC bias with market breakdown, risk check, and model notes — same discipline, tuned for crypto volatility.</span>
              </li>
            )}
          </ul>
        </div>

        {/* Sample Briefings */}
        <div className="mt-14">
          <h2 className="text-center text-sm uppercase tracking-[0.3em] text-zinc-500">
            Here is what a briefing looks like
          </h2>
          <div className="mx-auto mt-6 grid max-w-lg gap-4 sm:max-w-3xl sm:grid-cols-2">
            {/* Stocks sample */}
            <div className="border border-zinc-800 bg-zinc-950/80 p-6">
              <div className="flex items-baseline justify-between">
                <p className="text-xs uppercase tracking-widest text-zinc-500">Stocks</p>
                <p className="text-xs font-medium text-emerald-500">RISK ON (+42)</p>
              </div>
              <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-zinc-300">
                <p className="text-xs font-medium uppercase tracking-widest text-zinc-400">Bottom Line</p>
                <p>
                  Credit spreads are tightening, oil momentum is positive, and volatility is falling. The tape favors buyers today.
                </p>
                <p className="mt-4 text-xs font-medium uppercase tracking-widest text-zinc-400">Sector Breakdown</p>
                <p>
                  <strong className="text-white">Tech:</strong> Strong. Semis leading pre-market, broad risk appetite confirmed by falling VIX.
                </p>
                <p className="text-zinc-600">
                  3 more sectors + risk check + model notes...
                </p>
              </div>
              <div className="mt-5 border-t border-zinc-800 pt-4">
                <p className="text-center text-xs text-zinc-500">
                  8:45 AM ET, every trading day.
                </p>
              </div>
            </div>
            {/* Crypto sample */}
            <div className="border border-zinc-800 bg-zinc-950/80 p-6">
              <div className="flex items-baseline justify-between">
                <p className="text-xs uppercase tracking-widest text-zinc-500">Crypto</p>
                <p className="text-xs font-medium text-emerald-500">RISK ON (+38)</p>
              </div>
              <div className="mt-4 space-y-3 text-[14px] leading-relaxed text-zinc-300">
                <p className="text-xs font-medium uppercase tracking-widest text-sky-400/80">Bottom Line</p>
                <p>
                  BTC reclaimed the 200-day moving average with volume confirmation. Funding rates are positive but not overheated.
                </p>
                <p className="mt-4 text-xs font-medium uppercase tracking-widest text-violet-400/80">Market Breakdown</p>
                <p>
                  <strong className="text-white">Bitcoin:</strong> Strong. Breaking above key resistance with spot-led demand.
                </p>
                <p className="text-zinc-600">
                  Altcoins + risk check + model notes...
                </p>
              </div>
              <div className="mt-5 border-t border-zinc-800 pt-4">
                <p className="text-center text-xs text-zinc-500">
                  9:00 AM ET, every day.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Final CTA */}
        <div className="mt-14 text-center">
          <p className="text-sm text-zinc-500">
            No spam. No picks. Just data. Unsubscribe anytime.
          </p>
        </div>
      </div>
    </main>
  );
}