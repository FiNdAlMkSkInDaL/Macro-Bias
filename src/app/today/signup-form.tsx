"use client";

import { type FormEvent, useState } from "react";

import { trackClientEvent } from "@/lib/analytics/client";
import { useReferralCode } from "@/lib/referral/client";

export function TodaySignupForm() {
  const [email, setEmail] = useState("");
  const [stocksOptedIn, setStocksOptedIn] = useState(true);
  const [cryptoOptedIn, setCryptoOptedIn] = useState(true);
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const refCode = useReferralCode();

  const neitherSelected = !stocksOptedIn && !cryptoOptedIn;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "loading" || neitherSelected) return;

    setState("loading");
    setMessage(null);

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          pagePath: "/today",
          stocksOptedIn,
          cryptoOptedIn,
          ref: refCode,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setState("error");
        setMessage(data.error ?? "Something went wrong.");
        return;
      }

      setState("success");
      setMessage("You are on the list. Check your inbox.");
      trackClientEvent({
        eventName: "email_signup_success",
        metadata: { location: "today_page", stocks: stocksOptedIn, crypto: cryptoOptedIn },
      });
      setEmail("");
    } catch {
      setState("error");
      setMessage("Network error. Try again.");
      trackClientEvent({
        eventName: "email_signup_failure",
        metadata: {
          location: "today_page",
          message: "Network error. Try again.",
        },
      });
    }
  }

  if (state === "success") {
    return (
      <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
        <p className="text-sm font-medium text-emerald-400">{message}</p>
        <p className="mt-2 text-xs text-zinc-500">
          First briefing arrives before the next market open.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Invite 3 traders and unlock 7 days of Premium.{" "}
          <a
            href="/refer"
            className="text-sky-400 underline"
            data-analytics-event="referral_cta_click"
            data-analytics-label="Today Signup Success"
            data-analytics-location="today_signup_form"
          >
            Get your referral link
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="today-email">
          Email address
        </label>
        <input
          id="today-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-4 text-white placeholder-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
        />
        <button
          type="submit"
          disabled={state === "loading" || neitherSelected}
          className="h-12 rounded-md border border-white bg-white px-5 text-sm font-medium text-zinc-950 transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {state === "loading" ? "Adding..." : "Get the daily briefing"}
        </button>
      </form>

      <div className="mt-3 flex items-center justify-center gap-6">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={stocksOptedIn}
            onChange={(e) => setStocksOptedIn(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-white"
          />
          Stocks
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={cryptoOptedIn}
            onChange={(e) => setCryptoOptedIn(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-white"
          />
          Crypto
        </label>
      </div>

      {neitherSelected && (
        <p className="mt-2 text-center text-xs text-rose-400">
          Select at least one newsletter.
        </p>
      )}

      {state === "error" && message && (
        <p className="mt-2 text-center text-xs text-rose-400">{message}</p>
      )}

      <p className="mt-3 text-center text-xs text-zinc-600">
        No spam. No picks. Just data. Unsubscribe anytime.
      </p>
    </div>
  );
}
