import 'server-only';

import type { LiveVsHistoryCockpitData } from './live-vs-history';

export type TrustCheckStatus = 'pattern_intact' | 'pattern_shaky' | 'pattern_broken';
export type TrustCheckTone = 'positive' | 'warning' | 'negative';

export type TrustCheckFactor = {
  label: string;
  summary: string;
  tone: TrustCheckTone;
  value: string;
};

export type PromotedTrustCheckData = {
  asOf: string | null;
  confidenceScore: number | null;
  factors: TrustCheckFactor[];
  headline: string;
  reason: string;
  status: TrustCheckStatus;
  summary: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function getNewsPenalty(
  trustAdjustment: LiveVsHistoryCockpitData['news']['trustAdjustment'],
) {
  if (trustAdjustment === 'heavily_reduced') {
    return 0.34;
  }

  if (trustAdjustment === 'reduced') {
    return 0.16;
  }

  return 0;
}

function getStatus(score: number, patternValidity: LiveVsHistoryCockpitData['news']['patternValidity']) {
  if (patternValidity === 'broken') {
    return 'pattern_broken' as const;
  }

  if (patternValidity === 'shaky' || score < 0.66) {
    return score >= 0.46 ? ('pattern_shaky' as const) : ('pattern_broken' as const);
  }

  return score >= 0.66 ? ('pattern_intact' as const) : ('pattern_shaky' as const);
}

function buildHeadline(status: TrustCheckStatus) {
  if (status === 'pattern_intact') {
    return 'Pattern intact';
  }

  if (status === 'pattern_shaky') {
    return 'Pattern shaky';
  }

  return 'Pattern broken';
}

function buildSummary(status: TrustCheckStatus) {
  if (status === 'pattern_intact') {
    return 'The score deserves real weight today. The regime read is lining up well enough that the model should be part of the plan, not just background context.';
  }

  if (status === 'pattern_shaky') {
    return 'The score still has information in it, but the setup is not clean enough to lean on aggressively. Use it as context and let price action confirm the read.';
  }

  return 'The score is background only today. Something in the current setup is strong enough that the historical pattern should not be trusted on its own.';
}

function buildReason(
  status: TrustCheckStatus,
  input: {
    analogConsensus: number | null;
    clusterAgreement: number | null;
    patternValidity: LiveVsHistoryCockpitData['news']['patternValidity'];
  },
) {
  if (status === 'pattern_broken') {
    if (input.patternValidity === 'broken') {
      return 'Fresh news is outweighing the normal historical read, so the model should wait for the tape to settle before it earns trust back.';
    }

    return 'The analogs are not coherent enough to trust the pattern right now, even before adding more conviction from the tape.';
  }

  if (status === 'pattern_shaky') {
    return 'There is some agreement in the historical read, but not enough to treat it as a high-conviction setup without confirmation.';
  }

  if ((input.analogConsensus ?? 0) >= 0.7 && (input.clusterAgreement ?? 0) >= 0.67) {
    return 'The nearest analogs and the broader regime assignment are lining up, which is exactly what we want to see on a trustworthy day.';
  }

  return 'The broader setup is behaving well enough to trust, but it is not a perfect signal.';
}

export function buildPromotedTrustCheck(
  cockpit: LiveVsHistoryCockpitData,
): PromotedTrustCheckData {
  const confidence = cockpit.regime?.confidencePreview ?? null;
  const analogConsensus = confidence?.analogAgreement.directionConsensus3Day ?? null;
  const clusterConcentration = confidence?.analogAgreement.clusterConcentration ?? null;
  const signalStrength = confidence?.signalStrength.normalizedMagnitude ?? null;
  const clusterDistance = confidence?.clusterFit.currentClusterDistance ?? null;
  const windowAgreement = cockpit.health?.currentClusterWindowAgreement ?? null;
  const separation = cockpit.health?.nearestClusterSeparation ?? null;

  const signalComponent = signalStrength == null ? 0.42 : clamp(signalStrength, 0, 1);
  const analogComponent = analogConsensus == null ? 0.45 : clamp(analogConsensus, 0, 1);
  const clusterComponent = clusterConcentration == null ? 0.45 : clamp(clusterConcentration, 0, 1);
  const windowComponent = windowAgreement == null ? 0.45 : clamp(windowAgreement, 0, 1);
  const fitComponent =
    clusterDistance == null ? 0.45 : clamp(1 - clusterDistance / 1.5, 0, 1);
  const separationComponent =
    separation == null ? 0.45 : clamp(separation / 1.5, 0, 1);

  const rawScore =
    signalComponent * 0.2 +
    analogComponent * 0.24 +
    clusterComponent * 0.18 +
    windowComponent * 0.18 +
    fitComponent * 0.1 +
    separationComponent * 0.1;

  const confidenceScore = clamp(rawScore - getNewsPenalty(cockpit.news.trustAdjustment), 0, 1);
  const status = getStatus(confidenceScore, cockpit.news.patternValidity);

  const leadingLens = cockpit.crossSectional?.leadingLenses[0] ?? null;

  const factors: TrustCheckFactor[] = [
    {
      label: 'Analog agreement',
      value: analogConsensus == null ? 'n/a' : formatPercent(analogConsensus),
      tone: (analogConsensus ?? 0) >= 0.68 ? 'positive' : (analogConsensus ?? 0) >= 0.5 ? 'warning' : 'negative',
      summary:
        analogConsensus == null
          ? 'Nearest analog agreement is not available yet.'
          : analogConsensus >= 0.68
            ? 'The nearest historical matches are mostly pointing in the same direction.'
            : analogConsensus >= 0.5
              ? 'The analog set is giving a mixed read rather than a clean one.'
              : 'The analog set is too split to trust aggressively.',
    },
    {
      label: 'Regime stability',
      value: windowAgreement == null ? 'n/a' : formatPercent(windowAgreement),
      tone: (windowAgreement ?? 0) >= 0.67 ? 'positive' : (windowAgreement ?? 0) >= 0.5 ? 'warning' : 'negative',
      summary:
        windowAgreement == null
          ? 'Window-agreement diagnostics are not available yet.'
          : windowAgreement >= 0.67
            ? 'The regime assignment is holding together across alternate windows.'
            : windowAgreement >= 0.5
              ? 'The regime label is usable, but not fully stable.'
              : 'The regime label is shifting too much across windows to trust fully.',
    },
    {
      label: 'News disruption',
      value: cockpit.news.patternValidity.replaceAll('_', ' '),
      tone:
        cockpit.news.patternValidity === 'intact'
          ? 'positive'
          : cockpit.news.patternValidity === 'shaky'
            ? 'warning'
            : 'negative',
      summary:
        cockpit.news.patternValidity === 'intact'
          ? 'The headline set looks routine enough that it is not obviously breaking the pattern.'
          : cockpit.news.patternValidity === 'shaky'
            ? 'The news backdrop is weakening the pattern, even if it has not fully broken it.'
            : 'Fresh headlines are strong enough that they should override the normal historical read.',
    },
  ];

  if (leadingLens) {
    factors.push({
      label: 'Best expression',
      value: formatSignedPercent(leadingLens.averageExcessReturn),
      tone: 'warning',
      summary: `${leadingLens.label} is the cleanest expression in the current regime, which is more useful than forcing an index-level view.`,
    });
  }

  return {
    asOf: cockpit.bias?.tradeDate ?? cockpit.regime?.currentSnapshot?.tradeDate ?? null,
    confidenceScore: roundTo(confidenceScore * 100),
    factors,
    headline: buildHeadline(status),
    reason: buildReason(status, {
      analogConsensus,
      clusterAgreement: windowAgreement,
      patternValidity: cockpit.news.patternValidity,
    }),
    status,
    summary: buildSummary(status),
  };
}

function roundTo(value: number, decimals = 0) {
  return Number(value.toFixed(decimals));
}
