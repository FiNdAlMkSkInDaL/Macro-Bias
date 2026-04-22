export const CURRENT_STOCKS_ANALOG_FEATURES = [
  {
    key: 'spyRsi',
    label: 'SPY RSI',
    pillar: 'Trend and Momentum',
    whyItExists: 'Captures directional pressure and whether buyers or sellers still control the tape.',
  },
  {
    key: 'gammaExposure',
    label: 'Dealer Gamma Exposure',
    pillar: 'Positioning',
    whyItExists: 'Approximates whether options positioning should dampen or amplify moves.',
  },
  {
    key: 'hygTltRatio',
    label: 'HYG / TLT',
    pillar: 'Credit and Risk Spreads',
    whyItExists: 'Measures risk appetite through credit versus duration.',
  },
  {
    key: 'cperGldRatio',
    label: 'CPER / GLD',
    pillar: 'Credit and Risk Spreads',
    whyItExists: 'Tracks cyclicality and growth sensitivity against defensive commodity demand.',
  },
  {
    key: 'usoMomentum',
    label: 'USO 5-Day Momentum',
    pillar: 'Credit and Risk Spreads',
    whyItExists: 'Captures energy impulse without overreacting to one daily print.',
  },
  {
    key: 'vixLevel',
    label: 'VIX Level',
    pillar: 'Volatility',
    whyItExists: 'Measures tape stress and expected range sensitivity.',
  },
] as const;

export const PROPOSED_REGIME_FEATURE_GROUPS = [
  {
    title: 'Core Analog Features',
    description: 'Keep the six current live-model features as the anchor so the regime map remains tied to the existing score.',
  },
  {
    title: 'Cross-Asset State',
    description: 'Add richer level and spread context from equities, rates, credit, commodities, and vol to describe market structure more fully.',
  },
  {
    title: 'Participation and Breadth',
    description: 'Add breadth and internal participation signals so the map can distinguish broad trends from narrow or fragile moves.',
  },
  {
    title: 'Range and Realized Volatility',
    description: 'Capture how noisy or compressed the tape is rather than relying only on spot vol level.',
  },
  {
    title: 'Regime Persistence Context',
    description: 'Track short trailing windows so we know whether a state is new, maturing, or already decaying.',
  },
  {
    title: 'Structured News Disruption',
    description: 'Keep this separate from the core score but available as a trust-layer input when the news backdrop meaningfully diverges from history.',
  },
] as const;

export const REGIME_MAP_FIRST_DATA_DELIVERABLES = [
  'A normalized daily feature snapshot record keyed by trade date.',
  'A clean separation between raw inputs, engineered features, and clustering artifacts.',
  'Versioned embedding outputs so we can compare mapping approaches without overwriting history.',
  'Stored nearest-neighbor relationships for auditability and explainability.',
  'A regime-cluster summary table with sample count, average forward returns, and volatility profile.',
] as const;
