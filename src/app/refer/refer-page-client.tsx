'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

import { MemberShell } from '@/components/product/MemberShell';
import member from '@/components/product/MemberUI.module.css';
import { trackClientEvent } from '@/lib/analytics/client';
import type { ReferralHub } from '@/lib/referral/load-referral-hub';

import styles from './refer.module.css';

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';
type ReferPageClientProps = {
  signedIn?: boolean;
  initialEmail?: string | null;
  initialError?: string | null;
  initialHub?: ReferralHub | null;
  initialUpsell?: boolean;
};

function buildInviteMessage(referralLink: string) {
  return `Macro Bias publishes stock and crypto regime readings, with free market updates by email. See the published reading and sign up here: ${referralLink}`;
}

function buildShareHref(kind: 'x' | 'email' | 'sms', referralLink: string) {
  const invitation = buildInviteMessage(referralLink);
  if (kind === 'x') return `https://twitter.com/intent/tweet?text=${encodeURIComponent(invitation)}`;
  if (kind === 'email') return `mailto:?subject=${encodeURIComponent('Macro Bias market updates')}&body=${encodeURIComponent(invitation)}`;
  return `sms:?&body=${encodeURIComponent(invitation)}`;
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null;
}

function isHub(value: unknown): value is ReferralHub {
  if (!value || typeof value !== 'object') return false;
  const hub = value as Partial<ReferralHub>;
  return (hub.referralLink === null || typeof hub.referralLink === 'string') &&
    typeof hub.landingPath === 'string' &&
    [hub.verifiedCount, hub.pendingCount, hub.totalCount].every(count => typeof count === 'number' && Number.isFinite(count) && count >= 0) &&
    Array.isArray(hub.rewards) && hub.rewards.every(reward => typeof reward.tier === 'number' && typeof reward.label === 'string' && typeof reward.earned === 'boolean' && (reward.fulfilledAt === null || typeof reward.fulfilledAt === 'string')) &&
    Array.isArray(hub.recentReferrals) && hub.recentReferrals.every(referral => typeof referral.referredEmail === 'string' && typeof referral.status === 'string' && typeof referral.createdAt === 'string');
}

