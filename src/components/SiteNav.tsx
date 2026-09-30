"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "../lib/supabase/browser";
import { getSupabaseBrowserClientConfigError } from "../lib/supabase/browser";

const ADMIN_EMAIL = "finphillips21@gmail.com";

const NAV_LINKS = [
  { href: "/today", label: "Stocks" },
  { href: "/crypto", label: "Crypto" },
  { href: "/track-record", label: "Track Record" },
  { href: "/pricing", label: "Pricing" },
] as const;

export function SiteNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [accountHref, setAccountHref] = useState("/login");
  const [accountLabel, setAccountLabel] = useState("Sign in");

  useEffect(() => {
    if (getSupabaseBrowserClientConfigError()) return;
    const supabase = createSupabaseBrowserClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setAccountHref("/dashboard");
        setAccountLabel("Dashboard");
        return;
      }

      setAccountHref("/login");
      setAccountLabel("Sign in");
    });
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email === ADMIN_EMAIL) setIsAdmin(true);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6 sm:px-8 lg:px-10">
        <Link
          href="/"
          className="py-2 font-[family:var(--font-heading)] text-sm font-semibold tracking-[0.18em] text-white uppercase"
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
          {isAdmin && (
            <Link
              href="/analytics"
              className="hidden text-[13px] font-medium text-emerald-500 transition hover:text-emerald-300 sm:inline"
              data-analytics-event="nav_link_click"
              data-analytics-label="Analytics"
              data-analytics-location="site_nav"
            >
              Analytics
            </Link>
          )}
          <Link
            href={accountHref}
            className="inline-flex items-center rounded-md bg-white/[0.04] px-3.5 py-2.5 text-[13px] font-medium text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            data-analytics-event="nav_cta_click"
            data-analytics-label={accountLabel}
            data-analytics-location="site_nav"
          >
            {accountLabel}
          </Link>
          <button
            type="button"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-zinc-400 transition hover:text-white sm:hidden"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            )}
          </button>
        </nav>
      </div>

      {mobileMenuOpen && (
        <nav className="z-50 border-t border-white/10 bg-zinc-950 sm:hidden">
          <div className="mx-auto flex max-w-7xl flex-col px-6 py-3">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="min-h-[44px] flex items-center text-[13px] font-medium text-zinc-400 transition hover:text-white"
                onClick={() => setMobileMenuOpen(false)}
                data-analytics-event="nav_link_click"
                data-analytics-label={label}
                data-analytics-location="site_nav_mobile"
              >
                {label}
              </Link>
            ))}
            {isAdmin && (
              <Link
                href="/analytics"
                className="min-h-[44px] flex items-center text-[13px] font-medium text-emerald-500 transition hover:text-emerald-300"
                onClick={() => setMobileMenuOpen(false)}
                data-analytics-event="nav_link_click"
                data-analytics-label="Analytics"
                data-analytics-location="site_nav_mobile"
              >
                Analytics
              </Link>
            )}
            <Link
              href={accountHref}
              className="mt-2 mb-1 inline-flex min-h-[44px] items-center justify-center rounded-md bg-white/[0.04] px-3.5 text-[13px] font-medium text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
              onClick={() => setMobileMenuOpen(false)}
              data-analytics-event="nav_cta_click"
              data-analytics-label={accountLabel}
              data-analytics-location="site_nav_mobile"
            >
              {accountLabel}
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
