import type { ViewerScore } from '@/lib/product/score-access';
import styles from './DailyPublicationNote.module.css';

export function DailyPublicationNote({ score, variant = 'inline' }: { score: ViewerScore; variant?: 'inline' | 'detail' }) {
  const publishedAt = score.publishedAt ? new Date(score.publishedAt) : null;
  const validPublication = publishedAt && Number.isFinite(publishedAt.getTime());
  const sourceDate = score.sourceTradeDate && /^\d{4}-\d{2}-\d{2}$/.test(score.sourceTradeDate)
    ? new Date(`${score.sourceTradeDate}T00:00:00Z`) : null;
  const validSource = sourceDate && Number.isFinite(sourceDate.getTime()) && sourceDate.toISOString().slice(0, 10) === score.sourceTradeDate && score.sourceTradeDate! <= score.tradeDate;

  if (variant === 'detail') {
    return (
      <dl className={styles.details} data-publication-note>
        <div><dt>Published</dt><dd>{validPublication ? <time dateTime={publishedAt.toISOString()}>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(publishedAt)} UTC</time> : 'Time not available'}</dd></div>
        <div><dt>Model price source</dt><dd>{validSource ? <time dateTime={score.sourceTradeDate!}>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(sourceDate)}</time> : 'Date not available'}</dd></div>
      </dl>
    );
  }

  return (
    <p className={styles.note} data-publication-note>
      {validPublication ? <>Published <time dateTime={publishedAt.toISOString()}>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(publishedAt)} UTC</time>.</> : null}
      {validSource && score.sourceTradeDate !== score.tradeDate ? <> Source prices dated <time dateTime={score.sourceTradeDate!}>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(sourceDate)}</time>.</> : null}
    </p>
  );
}
