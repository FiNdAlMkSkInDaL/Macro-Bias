"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import { trackClientEvent } from "@/lib/analytics/client";

type ReferralReward = {
  tier: number;
  threshold: number;
  label: string;
  earned: boolean;
  fulfilledAt: string | null;
};

type RecentReferral = {
  referredEmail: string;
  status: string;
  createdAt: string;
};

type ReferralStatus = {
  referralCode: string | null;
  referralLink: string | null;
  landingPath: string;
  verifiedCount: number;
  pendingCount: number;
  totalCount: number;
  rewards: ReferralReward[];
  recentReferrals: RecentReferral[];
};

type LoadState = "idle" | "loading" | "loaded" | "error";

function buildInviteMessage(referralLink: string) {
  return `I use Macro Bias to check the market regime before the open. Your link lands on the live /today page, and the daily briefing is free: ${referralLink}`;
}

function buildShareHref(kind: "x" | "email" | "sms", referralLink: string) {
  const inviteMessage = buildInviteMessage(referralLink);

  if (kind === "x") {
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(inviteMessage)}`;
  }

  if (kind === "email") {
    return `mailto:?subject=${encodeURIComponent("Daily market regime briefings")}&body=${encodeURIComponent(`${inviteMessage}\n\n1 referral unlocks 7 days of Premium.`)}`;
  }

  return `sms:?&body=${encodeURIComponent(inviteMessage)}`;
}

function formatEarnedAt(value: string | null) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ReferPageClient() {
  const [email, setEmail] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [data, setData] = useState<ReferralStatus | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);

  useEffect(() => {
    trackClientEvent({ eventName: "referral_page_viewed", pagePath: "/refer" });
  }, []);

  async function handleLoad(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loadState === "loading" || !email.trim()) {
      return;
    }

    setLoadState("loading");
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/referral/status?email=${encodeURIComponent(email.trim().toLowerCase())}`,
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to load referral status.");
      }

      setData(payload as ReferralStatus);
      setLoadState("loaded");
      trackClientEvent({
        eventName: "referral_status_loaded",
        pagePath: "/refer",
        metadata: {
          pending_count: payload.pendingCount,
          verified_count: payload.verifiedCount,
        },
      });
    } catch (err) {
      setLoadState("error");
      setErrorMessage(err instanceof Error ? err.message : "Unable to load referral status.");
    }
  }

  async function handleCopyLink() {
    if (!data?.referralLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
      trackClientEvent({ eventName: "referral_link_copied", pagePath: "/refer" });
    } catch {
      prompt("Copy your referral link:", data.referralLink);
    }
  }

  async function handleCopyInvite() {
    if (!data?.referralLink) {
      return;
    }

    const inviteMessage = buildInviteMessage(data.referralLink);

    try {
      await navigator.clipboard.writeText(inviteMessage);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
      trackClientEvent({
        eventName: "referral_share_clicked",
        pagePath: "/refer",
        metadata: {
          method: "copy_invite",
        },
      });
    } catch {
      prompt("Copy your invite message:", inviteMessage);
    }
  }

  const nextTier = data?.rewards.find((reward) => !reward.earned) ?? null;
  const verifiedCount = data?.verifiedCount ?? 0;
  const remainingForNextReward = nextTier ? Math.max(nextTier.threshold - verifiedCount, 0) : 0;
  const nextThreshold = nextTier?.threshold ?? 15;
  const progressPercent = nextTier
    ? Math.min(100, Math.round((verifiedCount / nextThreshold) * 100))
    : 100;

  const shareLinks = useMemo(() => {
    if (!data?.referralLink) {
      return null;
    }

    return {
      email: buildShareHref("email", data.referralLink),
      sms: buildShareHref("sms", data.referralLink),
      x: buildShareHref("x", data.referralLink),
    };
  }, [data?.referralLink]);

  return (
    <main className="flex min-h-screen items-start justify-center px-6 py-12 sm:py-20 text-white">
      <div className="w-full max-w-4xl">
        <header className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.42em] text-sky-400/70">
            [ Referral Program ]
          </p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-5xl">
            Invite traders. Unlock Premium.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
            Every subscriber gets a unique referral link. Your friends land on the live
            market regime page, subscribe free, and once they receive their first email,
            the referral verifies automatically.
          </p>
        </header>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            { label: "3 verified referrals", value: "7-day Premium unlock" },
            { label: "7 verified referrals", value: "1 free month" },
            { label: "15 verified referrals", value: "Free annual plan" },
          ].map((tier) => (
            <div key={tier.label} className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 text-center">
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{tier.label}</p>
              <p className="mt-2 text-lg font-semibold text-white">{tier.value}</p>
            </div>
          ))}
        </div>

        <form
          className="mx-auto mt-10 flex max-w-2xl flex-col gap-3 sm:flex-row"
          onSubmit={handleLoad}
        >
          <label className="sr-only" htmlFor="referral-email">
            Your email
          </label>
          <input
            id="referral-email"
            type="email"
            required
            autoComplete="email"
            placeholder="Your subscriber email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-12 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-4 text-white outline-none placeholder:text-zinc-600 focus:border-zinc-600"
          />
          <button
            type="submit"
            disabled={loadState === "loading"}
            className="h-12 rounded-md border border-white px-5 text-sm font-medium text-white transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadState === "loading" ? "Loading..." : "Load my referral hub"}
          </button>
        </form>

        <p className="mt-3 text-center text-xs text-zinc-600">
          Use the same email address you subscribed with.
        </p>

        {errorMessage && (
          <p className="mt-3 text-center text-sm text-red-400">{errorMessage}</p>
        )}

        {data && loadState === "loaded" && (
          <div className="mt-10 space-y-8">
            <section className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-sky-300/80">
                    Progress
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-white">
                    {verifiedCount} verified
                    <span className="ml-2 text-lg font-normal text-zinc-500">
                      / {data.totalCount} total referrals
                    </span>
                  </p>
                </div>
                <div className="max-w-sm text-sm leading-6 text-zinc-300">
                  {nextTier ? (
                    <p>
                      {remainingForNextReward} more verified referral{remainingForNextReward === 1 ? "" : "s"} unlocks
                      {" "}<span className="font-semibold text-white">{nextTier.label}</span>.
                    </p>
                  ) : (
                    <p>All reward tiers earned. Keep sharing if you want more traders using the product.</p>
                  )}
                </div>
              </div>

              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-sky-500 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Pending referrals: {data.pendingCount}
              </p>
            </section>

            {data.referralLink && (
              <section className="grid gap-6 md:grid-cols-[1.3fr_0.9fr]">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
                    Your referral link
                  </p>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                    <code className="min-w-0 flex-1 truncate rounded bg-zinc-950 px-3 py-2 text-sm text-sky-400">
                      {data.referralLink}
                    </code>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className="shrink-0 rounded-md border border-sky-400/40 bg-sky-500/10 px-4 py-2.5 min-h-[44px] text-xs font-semibold text-sky-300 transition hover:bg-sky-500/20"
                      >
                        {copiedLink ? "Copied!" : "Copy Link"}
                      </button>
                      <Link
                        href={data.referralLink}
                        className="shrink-0 rounded-md border border-zinc-700 px-4 py-2.5 min-h-[44px] text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                        data-analytics-event="referral_share_clicked"
                        data-analytics-label="Open Referral Landing"
                        data-analytics-location="referral_hub"
                        target="_blank"
                      >
                        Open Landing
                      </Link>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-400">
                    This link sends people to <span className="font-semibold text-zinc-200">{data.landingPath}</span>,
                    where they can see the live regime score before subscribing.
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
                  <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
                    Share faster
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    <button
                      type="button"
                      onClick={handleCopyInvite}
                      className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm font-medium text-white transition hover:bg-white/[0.08]"
                    >
                      {copiedInvite ? "Copied invite text" : "Copy invite text"}
                    </button>
                    {shareLinks && (
                      <>
                        <a
                          href={shareLinks.x}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]"
                          data-analytics-event="referral_share_clicked"
                          data-analytics-label="Share on X"
                          data-analytics-location="referral_hub"
                        >
                          Share on X
                        </a>
                        <a
                          href={shareLinks.email}
                          className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]"
                          data-analytics-event="referral_share_clicked"
                          data-analytics-label="Share by Email"
                          data-analytics-location="referral_hub"
                        >
                          Share by Email
                        </a>
                        <a
                          href={shareLinks.sms}
                          className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08]"
                          data-analytics-event="referral_share_clicked"
                          data-analytics-label="Share by Text"
                          data-analytics-location="referral_hub"
                        >
                          Share by Text
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </section>
            )}

            <section className="grid gap-4 sm:grid-cols-3">
              {data.rewards.map((reward) => (
                <div
                  key={reward.tier}
                  className={`rounded-xl border p-5 ${
                    reward.earned
                      ? "border-sky-500/50 bg-sky-500/5"
                      : "border-zinc-800 bg-zinc-900/30"
                  }`}
                >
                  <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">
                    Tier {reward.tier}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {reward.threshold}
                    <span className="text-sm font-normal text-zinc-500"> refs</span>
                  </p>
                  <p className="mt-2 text-sm text-zinc-300">{reward.label}</p>
                  <p className="mt-3 text-xs">
                    {reward.earned ? (
                      <span className="font-semibold text-sky-400">
                        Earned{reward.fulfilledAt ? ` · ${formatEarnedAt(reward.fulfilledAt)}` : ""}
                      </span>
                    ) : (
                      <span className="text-zinc-500">
                        {verifiedCount}/{reward.threshold} verified
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </section>

            {data.recentReferrals.length > 0 && (
              <section>
                <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
                  Recent referrals
                </p>
                <div className="mt-3 space-y-2">
                  {data.recentReferrals.map((referral, index) => (
                    <div
                      key={`${referral.referredEmail}-${index}`}
                      className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/30 px-4 py-2.5 text-sm"
                    >
                      <span className="truncate max-w-[180px] sm:max-w-none text-zinc-300">{referral.referredEmail}</span>
                      <div className="flex items-center gap-3">
                        <span className={referral.status === "verified" ? "text-emerald-400" : "text-zinc-500"}>
                          {referral.status}
                        </span>
                        <span className="text-xs text-zinc-600">
                          {new Date(referral.createdAt).toLocaleDateString("en-US", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        <section className="mt-16 grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              What counts
            </p>
            <ol className="mt-4 space-y-3 text-sm text-zinc-300">
              <li className="flex gap-3">
                <span className="font-semibold text-white">1.</span>
                Share your unique link with traders who actually use daily market context.
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-white">2.</span>
                They land on the live regime page, then subscribe to the free briefing.
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-white">3.</span>
                Once their first email is delivered, the referral moves from pending to verified.
              </li>
              <li className="flex gap-3">
                <span className="font-semibold text-white">4.</span>
                Rewards unlock automatically. No manual claim step.
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Best ways to share
            </p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-zinc-300">
              <p>
                Send the link directly to traders you already talk to: group chats, email,
                DMs, and desk-to-desk referrals beat broad blasting.
              </p>
              <p>
                Keep the pitch simple: free daily market regime briefings, 90 seconds,
                before the bell.
              </p>
              <p>
                If someone asks what they get, send them to <Link href="/today" className="text-sky-400 underline">/today</Link>
                {" "}or the free archive on <Link href="/briefings" className="text-sky-400 underline">/briefings</Link>.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}