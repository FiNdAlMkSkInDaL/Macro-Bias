import styles from './LoadingIndicator.module.css';

/** Pure presentation: the caller's real pending state controls its lifetime. */
export function LoadingIndicator({ label, compact = false, className, announce = true }: {
  label: string;
  compact?: boolean;
  className?: string;
  announce?: boolean;
}) {
  return (
    <span className={`${styles.indicator}${compact ? ` ${styles.compact}` : ''}${className ? ` ${className}` : ''}`} role={announce ? 'status' : undefined} aria-live={announce ? 'polite' : undefined} aria-atomic={announce ? true : undefined} data-loading-indicator>
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/** Keep announcements outside a busy form while its button shows the same label. */
export function LoadingAnnouncement({ label }: { label: string }) {
  return <span className={styles.screenReaderOnly} role="status" aria-live="polite" aria-atomic="true">{label}</span>;
}
