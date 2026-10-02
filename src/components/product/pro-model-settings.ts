import 'server-only';

import { CRYPTO_ANALOG_MODEL_SETTINGS, CRYPTO_MODEL_VERSION } from '@/lib/crypto-bias/constants';
import { ANALOG_MODEL_SETTINGS, MODEL_VERSION, STOCKS_KNN_FEATURE_KEYS } from '@/lib/macro-bias/constants';
import { CRYPTO_STRATEGY_RULES, STOCKS_STRATEGY_RULES } from '@/lib/signal/strategy';
import type { ProDiagnostics } from './ProWorkspace';

type Settings = ProDiagnostics['settings'];

export const STOCK_MODEL_SETTINGS: Settings = [
  { label: 'Current model version', value: MODEL_VERSION },
  { label: 'History window', value: 'Up to 10 calendar years', description: 'Actual coverage depends on aligned stored price history.' },
  { label: 'Historical matching', value: 'Cosine distance on standardized features' },
  { label: 'Features used for distance', value: STOCKS_KNN_FEATURE_KEYS.join(', ') },
  { label: 'Scoring neighbors', value: `${ANALOG_MODEL_SETTINGS.adaptiveKHighVix} or ${ANALOG_MODEL_SETTINGS.adaptiveKLowVix}`, description: 'The current model adapts the count using its saved VIX state. The comparison table displays at most five complete rows.' },
  { label: 'Temporal decay', value: `λ = ${ANALOG_MODEL_SETTINGS.temporalDecayLambda}`, description: 'Older historical matches carry less influence.' },
  { label: 'Forward-return blend', value: `${Math.round(ANALOG_MODEL_SETTINGS.oneDayBlendWeight * 100)}% next 1 session / ${Math.round(ANALOG_MODEL_SETTINGS.threeDayBlendWeight * 100)}% next 3 sessions`, description: 'Matched returns are close-to-close; the comparison table separately shows following-session gap, open-to-close and range.' },
  { label: 'Level-feature comparison', value: `${ANALOG_MODEL_SETTINGS.percentileWindowSessions}-session percentile window`, description: `Requires at least ${ANALOG_MODEL_SETTINGS.percentileMinHistorySessions} prior sessions.` },
  { label: 'Minimum historical pool', value: `${ANALOG_MODEL_SETTINGS.minimumHistoricalAnalogs} sessions` },
  { label: 'Minimum match-date gap', value: `${ANALOG_MODEL_SETTINGS.minAnalogCalendarGapDays} calendar days` },
  { label: 'Neutral permission range', value: `Absolute score ≤ ${STOCKS_STRATEGY_RULES.scoreThreshold}`, description: 'Other model rejection checks can also withhold a directional call.' },
  { label: 'Distance rejection threshold', value: `${STOCKS_STRATEGY_RULES.maxMeanNeighborDistance}` },
  { label: 'Agreement reference threshold', value: `${Math.round(STOCKS_STRATEGY_RULES.minNeighborAgreement * 100)}%`, description: 'Reliability combines agreement with match closeness; this is not a win-probability threshold.' },
  { label: 'Backtest friction', value: `${STOCKS_STRATEGY_RULES.frictionBps} basis points per position change` },
  { label: 'Trend veto', value: ANALOG_MODEL_SETTINGS.enableTrendVeto ? 'Enabled' : 'Disabled' },
  { label: 'Monday score setting', value: ANALOG_MODEL_SETTINGS.skipMondayScores ? 'Neutral score / cash position' : 'No Monday dampener' },
  { label: 'Large-day adjustment', value: ANALOG_MODEL_SETTINGS.fadeBigDayEnabled ? `Enabled above ${ANALOG_MODEL_SETTINGS.fadeBigDayThresholdPct}% absolute SPY move` : 'Disabled' },
  { label: 'Overnight conflict check', value: ANALOG_MODEL_SETTINGS.overnightVetoEnabled ? `Enabled above ${ANALOG_MODEL_SETTINGS.overnightVetoThresholdPct}% gap` : 'Disabled' },
  { label: 'Low match-return dispersion', value: ANALOG_MODEL_SETTINGS.flatLowNeighborVolEnabled ? `Cash check below ${ANALOG_MODEL_SETTINGS.flatLowNeighborVolThreshold}` : 'Disabled' },
  { label: 'Overnight adjustment', value: ANALOG_MODEL_SETTINGS.softOvernightAmpEnabled ? 'Enabled' : 'Disabled' },
  { label: 'Two-arm no-decay agreement', value: ANALOG_MODEL_SETTINGS.dualNoDecayAgreeEnabled ? 'Enabled' : 'Disabled' },
];

