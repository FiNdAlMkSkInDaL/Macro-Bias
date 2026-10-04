import { Suspense } from 'react';

import { RouteLoading } from '@/components/ui/RouteLoading';
import { PricingCards } from './pricing-cards';

export default function PricingPage() {
  return (
    <Suspense fallback={<RouteLoading label="Loading pricing" layout="pricing" />}>
      <PricingCards />
    </Suspense>
  );
}
