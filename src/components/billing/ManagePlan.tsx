import Link from 'next/link';
import styles from '@/components/product/MemberUI.module.css';

type ManagePlanProps = {
  hasStripeCustomer: boolean;
  isPro: boolean;
};

export function ManagePlan({ hasStripeCustomer, isPro }: ManagePlanProps) {
  if (!isPro) {
    return null;
  }

  if (hasStripeCustomer) {
    return (
      <a
        className={styles.textLink}
        href="/api/stripe/portal"
      >
        Manage billing
      </a>
    );
  }

  return (
    <Link className={styles.textLink} href="/account">Account & plan</Link>
  );
}
