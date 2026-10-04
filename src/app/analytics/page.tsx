import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAcquisitionReport } from '@/lib/analytics/acquisition-data';
import { getAnalyticsAdminUser } from '@/lib/analytics/admin-access';
import { parseAcquisitionFilters } from '@/lib/analytics/filters';
import { createSupabaseServerClient } from '@/lib/supabase/server';

import AnalyticsDashboard from './analytics-dashboard';
import styles from './analytics.module.css';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const metadata: Metadata = {
  title: 'Acquisition analytics | Macro Bias',
  robots: { index: false, follow: false },
};

export default async function AnalyticsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Authentication precedes every private report read and client serialization.
  const admin = await getAnalyticsAdminUser();
  if (!admin) {
    let user;
    try {
      const supabase = await createSupabaseServerClient();
      const result = await supabase.auth.getUser();
      if (result.error && result.error.name !== 'AuthSessionMissingError') throw new Error('Authentication unavailable.');
      user = result.data.user;
    } catch {
      return (
        <main className={styles.page}>
          <div className={styles.container}>
            <h1 className={styles.title}>Analytics access</h1>
            <p className={styles.subtitle}>We couldn’t verify your session. Sign in to try again.</p>
            <Link href="/login?redirectTo=%2Fanalytics" className={styles.outlineButton}>Sign in</Link>
          </div>
        </main>
      );
    }
    if (!user) redirect('/login?redirectTo=%2Fanalytics');
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>Analytics access</h1>
          <p className={styles.subtitle}>This page is available to the site owner’s analytics accounts.</p>
          <Link href="/account" className={styles.outlineButton}>Back to your account</Link>
        </div>
      </main>
    );
  }
  const params = await searchParams;
  let report;
  try {
    report = await getAcquisitionReport(parseAcquisitionFilters(params));
  } catch {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <h1 className={styles.title}>What brings people in?</h1>
          <p className={styles.subtitle}>See which sources turn visits into subscribers and paying members.</p>
          <div className={styles.loadError} role="alert">
            <h2>We couldn’t load this report.</h2>
            <p>Check the date range or try again in a moment.</p>
            <Link href="/analytics" className={styles.outlineButton}>Reload analytics</Link>
          </div>
        </div>
      </main>
    );
  }
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  return <AnalyticsDashboard report={report} initialView={view} />;
}
