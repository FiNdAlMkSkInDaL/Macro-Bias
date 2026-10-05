import type { PaidBriefingArchiveItem } from '@/lib/product/paid-briefing-data';

export type PublishedScore = {
  tradeDate: string;
  score: number;
  biasLabel: string;
};

export type PublishedReading = PublishedScore & {
  briefingHref: string | null;
  publishedAt: string | null;
  freeAvailableAt: string | null;
  briefingStatus: 'published' | 'missing' | 'unavailable';
};

/** Stock readings use briefing_date; crypto readings use the briefing's trade_date. */
export function publishedReadingLinks(
  asset: 'stocks' | 'crypto',
  scores: PublishedScore[],
  briefings: PaidBriefingArchiveItem[],
  briefingLoadError: string | null,
): PublishedReading[] {
  const byDate = new Map<string, PaidBriefingArchiveItem>();
  for (const briefing of briefings) {
    if (!byDate.has(briefing.date)) byDate.set(briefing.date, briefing);
  }

  const basePath = asset === 'stocks' ? '/briefings' : '/crypto/briefings';
  return scores.map((score) => {
    const briefing = briefingLoadError ? undefined : byDate.get(score.tradeDate);
    return {
      tradeDate: score.tradeDate,
      score: score.score,
      biasLabel: score.biasLabel,
      briefingHref: briefing ? `${basePath}/${briefing.date}` : null,
      publishedAt: briefing?.publishedAt ?? null,
      freeAvailableAt: briefing?.freeAvailableAt ?? null,
      briefingStatus: briefing ? 'published' : briefingLoadError ? 'unavailable' : 'missing',
    };
  });
}
