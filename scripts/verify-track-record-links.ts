import assert from 'node:assert/strict';

import { publishedReadingLinks } from '../src/lib/track-record/published-reading-links';
import type { PaidBriefingArchiveItem } from '../src/lib/product/paid-briefing-data';

const readings = [
  { tradeDate: '2026-09-30', score: 42, biasLabel: 'RISK_ON' },
  { tradeDate: '2026-09-29', score: -31, biasLabel: 'RISK_OFF' },
  { tradeDate: '2026-09-28', score: 8, biasLabel: 'NEUTRAL' },
];
const stockBriefing = {
  date: '2026-09-30', tradeDate: '2026-09-29', score: 42, biasLabel: 'RISK_ON',
  publishedAt: '2026-09-30T08:00:00Z', freeAvailableAt: '2026-10-07T08:00:00Z',
};

const stockRows = publishedReadingLinks('stocks', readings, [stockBriefing], null);
assert.equal(stockRows[0].briefingHref, '/briefings/2026-09-30', 'Stock score maps to real briefing_date despite prior source trade_date');
assert.equal(stockRows[1].briefingHref, null, 'Stock source bar date does not fabricate a second dated briefing');
assert.equal(stockRows[1].briefingStatus, 'missing');
assert.equal(stockRows[0].score, 42, 'A recent restricted briefing does not hide its public score');
assert.equal(stockRows[0].freeAvailableAt, '2026-10-07T08:00:00Z');
const scorelessArchive = publishedReadingLinks('stocks', readings, [{ ...stockBriefing, score: null, biasLabel: 'UNAVAILABLE' }], null);
assert.equal(scorelessArchive[0].briefingHref, '/briefings/2026-09-30', 'Confirmed publication still links when archive score metadata is missing');
assert.equal(scorelessArchive[0].score, 42, 'Track Record retains its actual published score independently of archive metadata');

const cryptoRows = publishedReadingLinks('crypto', readings, [{ ...stockBriefing, tradeDate: '2026-09-30' }], null);
assert.equal(cryptoRows[0].briefingHref, '/crypto/briefings/2026-09-30', 'Crypto uses its own dated route');
assert.equal(cryptoRows[1].briefingHref, null, 'Crypto never links an adjacent unpublished score to a different session');

const outageRows = publishedReadingLinks('stocks', readings, [stockBriefing], 'Archive unavailable');
assert.deepEqual(outageRows.map((row) => row.briefingHref), [null, null, null], 'An unsuccessful existence check cannot create links');
assert.deepEqual(outageRows.map((row) => row.score), [42, -31, 8], 'Briefing outage preserves every public score');
assert.ok(outageRows.every((row) => row.briefingStatus === 'unavailable'));

const restrictedSource = { ...stockBriefing, content: 'private briefing body', news: 'private headlines', model: 'private model payload' };
const projected = publishedReadingLinks('stocks', readings, [restrictedSource as PaidBriefingArchiveItem], null);
assert.ok(!JSON.stringify(projected).includes('private'), 'Track Record output never carries restricted fields from a source object');
assert.deepEqual(Object.keys(projected[0]).sort(), ['biasLabel', 'briefingHref', 'briefingStatus', 'freeAvailableAt', 'publishedAt', 'score', 'tradeDate'].sort());

console.log('Track Record links: exact stock/crypto dates, missing publication, public scores during archive outage, and safe metadata projection passed.');
