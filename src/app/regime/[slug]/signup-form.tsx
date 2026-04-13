"use client";

import type { FormEvent } from "react";
import { useState } from "react";

type SubmissionState = "idle" | "loading" | "success" | "error";

export function RegimeSignupForm({ regime }: { regime: string }) {
  const [email, setEmail] = useState("");
  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submissionState === "loading") {
      return;
    }

    setSubmissionState("loading");
    setStatusMessage("Adding...");

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to subscribe.");
      }

      setSubmissionState("success");
      setStatusMessage(`You're in. Daily ${regime} alerts start tomorrow.`);
      setEmail("");
    } catch (error) {
      setSubmissionState("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to subscribe.",
      );
    }
  }

  const isLoading = submissionState === "loading";
  const statusColor =
    submissionState === "error"
      ? "text-red-400"
      : submissionState === "success"
        ? "text-emerald-400"
        : "text-zinc-500";

  return (
    <div className="mt-5">
      <form
        className="flex max-w-xl flex-col gap-3 sm:flex-row"
        onSubmit={handleSubmit}
      >
        <label className="sr-only" htmlFor="regime-email">
          Email address
        </label>
        <input
          id="regime-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11 flex-1 border border-zinc-800 bg-zinc-950 px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="h-11 border border-white/20 bg-white/5 px-5 text-xs font-semibold uppercase tracking-widest text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Adding..." : "Get Free Alerts"}
        </button>
      </form>
      <p className={`mt-2 text-xs ${statusColor}`} aria-live="polite">
        {statusMessage ?? "\u00A0"}
      </p>
    </div>
  );
}
