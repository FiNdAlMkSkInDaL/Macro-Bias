import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ArrowIcon } from '@/components/product/ArrowIcon';
import { MemberShell } from '@/components/product/MemberShell';
import memberStyles from '@/components/product/MemberUI.module.css';
import { loadAlertPreferences } from '@/lib/account/alert-preferences';
import { getStripeCustomerId } from '@/lib/billing/stripe-customer';
import { getUserSubscriptionStatus } from '@/lib/billing/subscription';

import { AlertForm } from './alert-form';
import styles from './account.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Account & emails',
  description: 'Your plan and weekday email preferences.',
};

export default async function AccountPage() {
  const { isPro, user } = await getUserSubscriptionStatus();

  if (!user?.email) {
    redirect('/login?redirectTo=/account');
  }

  const [billingResult, alertsResult] = await Promise.allSettled([
    getStripeCustomerId(user.id),
    loadAlertPreferences(user.email),
  ]);
  const stripeCustomerId = billingResult.status === 'fulfilled' ? billingResult.value : null;
  const alerts = alertsResult.status === 'fulfilled' ? alertsResult.value : null;

  return (
    <MemberShell title="Account & emails" description={<span className={styles.email}>{user.email}</span>} narrow>
      <div className={styles.account}>
        <section className={styles.section} aria-labelledby="account-plan-heading">
          <div className={styles.planRow}>
            <div>
              <h2 id="account-plan-heading">Your plan</h2>
              <p className={styles.planName}>{isPro ? 'Pro' : 'Free'}</p>
              <p className={styles.copy}>
                {isPro ? 'Full readings and market workspaces.' : 'Previous published readings and weekday email updates.'}
              </p>
            </div>
            {billingResult.status === 'fulfilled' ? (
              stripeCustomerId ? (
                <a className={memberStyles.secondaryButton} href="/api/stripe/portal">Manage billing</a>
              ) : !isPro ? (
                <Link className={memberStyles.secondaryButton} href="/pricing">Explore Pro<ArrowIcon /></Link>
              ) : null
            ) : null}
          </div>
          {billingResult.status === 'rejected' ? (
            <p className={styles.readError}>Billing details are unavailable right now. <a href="/account">Reload account</a></p>
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="account-emails-heading">
          <h2 id="account-emails-heading">Weekday email updates</h2>
          <p className={styles.copy}>Choose stocks, crypto, or both.</p>
          {alerts ? (
            <AlertForm cryptoOptedIn={alerts.cryptoOptedIn} stocksOptedIn={alerts.stocksOptedIn} />
          ) : (
            <div className={styles.preferencesError} role="status">
              <p>Your email preferences couldn’t be loaded. Please reload to try again.</p>
              <a className={memberStyles.textLink} href="/account">Reload preferences<ArrowIcon /></a>
            </div>
          )}
        </section>

        <nav className={styles.links} aria-label="Account shortcuts">
          <Link className={memberStyles.textLink} href="/dashboard">Open dashboard<ArrowIcon /></Link>
          <Link className={memberStyles.textLink} href="/refer">View referrals<ArrowIcon /></Link>
        </nav>
      </div>
    </MemberShell>
  );
}
