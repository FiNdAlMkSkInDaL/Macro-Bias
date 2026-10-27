import type { Metadata } from 'next';
import Link from 'next/link';
import { getAnalyticsAdminUser } from '@/lib/analytics/admin-access';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readModelEvents, summarizeForward } from '@/lib/model-forward/service';
import { ModelForwardReport } from '@/components/product/ModelForwardReport';
import styles from '../analytics.module.css';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const metadata: Metadata = { title: 'Model forward test', robots: { index: false, follow: false } };
export default async function ModelForwardPage() {
  if (!await getAnalyticsAdminUser()) return <main className={styles.page}><div className={styles.container}><h1 className={styles.title}>Owner model report</h1><p>Sign in with the owner account to see private forward-test results.</p><Link className={styles.outlineButton} href="/login">Sign in</Link></div></main>;
  let report;
  try { report = summarizeForward(await readModelEvents(createSupabaseAdminClient({ timeoutMs: 12_000 }))); }
  catch { return <main className={styles.page}><div className={styles.container}><h1 className={styles.title}>Forward results unavailable</h1><p>The stored predictions or outcomes could not be read. Results are unknown; nothing has been counted as zero.</p></div></main>; }
  return <ModelForwardReport report={report} />;
}
