import Link from "next/link";

const NAV_LINKS = [
  { href: "/track-record", label: "Track Record" },
  { href: "/pricing", label: "Pricing" },
  { href: "/briefings", label: "Briefings" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

export function SiteNav() {
  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6 sm:px-8 lg:px-10">
        <Link
          href="/"
          className="font-[family:var(--font-heading)] text-sm font-semibold tracking-[0.18em] text-white uppercase"
          data-analytics-event="nav_logo_click"
          data-analytics-label="Macro Bias"
          data-analytics-location="site_nav"
        >
          Macro Bias
        </Link>
        <nav className="flex items-center gap-5 sm:gap-6">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="hidden text-[13px] font-medium text-zinc-500 transition hover:text-white sm:inline"
              data-analytics-event="nav_link_click"
              data-analytics-label={label}
              data-analytics-location="site_nav"
            >
              {label}
            </Link>
          ))}
          <Link
            href="/emails"
            className="inline-flex items-center rounded-md bg-white/[0.04] px-3.5 py-1.5 text-[13px] font-medium text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            data-analytics-event="nav_cta_click"
            data-analytics-label="Get Signals"
            data-analytics-location="site_nav"
          >
            Get Signals
          </Link>
        </nav>
      </div>
    </header>
  );
}
