import Link from 'next/link';
import type { ReactNode } from 'react';

import type { ProductAsset } from '@/lib/product/score-access';
import { ArrowIcon } from './ArrowIcon';
import styles from './MemberUI.module.css';

export function MemberShell({ title, description, plan, children, narrow = false }: {
  title: string;
  description?: ReactNode;
  plan?: string;
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <main className={`${styles.page} ${narrow ? styles.narrow : ''}`} data-member-page>
      <header className={styles.header}>
        <div><h1>{title}</h1>{description ? <div className={styles.description}>{description}</div> : null}</div>
        {plan ? <span className={styles.plan}>{plan}</span> : null}
      </header>
      {children}
    </main>
  );
}

const MARKET_PATHS = {
  daily: ['/today', '/crypto'],
  dashboard: ['/dashboard', '/crypto/dashboard'],
  history: ['/track-record', '/crypto/track-record'],
} as const;

export function MarketTabs({ asset, view = 'daily' }: { asset: ProductAsset; view?: keyof typeof MARKET_PATHS }) {
  const paths = MARKET_PATHS[view];
  return (
    <nav className={styles.marketTabs} aria-label={`${view === 'history' ? 'Track record' : view === 'dashboard' ? 'Dashboard' : 'Daily reading'} markets`}>
      <Link href={paths[0]} aria-current={asset === 'stocks' ? 'page' : undefined}>Stocks</Link>
      <Link href={paths[1]} aria-current={asset === 'crypto' ? 'page' : undefined}>Crypto</Link>
    </nav>
  );
}

export function MemberUpgrade() {
  return (
    <section className={styles.upgrade} aria-labelledby="member-upgrade-heading">
      <div><h2 id="member-upgrade-heading">Get the full market read</h2><p>Pro adds the current workspace reading, full briefing, permission, reliability and suggested size.</p></div>
      <Link className={styles.button} href="/pricing">Explore Pro<ArrowIcon /></Link>
    </section>
  );
}
