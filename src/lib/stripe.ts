import 'server-only';

import Stripe from 'stripe';

import { getRequiredServerEnv } from './server-env';

export type StripeBillingPlan = 'annual' | 'monthly';

let stripeClient: Stripe | null = null;

// These getters defer secret access until an API route actually runs.
// That keeps `next build` from crashing in environments where runtime-only
// secrets are injected after the build step.
export function getStripeClient() {
	if (!stripeClient) {
		stripeClient = new Stripe(getRequiredServerEnv('STRIPE_SECRET_KEY'));
	}

	return stripeClient;
}

function getOptionalServerEnv(name: string): string | null {
	return process.env[name] ?? null;
}

export function getStripePriceId(plan: StripeBillingPlan = 'monthly') {
	if (plan === 'annual') {
		return getRequiredServerEnv('STRIPE_ANNUAL_PRICE_ID');
	}

	return (
		getOptionalServerEnv('STRIPE_MONTHLY_PRICE_ID') ?? getRequiredServerEnv('STRIPE_PRICE_ID')
	);
}

export function getStripeWebhookSecret() {
	return getRequiredServerEnv('STRIPE_WEBHOOK_SECRET');
}