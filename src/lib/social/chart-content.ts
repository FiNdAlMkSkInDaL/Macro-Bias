import type { PaidBriefingArchiveItem } from '@/lib/product/paid-briefing-data';
import { isDistributionDate, type DistributionMarket } from './distribution-content';

export type PublishedChart = {
  market: DistributionMarket;
  date: string;
  score: number;
  label: string;
  overrideActive: boolean;
  points: { date: string; score: number }[];
  alt: string;
};

/** Only publication metadata is eligible. No paid prose or unissued model rows. */
export function buildPublishedChart(market: DistributionMarket, date: string, items: PaidBriefingArchiveItem[], now = Date.now()): PublishedChart | null {
  if (!isDistributionDate(date) || date > new Date(now).toISOString().slice(0, 10)) return null;
  const valid = items.filter(item => isDistributionDate(item.date) && item.date <= date
    && item.score !== null && Number.isFinite(item.score) && Math.abs(item.score) <= 100
    && /^(EXTREME_)?RISK_(ON|OFF)$|^NEUTRAL$/.test(item.biasLabel)
    && item.publishedAt && Number.isFinite(Date.parse(item.publishedAt)) && Date.parse(item.publishedAt) <= now);
  const unique = new Map(valid.map(item => [item.date, item]));
  const target = unique.get(date);
  if (!target || target.score === null) return null;
  const points = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-30)
    .map(item => ({ date: item.date, score: item.score! }));
  const label = target.biasLabel.replace(/_/g, ' ').toLowerCase();
  return { market, date, score: target.score, label: target.biasLabel, overrideActive: target.overrideActive === true, points,
    alt: `${market === 'stocks' ? 'Stock' : 'Crypto'} published model readings from ${points[0].date} to ${date}. Latest: ${target.score > 0 ? '+' : ''}${target.score}, ${label}. Fixed scale -100 to +100; points use actual session dates. ${target.overrideActive ? 'News override active; the line shows the base model.' : 'A market context measure, not a forecast or a price chart.'}` };
}
