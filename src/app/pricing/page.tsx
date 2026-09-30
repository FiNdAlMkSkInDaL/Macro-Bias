import { Suspense } from 'react';

import { PricingCards } from './pricing-cards';

export default function PricingPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-6 py-16 text-sm text-zinc-400">Loading pricing.</main>}>
      <PricingCards />
    </Suspense>
  );
}
