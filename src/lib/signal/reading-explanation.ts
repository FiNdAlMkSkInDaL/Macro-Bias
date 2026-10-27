import type { TradableSignal } from './types';

/** A public, coarse explanation; never includes paid sizing or diagnostics. */
export type ReadingExplanation = {
  status: 'withheld' | 'neutral' | 'unavailable' | 'directional';
  title: string;
  reason: string;
  trade?: { title: string; reason: string };
};

export function explainReading(score: number, signal?: TradableSignal | null): ReadingExplanation {
  if (signal?.scoreContext?.semantics === 'daily_reading_v1') {
    const codes = new Set(signal.scoreContext.filters?.map(f => f.code) ?? []);
    const causes = [
      codes.has('low_variation') ? 'The low-variation check is active because the matched historical returns are tightly clustered.' : '',
      codes.has('monday_source') ? "The Monday source-session rule holds the trading decision flat. It applies to Monday's completed prices, including a reading published on Tuesday." : '',
      codes.has('large_move_fade') ? 'The trading layer adjusts for a large move in the last completed session.' : '',
      codes.has('overnight_amplifier') ? 'The trading layer adjusts for the opening gap in the completed source session.' : '',
      codes.has('overnight_conflict') ? 'A conflicting opening gap holds the trading decision flat.' : '',
    ].filter(Boolean);
    if (!causes.length) causes.push(signal.position === 'NO_TRADE'
      ? 'The trading checks reject the historical fit or agreement for a trade.'
      : signal.position === 'FLAT' ? 'The trading threshold has not been met.'
        : 'The trading checks permit a directional setup; that is separate from the daily market reading.');
    return { status: Math.abs(score) <= 20 ? 'neutral' : 'directional',
      title: score === 0 ? 'Balanced historical reading' : Math.abs(score) <= 20 ? 'Neutral historical reading' : score > 0 ? 'Upward historical lean' : 'Downward historical lean',
      reason: score === 0 ? 'The matched past returns balance near zero after rounding. This is a market reading, not a trading-filter result.'
        : Math.abs(score) <= 20 ? `The matched past sessions have a small ${score > 0 ? 'positive' : 'negative'} return tendency, within the neutral range. Trading checks are shown separately.`
          : `The matched past sessions have a ${score > 0 ? 'positive' : 'negative'} return tendency over the next one to three sessions. The reading is historical context, not a probability or a trade instruction.`,
      trade: { title: 'Trading filters', reason: causes.join(' ') + ' These checks do not change the daily score or its reading.' } };
  }
  const reason = signal?.reason ?? '';
  const codes = Array.isArray(signal?.scoreContext?.suppressedBy) ? signal.scoreContext.suppressedBy : [];
  const monday = codes.includes('monday') || /Monday (?:publish )?dampener/i.test(reason);
  const lowVariation = codes.includes('low_variation') || /low neighbor-vol flat/i.test(reason);
  const overnight = codes.includes('overnight_conflict');
  const title = 'No clear directional signal';
  if (monday || lowVariation || overnight) {
    const causes = [
      monday ? "A scheduled rule withholds directional readings based on Monday's session." : '',
      lowVariation ? 'The low-variation filter has withheld this reading: the matched historical returns are too tightly clustered under its rule.' : '',
      overnight ? 'The overnight price gap conflicts with the historical lean, so the model withholds the directional reading.' : '',
    ].filter(Boolean).join(' ');
    return { status: 'withheld', title, reason: `${causes} Zero here does not mean prices were unchanged.` };
  }
  if (signal?.noTrade || signal?.position === 'NO_TRADE') {
    const cause = /No historical analogs|legacy score without/i.test(reason)
      ? 'The historical evidence needed to assess this reading is unavailable.'
      : /cluster is too loose/i.test(reason)
        ? "Today's conditions are too different from the matched past sessions for a reliable directional reading."
        : /override/i.test(reason) ? 'An external event override has suspended the model reading.'
          : score === 0 ? 'The model did not publish a directional call. Its stored diagnostics do not distinguish a balanced estimate from a suppressed score.'
            : 'The matched historical outcomes do not provide enough agreement for a directional call.';
    return { status: 'withheld', title, reason: cause };
  }
  if (signal?.position === 'FLAT') {
    return { status: 'neutral', title, reason: /trend\/vol ensemble/i.test(reason)
      ? 'The historical lean conflicts with the trend and volatility checks, so the model stays neutral.'
      : 'The historical reading is inside the neutral range. It does not show a strong enough upward or downward lean.' };
  }
  if (!signal && Math.abs(score) <= 20) {
    return { status: 'unavailable', title, reason: 'The published score is near zero. The stored reason for any filtering is unavailable for this reading.' };
  }
  return { status: 'directional', title: score > 0 ? 'Upward historical lean' : 'Downward historical lean',
    reason: 'The historical model has a directional lean. This is context, not a promise about the next move.' };
}
