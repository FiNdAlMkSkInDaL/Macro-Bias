// A separate daily recovery job catches delayed provider closes and missed runs.
// Reuse the price-only handler and its authentication, without running publishers.
export { GET } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
