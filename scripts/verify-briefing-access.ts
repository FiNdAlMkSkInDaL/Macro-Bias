import assert from 'node:assert/strict';
import { briefingAccess, briefingReleaseAt, canReadBriefing, BRIEFING_RELEASE_DELAY_MS } from '../src/lib/product/briefing-access';

const published = '2026-09-25T12:45:27.119Z';
const boundary = Date.parse(published) + BRIEFING_RELEASE_DELAY_MS;
const anonymous = { signedIn: false, isPro: false };
const free = { signedIn: true, isPro: false };
const pro = { signedIn: true, isPro: true };
for (const viewer of [anonymous, free]) {
  assert.equal(briefingAccess(viewer, published, boundary - 1).kind, 'pro-required');
  assert.equal(canReadBriefing(briefingAccess(viewer, published, boundary - 1)), false);
}
assert.equal(briefingAccess(free, published, boundary).kind, 'free');
assert.equal(briefingAccess(anonymous, published, boundary).kind, 'sign-in');
assert.equal(canReadBriefing(briefingAccess(anonymous, published, boundary)), false);
assert.equal(canReadBriefing(briefingAccess(free, published, boundary)), true);
assert.equal(briefingAccess(pro, published, Date.parse(published)).kind, 'pro');
assert.equal(briefingAccess({ signedIn: false, isPro: true }, published, boundary - 1).kind, 'pro-required');
assert.equal(briefingReleaseAt(published), '2026-10-02T12:45:27.119Z');
for (const timestamp of [null, '', 'invalid']) {
  assert.equal(briefingAccess(free, timestamp, boundary).kind, 'pro-required');
  assert.equal(briefingReleaseAt(timestamp), null);
}
assert.equal(briefingAccess(free, published, NaN).kind, 'pro-required');
// Seven real days across a UK DST transition, independent of locale/session.
assert.equal(briefingReleaseAt('2026-10-23T12:00:00+01:00'), '2026-10-30T11:00:00.000Z');
assert.equal(briefingReleaseAt('2026-02-27T12:00:00Z'), '2026-03-06T12:00:00.000Z');
console.log('Briefing access: exact inclusive boundary, UTC/DST/weekends, auth, Pro and invalid timestamp checks passed.');