export const CRYPTO_MODEL_SETTINGS: Settings = [
  { label: 'Current model version', value: CRYPTO_MODEL_VERSION },
  { label: 'History window', value: 'Up to 10 calendar years', description: 'Actual coverage depends on overlapping BTC, ETH and carried-forward macro price history.' },
  { label: 'Historical matching', value: 'Euclidean distance on standardized features' },
  { label: 'Feature set', value: 'BTC RSI, ETH/BTC, BTC/GLD, DXY momentum, BTC realized volatility, TLT momentum' },
  { label: 'Scoring neighbors', value: `${CRYPTO_ANALOG_MODEL_SETTINGS.nearestNeighborCount}`, description: `Maximum ${CRYPTO_ANALOG_MODEL_SETTINGS.maxNeighborCount} saved matches.` },
  { label: 'Temporal decay', value: `λ = ${CRYPTO_ANALOG_MODEL_SETTINGS.temporalDecayLambda}`, description: 'Older historical matches carry less influence.' },
  { label: 'Forward-return blend', value: `${Math.round(CRYPTO_ANALOG_MODEL_SETTINGS.oneDayBlendWeight * 100)}% next 1 session / ${Math.round(CRYPTO_ANALOG_MODEL_SETTINGS.threeDayBlendWeight * 100)}% next 3 sessions`, description: 'BTC close-to-close returns over aligned daily sessions, including weekends.' },
  { label: 'Score mapping', value: `tanh × 100; return scale ${CRYPTO_ANALOG_MODEL_SETTINGS.blendedReturnScale}` },
  { label: 'Level-feature comparison', value: `${CRYPTO_ANALOG_MODEL_SETTINGS.percentileWindowSessions}-session percentile window`, description: `Requires at least ${CRYPTO_ANALOG_MODEL_SETTINGS.percentileMinHistorySessions} prior sessions.` },
  { label: 'BTC realized volatility', value: `${CRYPTO_ANALOG_MODEL_SETTINGS.btcRealizedVolWindow}-session window` },
  { label: 'Dollar / Treasury momentum', value: `${CRYPTO_ANALOG_MODEL_SETTINGS.dxyMomentumLookbackSessions} / ${CRYPTO_ANALOG_MODEL_SETTINGS.tltMomentumLookbackSessions} sessions` },
  { label: 'Minimum historical pool', value: `${CRYPTO_ANALOG_MODEL_SETTINGS.minimumHistoricalAnalogs} sessions` },
  { label: 'Minimum match-date gap', value: `${CRYPTO_ANALOG_MODEL_SETTINGS.minAnalogCalendarGapDays} calendar days` },
  { label: 'Neutral permission range', value: `Absolute score ≤ ${CRYPTO_STRATEGY_RULES.scoreThreshold}`, description: 'Other model rejection checks can also withhold a directional call.' },
  { label: 'Distance rejection threshold', value: `${CRYPTO_STRATEGY_RULES.maxMeanNeighborDistance}` },
  { label: 'Agreement reference threshold', value: `${Math.round(CRYPTO_STRATEGY_RULES.minNeighborAgreement * 100)}%`, description: 'Reliability combines agreement with match closeness; this is not a win-probability threshold.' },
  { label: 'Backtest friction', value: `${CRYPTO_STRATEGY_RULES.frictionBps} basis points per position change` },
  { label: 'Trend veto', value: CRYPTO_ANALOG_MODEL_SETTINGS.enableTrendVeto ? 'Enabled' : 'Disabled' },
];
