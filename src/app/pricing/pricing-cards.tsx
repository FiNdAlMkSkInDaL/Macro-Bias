'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { ArrowIcon } from '@/components/product/ArrowIcon';
import { sanitizeRedirectPath } from '@/lib/auth/continuation';

import styles from './pricing.module.css';

type BillingCycle = 'monthly' | 'annual';

const MONTHLY_PRICE = 25;
const ANNUAL_PRICE = 190;
const ANNUAL_MONTHLY = (ANNUAL_PRICE / 12).toFixed(2);
const ANNUAL_SAVINGS = MONTHLY_PRICE * 12 - ANNUAL_PRICE;

const freeFeatures = [
  'Public scores and market history',
  'Full briefings seven full days after original publication',
  'Optional stock and crypto email previews',
];

const proFeatures = [
  'Full stock and crypto briefings as published',
  'Daily workspace to decide whether to trade or wait',
  'Reliability grade, size hint and risk checks',
  'Model context and evidence for each decision',
];

const questions = [
  {
    question: 'What can I read for free?',
    answer: 'Public scores and history are open. A free account can read full stock and crypto articles once seven full days have passed since original publication. Optional email previews require a separate signup.',
  },
  {
    question: 'When does Pro access begin?',
    answer: 'After you complete checkout and your subscription is confirmed. Pro includes the current briefing and workspace.',
  },
  {
    question: 'Can I manage my subscription?',
    answer: 'Manage billing and cancellation from your account.',
  },
  {
    question: 'Are monthly and annual plans different?',
    answer: 'Both include the same Pro access. Only the billing schedule changes.',
  },
];

function FeatureList({ features }: { features: readonly string[] }) {
  return (
    <ul className={styles.features}>
      {features.map(feature => (
        <li key={feature}>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}

export function PricingCards() {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const searchParams = useSearchParams();
  const coupon = searchParams.get('coupon');
  const couponQuery = coupon && /^[A-Za-z0-9_-]+$/.test(coupon) ? `&coupon=${encodeURIComponent(coupon)}` : '';
  const returnPath = sanitizeRedirectPath(searchParams.get('redirectTo'));
  const returnQuery = returnPath ? `&redirectTo=${encodeURIComponent(returnPath)}` : '';
  const freeReturnPath = returnPath ?? '/briefings';

  return (
    <main className={styles.page} data-member-page>
      <header className={styles.introduction}>
        <h1>Get the full market read</h1>
        <p>Explore the published history for free. Go Pro for current briefings,<br className={styles.desktopBreak} /> a daily workspace, and the evidence behind each decision.</p>
      </header>

      <div className={styles.billingSelector} role="group" aria-label="Pro billing schedule">
        <button type="button" aria-pressed={cycle === 'monthly'} onClick={() => setCycle('monthly')}>Monthly</button>
        <button type="button" aria-pressed={cycle === 'annual'} onClick={() => setCycle('annual')}>Annual</button>
      </div>

      <div className={styles.plans}>
        <section className={styles.plan} aria-labelledby="free-plan-heading">
          <h2 id="free-plan-heading">Free</h2>
          <p className={styles.planDescription}>Explore the track record</p>
          <p className={styles.price}>$0<span>/ forever</span></p>
          <div className={styles.freeActions}>
            <Link href={`/login?mode=signup&redirectTo=${encodeURIComponent(freeReturnPath)}`} className={styles.secondaryButton}>Create free account</Link>
            <Link href="/track-record" className={styles.historyLink}>Browse history<ArrowIcon /></Link>
          </div>
          <FeatureList features={freeFeatures} />
          <p className={styles.planNote}>Sign in to read older full articles. Email previews require a separate signup.</p>
        </section>

        <section className={`${styles.plan} ${styles.proPlan}`} aria-labelledby="pro-plan-heading">
          <h2 id="pro-plan-heading">Pro</h2>
          <p className={styles.planDescription}>Make the current reading actionable</p>
          <p className={styles.price} aria-live="polite">${cycle === 'monthly' ? MONTHLY_PRICE : ANNUAL_PRICE}<span>/ {cycle === 'monthly' ? 'month' : 'year'}</span></p>
          <p className={styles.billingDetail}>
            {cycle === 'monthly'
              ? `Billed $${MONTHLY_PRICE} monthly. Same Pro access with monthly or annual billing.`
              : `Billed $${ANNUAL_PRICE} yearly. Equivalent to $${ANNUAL_MONTHLY}/month.`}
          </p>
          <a href={`/api/checkout?plan=${cycle}${couponQuery}${returnQuery}`} className={styles.primaryButton}>Get Pro<ArrowIcon /></a>
          <FeatureList features={proFeatures} />
          <p className={styles.planNote}>Pro access starts once your subscription is confirmed.</p>
        </section>
      </div>

      <section className={styles.billingComparison} aria-labelledby="billing-comparison-heading">
        <h2 id="billing-comparison-heading">One Pro plan. Two ways to pay.</h2>
        <p>Monthly: ${MONTHLY_PRICE}. Annual: ${ANNUAL_PRICE} — equivalent to ${ANNUAL_MONTHLY}/month. Save ${ANNUAL_SAVINGS} compared with 12 monthly payments.</p>
      </section>

      <section className={styles.faq} aria-labelledby="pricing-questions-heading">
        <h2 id="pricing-questions-heading">Frequently asked questions</h2>
        <div className={styles.questions}>
          {questions.map(({ question, answer }) => (
            <div key={question}><h3>{question}</h3><p>{answer}</p></div>
          ))}
        </div>
      </section>
      <p className={styles.disclaimer}>Market analysis, not personalised financial advice.</p>
    </main>
  );
}
