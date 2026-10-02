import styles from './loading.module.css';

/** A prefetched route shell contains no session, score or account data. */
export default function Loading() {
  return <main className={styles.shell} aria-busy="true" data-route-loading="true">
    <h1 className={styles.title}>Opening page</h1>
    <p className={styles.status} role="status">Loading page content…</p>
    <div className={styles.panels} aria-hidden="true">
      <div className={styles.reading}><span /><span className={styles.readingValue} /><span /></div>
      <div className={styles.chart}><span /><div className={styles.chartArea} /></div>
    </div>
  </main>;
}