export default function ReferPageClient({ signedIn = false, initialEmail = null, initialError = null, initialHub = null, initialUpsell = false }: ReferPageClientProps) {
  const [email, setEmail] = useState(initialEmail ?? '');
  const [loadState, setLoadState] = useState<LoadState>(initialHub ? 'loaded' : initialError ? 'error' : 'idle');
  const [errorMessage, setErrorMessage] = useState(initialError ? 'Referrals are temporarily unavailable. Please try again.' : null);
  const [needsSubscription, setNeedsSubscription] = useState(initialUpsell);
  const [data, setData] = useState<ReferralHub | null>(initialHub);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const preferencesPath = signedIn ? '/account' : '/login?redirectTo=%2Faccount';

  useEffect(() => { trackClientEvent({ eventName: 'referral_page_viewed', pagePath: '/refer' }); }, []);

  async function loadHub(address: string) {
    if (loadState === 'loading' || !address.trim()) return;
    setLoadState('loading');
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/referral/status?email=${encodeURIComponent(address.trim().toLowerCase())}`, { cache: 'no-store' });
      const payload = await response.json();
      if (payload?.upsell || response.status === 404) {
        setData(null); setNeedsSubscription(true); setLoadState('idle'); return;
      }
      if (!response.ok || !isHub(payload)) {
        setLoadState('error');
        setErrorMessage(response.status === 429 ? 'Too many requests. Please try again in a minute.' : 'Referrals are temporarily unavailable. Please try again.');
        return;
      }
      setNeedsSubscription(false); setData(payload); setLoadState('loaded');
      trackClientEvent({ eventName: 'referral_status_loaded', pagePath: '/refer', metadata: { pending_count: payload.pendingCount, verified_count: payload.verifiedCount } });
    } catch {
      setLoadState('error'); setErrorMessage('Referrals are temporarily unavailable. Please try again.');
    }
  }

  function handleLoad(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void loadHub(email); }

  async function handleCopy(kind: 'link' | 'invite') {
    if (!data?.referralLink) return;
    const value = kind === 'link' ? data.referralLink : buildInviteMessage(data.referralLink);
    try {
      await navigator.clipboard.writeText(value);
      if (kind === 'link') { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }
      else { setCopiedInvite(true); setTimeout(() => setCopiedInvite(false), 2000); }
      trackClientEvent({ eventName: 'referral_share_clicked', pagePath: '/refer', metadata: { method: kind === 'link' ? 'copy_link' : 'copy_invite' } });
    } catch { prompt(kind === 'link' ? 'Copy your referral link:' : 'Copy your invitation:', value); }
  }

  const shareLinks = data?.referralLink ? { x: buildShareHref('x', data.referralLink), email: buildShareHref('email', data.referralLink), sms: buildShareHref('sms', data.referralLink) } : null;

  return (
    <MemberShell title="Your referrals" description="Share your link and follow verified referrals." narrow>
      {signedIn ? (
        <div className={styles.reload}>
          {initialEmail ? <><span>{initialEmail}</span><button type="button" className={member.secondaryButton} disabled={loadState === 'loading'} onClick={() => void loadHub(initialEmail)}>{loadState === 'loading' ? 'Loading…' : 'Reload referrals'}</button></> : <p className={member.notice}>Email lookup is unavailable for this account. <Link className={member.textLink} href="/account">View your account</Link></p>}
        </div>
      ) : (
        <form className={styles.lookup} onSubmit={handleLoad} aria-busy={loadState === 'loading'}>
          <div><label htmlFor="referral-email">Subscriber email</label><input id="referral-email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} /></div>
          <button type="submit" className={member.secondaryButton} disabled={loadState === 'loading'}>{loadState === 'loading' ? 'Loading…' : 'Load referrals'}</button>
          <p>Use the email address you subscribed with.</p>
        </form>
      )}
      {loadState === 'loading' ? <p role="status" className={styles.feedback}>Loading referrals…</p> : null}
      {errorMessage ? <p role="alert" className={member.notice}>{errorMessage}</p> : null}
      {needsSubscription ? (
        <section className={member.notice} aria-label="Referral subscription availability">
          <p>No active free-email subscription was found for this address. Referrals are available to active email subscribers and Pro accounts.</p>
          <Link className={member.textLink} href={preferencesPath}>Manage email preferences</Link>
        </section>
      ) : null}
      {data && loadState === 'loaded' ? (
        <>
          {data.referralLink ? (
            <section aria-label="Share your referral link" className={styles.share}>
              <div className={styles.linkRow}><code>{data.referralLink}</code><button type="button" className={member.secondaryButton} onClick={() => void handleCopy('link')}>{copiedLink ? 'Copied!' : 'Copy link'}</button></div>
              <button type="button" className={`${member.button} ${styles.invitation}`} onClick={() => void handleCopy('invite')}>{copiedInvite ? 'Invitation copied' : 'Copy invitation'}</button>
              {shareLinks ? <div className={styles.shareActions}>
                <a href={shareLinks.x} target="_blank" rel="noreferrer" className={member.secondaryButton} data-analytics-event="referral_share_clicked" data-analytics-label="Share on X" data-analytics-location="referral_hub" data-analytics-method="x">X</a>
                <a href={shareLinks.email} className={member.secondaryButton} data-analytics-event="referral_share_clicked" data-analytics-label="Share by email" data-analytics-location="referral_hub" data-analytics-method="email">Email</a>
                <a href={shareLinks.sms} className={member.secondaryButton} data-analytics-event="referral_share_clicked" data-analytics-label="Share by SMS" data-analytics-location="referral_hub" data-analytics-method="sms">SMS</a>
              </div> : null}
              <p>Friends can review the published reading and sign up for free market emails on the daily reading page.</p>
              <Link href={data.referralLink} target="_blank" rel="noreferrer" className={member.textLink} data-analytics-event="referral_share_clicked" data-analytics-label="Open referral landing" data-analytics-location="referral_hub" data-analytics-method="open_landing">Preview your referral link</Link>
              <span className="sr-only" role="status">{copiedLink ? 'Referral link copied.' : copiedInvite ? 'Invitation copied.' : ''}</span>
            </section>
          ) : (
            <section className={member.notice} aria-label="Referral link availability"><p>A referral link is not available for this subscription yet. Your recorded referral activity is shown below.</p><Link href={preferencesPath} className={member.textLink}>Manage email preferences</Link></section>
          )}
          <section className={styles.countSection} aria-label="Referral totals">
            <dl className={styles.counts}><div><dt>Verified</dt><dd>{data.verifiedCount}</dd></div><div><dt>Pending</dt><dd>{data.pendingCount}</dd></div><div><dt>Total</dt><dd>{data.totalCount}</dd></div></dl>
          </section>
          <section className={member.section} aria-labelledby="referral-rewards"><h2 id="referral-rewards">Referral rewards</h2>
            <div className={member.tableWrap} tabIndex={0} role="region" aria-label="Recorded referral rewards"><table className={`${member.table} ${styles.rewardsTable}`}><thead><tr><th scope="col">Reward</th><th scope="col">Status</th></tr></thead><tbody>
              {data.rewards.map(reward => <tr key={reward.tier}><td>{reward.label}</td><td className={reward.earned || reward.fulfilledAt ? member.positive : member.muted}>{reward.fulfilledAt ? <>Issued {formatDate(reward.fulfilledAt) ?? '· date unavailable'}</> : reward.earned ? 'Eligible' : 'Not issued'}</td></tr>)}
            </tbody></table></div>
          </section>
          <section className={member.section} aria-labelledby="recent-referrals"><h2 id="recent-referrals">Recent referrals</h2>
            {data.recentReferrals.length ? <div className={member.tableWrap} tabIndex={0} role="region" aria-label="Recent referrals"><table className={`${member.table} ${styles.recentTable}`}><thead><tr><th scope="col">Subscriber</th><th scope="col">Status</th><th scope="col">Referred</th></tr></thead><tbody>{data.recentReferrals.map((referral, index) => <tr key={`${referral.referredEmail}-${index}`}><td>{referral.referredEmail}</td><td className={referral.status === 'verified' ? member.positive : member.muted}>{referral.status}</td><td>{formatDate(referral.createdAt) ?? 'Date unavailable'}</td></tr>)}</tbody></table></div> : <div className={`${member.notice} ${styles.empty}`}>{data.totalCount > 0 ? 'No recent referral details are available.' : 'No referrals yet.'}</div>}
          </section>
        </>
      ) : null}
      <section className={`${member.section} ${styles.explainer}`} aria-labelledby="referral-checks"><h2 id="referral-checks">How referrals count</h2><p>Share your unique link. When someone subscribes through it, the referral starts as pending. The verification check confirms active subscriptions before counting a referral as verified.</p><p>Recorded referral rewards appear in your hub. You can manage stock and crypto emails in your <Link href={preferencesPath} className={member.textLink}>email preferences</Link>.</p></section>
    </MemberShell>
  );
}
