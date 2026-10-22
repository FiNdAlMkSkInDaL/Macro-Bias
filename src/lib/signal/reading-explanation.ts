import type { TradableSignal } from './types';

/** A public, coarse explanation; never includes paid sizing or diagnostics. */
export type ReadingExplanation = {
  status: 'withheld' | 'neutral' | 'unavailable' | 'directional';
  title: string;
  reason: string;
};

export function explainReading(score: number, signal?: TradableSignal | null): ReadingExplanation {
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
