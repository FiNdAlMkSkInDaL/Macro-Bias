import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ArrowIcon } from '@/components/product/ArrowIcon';
import { HeroSignupForm } from '@/components/product/HeroSignupForm';
import { MacroMarketChart } from '@/components/product/MacroMarketChart';
import { continuationFromSearchParams, firstSearchParam } from '@/lib/auth/continuation';
import { loadLatestRegimeRead, loadStoredSpyCandles, loadStoredStockScores } from '@/lib/public-proof/load-public-proof';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import styles from './home.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata: Metadata = {
  title: 'Free stocks and crypto market briefings',
  description: 'What moved, how the major markets compare, and what to watch next. Read a public stocks or crypto sample before joining the free email updates.',
  alternates: { canonical: '/' },
};

type HomePageProps = {
  searchParams: Promise<{
    authError?: string | string[];
    checkout?: string | string[];
    coupon?: string | string[];
    plan?: string | string[];
    redirectTo?: string | string[];
  }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const continuation = continuationFromSearchParams(params);
  const authError = firstSearchParam(params.authError);
  const checkout = firstSearchParam(params.checkout);

  if (continuation && !authError) {
    let signedIn = false;

    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      signedIn = Boolean(data.user);
    } catch {
      signedIn = false;
    }

    if (signedIn) {
      redirect(continuation);
    }
  }

  if (continuation || authError) {
    const loginParams = new URLSearchParams();

    if (continuation) {
      loginParams.set('redirectTo', continuation);
    }

    if (authError) {
      loginParams.set('authError', authError);
    }

    redirect(`/login?${loginParams.toString()}`);
  }

  const [regime, history, spyBars] = await Promise.all([
    loadLatestRegimeRead(),
    loadStoredStockScores(120),
    loadStoredSpyCandles(),
  ]);
  const latestScore = regime.value;
  const storedScores = history.value ?? [];
  const candles = spyBars.value ?? [];

  return (
    <main className={styles.landing} data-macro-landing>
      {checkout === 'success' ? (
        <p className="mb-8 border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Thank you for subscribing. Your Pro briefings and workspace will be available once your subscription is confirmed. Refresh if your access is still updating.
        </p>
      ) : null}
      {checkout === 'active' ? (
        <p className="mb-8 border border-white/10 px-4 py-3 text-sm text-zinc-300">
          This account already has an active subscription.
        </p>
      ) : null}
      <section className={styles.hero} aria-labelledby="hero-heading">
        <div className={styles.heroCopy}>
          <h1 id="hero-heading" className={styles.headline}>
            Make sense of<br />stocks and crypto.
            <span>What moved.<br className={styles.desktopBreak} /> What to watch next.</span>
          </h1>
          <p className={styles.description}>
            Short, free market briefings with dated price comparisons and a daily reading. Stocks on market days. Crypto every day. Read a public sample before deciding.
          </p>
          <div className={styles.heroSignup}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 20 }}>
              <Link href="/today" className={styles.textLink}>Read a stocks sample <ArrowIcon /></Link>
              <Link href="/crypto" className={styles.textLink}>Read a crypto sample <ArrowIcon /></Link>
            </div>
            <p className={styles.signupLabel}>Get the next update, free. Choose either newsletter or both.</p>
            <HeroSignupForm />
          </div>
          <Link href="/learn" className={styles.textLink} data-analytics-event="landing_guides_click" data-analytics-location="landing_hero">
            Learn how to compare the markets <ArrowIcon diagonal />
          </Link>
        </div>
        <MacroMarketChart
          candles={candles}
          marks={storedScores}
          latest={latestScore}
          notice={regime.error ?? spyBars.error ?? history.error}
        />
      </section>

      <section className={styles.context} aria-labelledby="context-heading">
        <h2 id="context-heading" className={styles.sectionHeading}>
          The market moves together.<span>Your analysis should too.</span>
        </h2>
        <ol className={styles.steps}>
          <li>
            <div className={styles.stepNumber}><span>01</span></div>
            <h3>Follow the rotation</h3>
            <p>Stocks, bonds, gold and risk signals feed a daily view of market conditions.</p>
          </li>
          <li>
            <div className={styles.stepNumber}><span>02</span></div>
            <h3>Read one daily score</h3>
            <p>A scale from -100 to +100 brings the cross-market picture into focus.</p>
          </li>
          <li>
            <div className={styles.stepNumber}><span>03</span></div>
            <h3>Put price in context</h3>
            <p>Explore each session on the chart, then open the dashboard for the full view.</p>
          </li>
        </ol>
        <Link href="/about" className={`${styles.textLink} ${styles.aboutLink}`}>
          See how Macro Bias works <ArrowIcon />
        </Link>
      </section>

      <section className={styles.pro} aria-labelledby="pro-heading">
        <div>
          <h2 id="pro-heading">Go deeper with Pro.</h2>
          <p>The current full briefing. A clear trading permission,<br className={styles.desktopBreak} /> reliability grade and size hint. The evidence behind each decision.</p>
        </div>
        <div className={styles.proActions}>
          <Link href="/pricing" className={styles.primaryLink} data-analytics-event="landing_pro_click" data-analytics-location="landing_pro">
            Explore Pro <ArrowIcon />
          </Link>
          <Link href="/track-record" className={styles.textLink}>View the track record</Link>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-heading">
        <h2 id="closing-heading">Make the market part<br className={styles.desktopBreak} /> of your morning.</h2>
        <div>
          <p>Your daily Macro Bias score and a short market update, delivered by email.</p>
          <HeroSignupForm location="landing_footer" />
        </div>
      </section>
    </main>
  );
}
