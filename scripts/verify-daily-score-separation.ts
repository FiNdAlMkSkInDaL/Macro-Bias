/** Semantic regression tests: no network, DB mutations, subscribers or sends. */
import assert from 'node:assert/strict';
import { calculateDailyBias, selectNeighborK } from '../src/lib/macro-bias/calculate-daily-bias';
import { calculateCryptoDailyBias } from '../src/lib/crypto-bias/calculate-crypto-bias';
import { explainReading } from '../src/lib/signal/reading-explanation';
import { positionFromSignal, STOCKS_STRATEGY_RULES } from '../src/lib/signal';
import type { DailyBiasInput, HistoricalAnalogVector } from '../src/lib/macro-bias/types';
import type { CryptoDailyBiasInput } from '../src/lib/crypto-bias/types';

const history: HistoricalAnalogVector[] = Array.from({ length: 60 }, (_, i) => ({
  tradeDate: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
  vector: { spyRsi: 40 + i % 25, vixMomentum: i % 7, hygTltRatio: 20 + i % 65, cperGldRatio: 10 + i % 80, usoMomentum: -3 + i % 8, vixLevel: i % 100 },
  spyForward1DayReturn: 2, spyForward3DayReturn: 3,
}));
const input = (date = '2026-10-27', value = 2): DailyBiasInput => ({ tradeDate: date,
  tickerChanges: { SPY: { ticker: 'SPY', tradeDate: date, close: 100, previousClose: 100, open: 100, percentChange: 0 }, TLT: { close: 100 }, GLD: { close: 100 } } as DailyBiasInput['tickerChanges'],
  expandedData: { spy14DayRsi: 52, vixMomentum: 1, uso5DayMomentum: 2, hygTltRatioPercentile: 50, cperGldRatioPercentile: 50, vixLevelPercentile: 85,
    vix: { ticker: '^VIX', tradeDate: date, close: 18, previousClose: 18, percentChange: 0 },
    historicalAnalogVectors: history.map(h => ({ ...h, spyForward1DayReturn: value, spyForward3DayReturn: value * 1.5 })) } });

const positive = calculateDailyBias(input());
assert(positive.score > 60); assert.equal(positive.label, 'EXTREME_RISK_ON');
assert.equal(positive.signal.scoreContext?.tradeScore, 0);
assert.equal(positionFromSignal(positive.signal, positive.score, STOCKS_STRATEGY_RULES), 'CASH');
assert(positive.signal.scoreContext?.filters?.some(f => f.code === 'low_variation'));
assert.equal(positive.componentScores.reduce((n, c) => n + c.contribution, 0), positive.score);
const monday = calculateDailyBias(input('2026-10-26'));
assert.equal(monday.score, positive.score); assert.equal(monday.label, positive.label);
assert.equal(monday.signal.scoreContext?.tradeScore, 0);
assert(monday.signal.scoreContext?.filters?.some(f => f.code === 'monday_source'));
assert.match(monday.signal.reason, /Monday source-session trade filter/);
const explanation = explainReading(monday.score, monday.signal);
assert.equal(explanation.status, 'directional'); assert.match(explanation.reason, /positive/);
assert.match(explanation.trade?.reason ?? '', /Monday's completed prices/);
assert(!/withheld|no clear directional/i.test(explanation.reason));
const negative = calculateDailyBias(input('2026-10-27', -2));
assert(negative.score < -60); assert.equal(negative.label, 'EXTREME_RISK_OFF');
const zero = calculateDailyBias(input('2026-10-27', 0));
assert.equal(zero.score, 0); assert.equal(zero.label, 'NEUTRAL');
assert.match(explainReading(zero.score, zero.signal).reason, /balance near zero/);

assert.equal(positive.signal.scoreContext?.vix?.neighborCount, 7);
const highVix = input(); highVix.expandedData!.vix!.close = 25; highVix.expandedData!.vixLevelPercentile = 10;
assert.equal(calculateDailyBias(highVix).signal.scoreContext?.vix?.neighborCount, 5);
assert.equal(selectNeighborK(19.99), 7); assert.equal(selectNeighborK(20), 5);
assert.throws(() => selectNeighborK(Number.NaN));
const missingVix = input(); delete missingVix.expandedData!.vix;
assert.throws(() => calculateDailyBias(missingVix), /raw VIX/);
const staleVix = input(); staleVix.expandedData!.vix!.tradeDate = '2026-10-26';
assert.throws(() => calculateDailyBias(staleVix), /source-session date/);
const missingPercentile = input(); delete missingPercentile.expandedData!.vixLevelPercentile;
assert.throws(() => calculateDailyBias(missingPercentile), /VIX trailing percentile/);
const future = input(); future.expandedData!.historicalAnalogVectors!.push({ ...history[0], tradeDate: '2027-01-01', spyForward1DayReturn: -50, spyForward3DayReturn: -50 });
assert.equal(calculateDailyBias(future).score, positive.score);

const c: CryptoDailyBiasInput = { tradeDate: '2026-10-26', tickerChanges: {} as CryptoDailyBiasInput['tickerChanges'],
  expandedData: { btc14DayRsi: 99, ethBtcRatioPercentile: 99, btcGldRatioPercentile: 99, dxyMomentum: 99, btcRealizedVolPercentile: 99, tltMomentum: 99,
    historicalAnalogVectors: history.map((h, i) => ({ tradeDate: h.tradeDate, vector: { btcRsi: 45 + i % 5, ethBtcRatio: 45 + i % 5, btcGldRatio: 45 + i % 5, dxyMomentum: i % 5, btcRealizedVol: 45 + i % 5, tltMomentum: i % 5 }, btcForward1DayReturn: 3, btcForward3DayReturn: 4 })) } };
const crypto = calculateCryptoDailyBias(c);
assert(crypto.score > 60); assert.equal(crypto.label, 'EXTREME_RISK_ON');
assert.equal(crypto.signal.position, 'NO_TRADE');
assert.equal(explainReading(crypto.score, crypto.signal).status, 'directional');
const futureCrypto = structuredClone(c); futureCrypto.expandedData!.historicalAnalogVectors!.push({ ...futureCrypto.expandedData!.historicalAnalogVectors![0], tradeDate: '2027-01-01', btcForward1DayReturn: -50, btcForward3DayReturn: -50 });
assert.equal(calculateCryptoDailyBias(futureCrypto).score, crypto.score);
console.log('PASS daily reading separation: positive/negative/true zero, Monday and low-variation holds, independent labels/permissions, component sums, raw VIX units/boundary/fail-closed inputs, crypto refusal without neutralizing the reading.');
