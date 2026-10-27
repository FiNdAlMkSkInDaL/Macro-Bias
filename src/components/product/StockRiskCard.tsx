import { stockRiskCopy, type StockRiskState } from '@/lib/model-forward/risk';
import styles from './StockRiskCard.module.css';

export function StockRiskCard({ state }: { state?: StockRiskState }) {
  const copy = state?.forecast ? stockRiskCopy(state.forecast) : null;
  return <section className={styles.card} aria-label="SPY session risk estimate" data-stock-risk>
    <div className={styles.heading}><h2>{copy?.title ?? 'SPY move estimate'}</h2><span>Move size</span></div>
    {copy ? <>
      <p className={styles.estimate}>{copy.estimate}</p>
      <p>{copy.detail}</p>
      <p>{copy.scope}</p>
      <details><summary>How to use this estimate</summary><p>{copy.evidence} It is an approximate typical absolute move, calculated from past open-to-close returns. It is separate from the daily score and is not a price target or a trading instruction.</p></details>
    </> : <p role="status">{state?.notice ?? 'The next session’s SPY move estimate is not available yet.'}</p>}
  </section>;
}
