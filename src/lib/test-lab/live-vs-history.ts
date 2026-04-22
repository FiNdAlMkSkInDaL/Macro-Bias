import 'server-only';

import { getLatestBriefing } from '@/lib/briefing/get-public-briefing';
import { getLatestBiasSnapshot } from '@/lib/market-data/get-latest-bias-snapshot';

import { getCrossSectionalPreviewData } from './cross-sectional';
import { getNewsLabPreview } from './news';
import { getRegimeResearchMatrix } from './regime-map';

export type LiveVsHistoryCockpitData = {
  bias: {
    biasLabel: string;
    score: number;
    tickerMoves: Array<{
      close: number;
      percentChange: number;
      ticker: string;
    }>;
    tradeDate: string;
  } | null;
  briefing: {
    generatedAt: string;
    isOverrideActive: boolean;
    newsSummary: string;
    tradeDate: string;
  } | null;
  crossSectional: Awaited<ReturnType<typeof getCrossSectionalPreviewData>>;
  health: {
    clusterCohesion: number;
    currentClusterWindowAgreement: number | null;
    nearestClusterSeparation: number;
  } | null;
  news: Awaited<ReturnType<typeof getNewsLabPreview>>;
  regime: Awaited<ReturnType<typeof getRegimeResearchMatrix>>;
};

export async function getLiveVsHistoryCockpitData(): Promise<LiveVsHistoryCockpitData> {
  const [snapshot, latestBriefing, regime, crossSectional, news] = await Promise.all([
    getLatestBiasSnapshot(),
    getLatestBriefing(),
    getRegimeResearchMatrix(),
    getCrossSectionalPreviewData(),
    getNewsLabPreview(),
  ]);

  return {
    bias: snapshot
      ? {
          score: snapshot.score,
          biasLabel: snapshot.bias_label,
          tradeDate: snapshot.trade_date,
          tickerMoves: Object.values(snapshot.ticker_changes ?? {})
            .map((change) => ({
              ticker: change.ticker,
              percentChange: change.percentChange,
              close: change.close,
            }))
            .sort((left, right) => Math.abs(right.percentChange) - Math.abs(left.percentChange)),
        }
      : null,
    briefing: latestBriefing
      ? {
          tradeDate: latestBriefing.trade_date,
          generatedAt: latestBriefing.generated_at,
          isOverrideActive: latestBriefing.is_override_active,
          newsSummary: latestBriefing.news_summary,
        }
      : null,
    regime,
    crossSectional,
    news,
    health: regime
      ? {
          clusterCohesion: regime.diagnostics.clusterCohesion,
          currentClusterWindowAgreement: regime.diagnostics.currentClusterWindowAgreement,
          nearestClusterSeparation: regime.diagnostics.nearestClusterSeparation,
        }
      : null,
  };
}
