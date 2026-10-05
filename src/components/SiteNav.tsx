"use client";

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { createSupabaseBrowserClient, getSupabaseBrowserClientConfigError } from '@/lib/supabase/browser';
import styles from './SiteNav.module.css';

const ADMIN_EMAILS = new Set(['finphillips21@gmail.com', 'finlayp32@gmail.com']);
const PUBLIC_LINKS = [
  { href: '/today', label: 'Today' },
  { href: '/track-record', label: 'Track Record' },
  { href: '/pricing', label: 'Pricing' },
];

function isCurrent(pathname: string, href: string) {
  if (href.endsWith('/dashboard')) return pathname === '/dashboard' || pathname === '/crypto/dashboard';
  if (href.endsWith('/track-record')) return pathname === '/track-record' || pathname === '/crypto/track-record';
  if (href === '/today' || href === '/crypto') return pathname === '/today' || pathname === '/crypto'
    || pathname === '/briefings' || pathname.startsWith('/briefings/')
    || pathname === '/crypto/briefings' || pathname.startsWith('/crypto/briefings/');
  return pathname === href;
}

function NavigationLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return <span className={styles.linkLabel} data-pending={pending || undefined}>
    {label}
    {pending ? <span className={styles.pendingDot} aria-hidden="true" /> : null}
    <span className={styles.screenReaderStatus} role="status">{pending ? `Opening ${label}…` : ''}</span>
  </span>;
}

export function SiteNav() {
  const pathname = usePathname();
  const cryptoMarket = pathname.startsWith('/crypto');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const memberLinks = [
    { href: cryptoMarket ? '/crypto/dashboard' : '/dashboard', label: 'Dashboard' },
    { href: cryptoMarket ? '/crypto' : '/today', label: 'Today' },
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
      setIsAdmin(Boolean(session?.user?.email_confirmed_at && ADMIN_EMAILS.has(session.user.email?.toLowerCase() ?? '')));
    });
    const initialRevision = authRevision;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!mounted || authRevision !== initialRevision) return;
      setSignedIn(Boolean(user));
      setIsAdmin(Boolean(user?.email_confirmed_at && ADMIN_EMAILS.has(user.email?.toLowerCase() ?? '')));
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
    <header className={styles.header} onKeyDown={(event) => {
      if (event.key === 'Escape' && mobileMenuOpen) {
        event.preventDefault();
        setMobileMenuOpen(false);
        menuButton.current?.focus();
      }
    }}>
      <div className={`${styles.bar} ${pathname === '/' ? styles.homeBar : ''}`}>
        <Link href="/" className={styles.brand} data-analytics-event="nav_logo_click" data-analytics-label="Macro Bias" data-analytics-location="site_nav"><NavigationLabel label="Macro Bias" /></Link>
        <nav className={styles.desktop} aria-label="Main navigation">
          {links.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={isCurrent(pathname, href) ? 'page' : undefined} data-analytics-event="nav_link_click" data-analytics-label={label} data-analytics-location="site_nav"><NavigationLabel label={label} /></Link>
          ))}
        </nav>
        <div className={styles.utility}>
          <Link href={signedIn ? '/account' : '/login'} aria-current={pathname === '/account' ? 'page' : undefined} data-analytics-event="nav_cta_click" data-analytics-label={signedIn ? 'Account' : 'Sign in'} data-analytics-location="site_nav"><NavigationLabel label={signedIn ? 'Account' : 'Sign in'} /></Link>
          {signedIn ? <button className={styles.signOut} type="button" onClick={() => { void handleSignOut(); }}>Sign out</button> : null}
          <button ref={menuButton} className={styles.menuButton} type="button" onClick={() => setMobileMenuOpen((open) => !open)} aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileMenuOpen} aria-controls="mobile-site-navigation">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={mobileMenuOpen ? 'M5 5l10 10M15 5L5 15' : 'M3 5h14M3 10h14M3 15h14'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>
      {mobileMenuOpen ? (
        <nav className={styles.mobile} id="mobile-site-navigation" aria-label="Mobile navigation">
          {links.map(({ href, label }) => <Link key={href} href={href} aria-current={isCurrent(pathname, href) ? 'page' : undefined} onClick={() => setMobileMenuOpen(false)} data-analytics-event="nav_link_click" data-analytics-label={label} data-analytics-location="site_nav_mobile"><NavigationLabel label={label} /></Link>)}
          {signedIn ? <button type="button" onClick={() => { void handleSignOut(); }}>Sign out</button> : null}
        </nav>
      ) : null}
    </header>
  );
}
