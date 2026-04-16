import Link from "next/link";

type ReferralPromoCardProps = {
  className?: string;
  ctaLabel?: string;
  location: string;
  title?: string;
};

export function ReferralPromoCard({
  className = "",
  ctaLabel = "See referral rewards",
  location,
  title = "Invite 1 trader. Unlock 7 days of Premium.",
}: ReferralPromoCardProps) {
  return (
    <section className={`rounded-xl border border-sky-500/20 bg-sky-500/[0.05] p-6 ${className}`.trim()}>
      <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-sky-300/80">
        [ Refer & Earn ]
      </p>
      <h2 className="mt-3 text-xl font-semibold tracking-tight text-white">
        {title}
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-300">
        Every subscriber gets a unique link. Share it with traders you know. One verified
        referral unlocks 7 days of Premium. Seven unlock a free month. Fifteen unlock a free annual plan.
      </p>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500">
        <span className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1">1 → 7-day Premium</span>
        <span className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1">7 → Free month</span>
        <span className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1">15 → Annual plan</span>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          href="/refer"
          className="inline-flex items-center rounded-md border border-sky-400/40 bg-sky-500/10 px-4 py-2.5 min-h-[44px] text-sm font-medium text-sky-300 transition hover:bg-sky-500/20 w-full sm:w-auto"
          data-analytics-event="referral_cta_click"
          data-analytics-label={ctaLabel}
          data-analytics-location={location}
        >
          {ctaLabel}
        </Link>
        <Link
          href="/today"
          className="inline-flex items-center rounded-md border border-zinc-800 px-4 py-2.5 min-h-[44px] text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white w-full sm:w-auto"
          data-analytics-event="referral_cta_click"
          data-analytics-label="See Referral Landing"
          data-analytics-location={location}
        >
          See what friends land on
        </Link>
      </div>
    </section>
  );
}