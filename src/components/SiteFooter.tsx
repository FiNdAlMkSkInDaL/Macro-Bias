import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/track-record", label: "Track Record" },
  { href: "/pricing", label: "Pricing" },
  { href: "/briefings", label: "Briefings" },
  { href: "/regime", label: "Regimes" },
  { href: "/refer", label: "Refer & Earn" },
  { href: "/emails", label: "Free Signals" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 pb-6 sm:pb-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-6 py-8 sm:flex-row sm:justify-between sm:px-8 lg:px-10">
        <Link
          href="/"
          className="px-1 py-2 -mx-1 font-[family:var(--font-heading)] text-xs font-semibold tracking-[0.18em] text-zinc-600 uppercase transition hover:text-white"
          data-analytics-event="footer_logo_click"
          data-analytics-label="Macro Bias"
          data-analytics-location="site_footer"
        >
          Macro Bias
        </Link>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {FOOTER_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="px-1 py-2 -mx-1 font-[family:var(--font-data)] text-[11px] text-zinc-600 transition hover:text-zinc-300"
              data-analytics-event={href === "/refer" ? "referral_cta_click" : "footer_link_click"}
              data-analytics-label={label}
              data-analytics-location="site_footer"
            >
              {label}
            </Link>
          ))}
        </nav>
        <p className="font-[family:var(--font-data)] text-[11px] text-zinc-700">
          &copy; {new Date().getFullYear()} Macro Bias
        </p>
      </div>
    </footer>
  );
}
