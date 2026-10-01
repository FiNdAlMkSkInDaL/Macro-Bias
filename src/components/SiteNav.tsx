"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { createSupabaseBrowserClient, getSupabaseBrowserClientConfigError } from '@/lib/supabase/browser';
import styles from './SiteNav.module.css';

const ADMIN_EMAIL = 'finphillips21@gmail.com';
const PUBLIC_LINKS = [
  { href: '/today', label: 'Stocks' },
  { href: '/crypto', label: 'Crypto' },
  { href: '/track-record', label: 'Track Record' },
  { href: '/pricing', label: 'Pricing' },
];

function isCurrent(pathname: string, href: string) {
  if (href.endsWith('/dashboard')) return pathname === '/dashboard' || pathname === '/crypto/dashboard';
  if (href.endsWith('/track-record')) return pathname === '/track-record' || pathname === '/crypto/track-record';
  return pathname === href;
}

export function SiteNav() {
  const pathname = usePathname();
  const cryptoMarket = pathname.startsWith('/crypto');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const memberLinks = [
    { href: cryptoMarket ? '/crypto/dashboard' : '/dashboard', label: 'Dashboard' },
    { href: '/today', label: 'Stocks' },
    { href: '/crypto', label: 'Crypto' },
    { href: cryptoMarket ? '/crypto/track-record' : '/track-record', label: 'History' },
    { href: '/refer', label: 'Referrals' },
  ];
  const links = [...(signedIn ? memberLinks : PUBLIC_LINKS), ...(isAdmin ? [{ href: '/analytics', label: 'Analytics' }] : [])];

  useEffect(() => {
    if (getSupabaseBrowserClientConfigError()) return;
    const supabase = createSupabaseBrowserClient();
    let mounted = true;
    let authRevision = 0;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      authRevision += 1;
      setSignedIn(Boolean(session?.user));
      setIsAdmin(session?.user?.email === ADMIN_EMAIL);
    });
    const initialRevision = authRevision;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!mounted || authRevision !== initialRevision) return;
      setSignedIn(Boolean(user));
      setIsAdmin(user?.email === ADMIN_EMAIL);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => { setMobileMenuOpen(false); }, [pathname]);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      document.cookie.split(';').forEach((cookie) => {
        const name = cookie.split('=')[0]?.trim();
        if (name?.startsWith('sb-') && name.includes('-auth-token')) {
          document.cookie = `${name}=; Max-Age=0; path=/`;
        }
      });
    }
    window.location.assign('/');
  }

  return (
    <header className={styles.header}>
      <div className={`${styles.bar} ${pathname === '/' ? styles.homeBar : ''}`}>
        <Link href="/" className={styles.brand} data-analytics-event="nav_logo_click" data-analytics-label="Macro Bias" data-analytics-location="site_nav">Macro Bias</Link>
        <nav className={styles.desktop} aria-label="Main navigation">
          {links.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={isCurrent(pathname, href) ? 'page' : undefined} data-analytics-event="nav_link_click" data-analytics-label={label} data-analytics-location="site_nav">{label}</Link>
          ))}
        </nav>
        <div className={styles.utility}>
          <Link href={signedIn ? '/account' : '/login'} aria-current={pathname === '/account' ? 'page' : undefined} data-analytics-event="nav_cta_click" data-analytics-label={signedIn ? 'Account' : 'Sign in'} data-analytics-location="site_nav">{signedIn ? 'Account' : 'Sign in'}</Link>
          {signedIn ? <button className={styles.signOut} type="button" onClick={() => { void handleSignOut(); }}>Sign out</button> : null}
          <button className={styles.menuButton} type="button" onClick={() => setMobileMenuOpen((open) => !open)} aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileMenuOpen} aria-controls="mobile-site-navigation">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={mobileMenuOpen ? 'M5 5l10 10M15 5L5 15' : 'M3 5h14M3 10h14M3 15h14'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>
      {mobileMenuOpen ? (
        <nav className={styles.mobile} id="mobile-site-navigation" aria-label="Mobile navigation">
          {links.map(({ href, label }) => <Link key={href} href={href} aria-current={isCurrent(pathname, href) ? 'page' : undefined} onClick={() => setMobileMenuOpen(false)} data-analytics-event="nav_link_click" data-analytics-label={label} data-analytics-location="site_nav_mobile">{label}</Link>)}
          {signedIn ? <button type="button" onClick={() => { void handleSignOut(); }}>Sign out</button> : null}
        </nav>
      ) : null}
    </header>
  );
}
