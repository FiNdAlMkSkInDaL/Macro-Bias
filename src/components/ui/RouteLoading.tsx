import { LoadingIndicator } from './LoadingIndicator';
import styles from './RouteLoading.module.css';

export type LoadingLayout = 'dashboard' | 'reading' | 'article' | 'archive' | 'form' | 'account' | 'pricing' | 'referrals' | 'content' | 'home';

function Line({ size = 'medium' }: { size?: 'short' | 'medium' | 'long' | 'full' }) {
  return <span className={`${styles.line} ${styles[size]}`} />;
}

function Score() {
  return <div className={`${styles.panel} ${styles.score}`}><Line size="short" /><span className={styles.scoreValue} /><Line size="medium" /></div>;
}

function Chart() {
  return <div className={styles.panel}><div className={styles.chartHeading}><Line size="short" /><Line size="short" /></div><div className={styles.chart} /><div className={styles.readout}>{[0, 1, 2, 3].map(index => <div key={index}><Line size="short" /><Line size="medium" /></div>)}</div></div>;
}

function Paragraphs() {
  return <div className={styles.paragraphs}>{[0, 1, 2].map(index => <div key={index}><Line size="full" /><Line size="long" /><Line size="medium" /></div>)}</div>;
}

function Archive() {
  return <div className={styles.panel}><div className={styles.tabs}><Line size="short" /><Line size="short" /></div><div className={styles.archiveHeader}>{[0, 1, 2, 3].map(index => <Line size="short" key={index} />)}</div>{[0, 1, 2, 3, 4, 5, 6].map(index => <div className={styles.archiveRow} key={index}><Line size="medium" /><Line size="short" /><Line size="medium" /><Line size="short" /></div>)}</div>;
}

function FormFields() {
  return <><div className={styles.fields}>{[0, 1].map(index => <div key={index}><Line size="short" /><span className={styles.field} /></div>)}</div><span className={styles.button} /></>;
}

function Skeleton({ layout }: { layout: LoadingLayout }) {
  switch (layout) {
    case 'dashboard': return <><Score /><Chart /></>;
    case 'reading': return <><Score /><Chart /><div className={styles.panel}><Paragraphs /></div></>;
    case 'archive': return <Archive />;
    case 'form': return <div className={styles.panel}><Line size="long" /><FormFields /></div>;
    case 'account': return <><div className={styles.panel}><Line size="short" /><div className={styles.accountSummary}><span className={styles.scoreValue} /><span className={styles.button} /></div><Line size="long" /></div><div className={styles.panel}><Line size="long" /><div className={styles.preferences}>{[0, 1].map(index => <div key={index}><span className={styles.checkbox} /><Line size="medium" /></div>)}</div><span className={styles.button} /></div></>;
    case 'pricing': return <div className={styles.pricing}>{[0, 1].map(index => <div className={styles.panel} key={index}><Line size="short" /><span className={styles.scoreValue} /><Line size="long" /><span className={styles.button} /><div className={styles.features}>{[0, 1, 2, 3].map(feature => <Line size="long" key={feature} />)}</div></div>)}</div>;
    case 'referrals': return <><div className={styles.metrics}>{[0, 1, 2].map(index => <div className={styles.panel} key={index}><Line size="medium" /><span className={styles.scoreValue} /></div>)}</div><div className={styles.panel}><Line size="long" /><span className={styles.field} /><span className={styles.button} /></div><Archive /></>;
    case 'home': return <><div className={styles.hero}><div className={styles.panel}><Line size="long" /><span className={styles.headline} /><span className={styles.headline} /><Paragraphs /><span className={styles.button} /></div><div><Score /><Chart /></div></div></>;
    case 'article':
    case 'content': return <div className={styles.panel}><Line size="short" /><span className={styles.headline} /><Paragraphs /><Paragraphs /></div>;
  }
}

/** Static and safe to prefetch: it reads no route, account, market or model data. */
export function RouteLoading({ label, layout = 'content', market, as = 'main' }: {
  label: string;
  layout?: LoadingLayout;
  market?: 'stocks' | 'crypto';
  as?: 'main' | 'section';
}) {
  const Container = as;
  const narrow = layout === 'form' || layout === 'account' || layout === 'article' || layout === 'content';
  return (
    <Container className={`${styles.shell}${narrow ? ` ${styles.narrow}` : ''}`} data-member-page data-route-loading data-loading-layout={layout} data-loading-market={market}>
      <h1 className={styles.title}><LoadingIndicator label={label} className={styles.status} /></h1>
      <div className={styles.skeletons} aria-hidden="true" aria-busy="true"><Skeleton layout={layout} /></div>
    </Container>
  );
}
