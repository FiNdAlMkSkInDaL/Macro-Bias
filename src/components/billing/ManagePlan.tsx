import Link from 'next/link';

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
        className="text-xs text-zinc-500 underline underline-offset-4 hover:text-white"
        href="/api/stripe/portal"
      >
        Manage Subscription
      </a>
    );
  }

  return (
    <p className="max-w-xs text-xs leading-5 text-zinc-500 md:text-right">
      This plan is comped.{' '}
      <Link className="underline underline-offset-4 hover:text-white" href="/account">
        Account
      </Link>
    </p>
  );
}
