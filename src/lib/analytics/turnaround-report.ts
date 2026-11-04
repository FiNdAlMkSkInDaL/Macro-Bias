import 'server-only';
import { getAcquisitionReport } from './acquisition-data';

export const TURNAROUND = {
  campaign: 'mb_acquisition_turnaround_20261104',
  start: '2026-11-04', end: '2026-11-17', reviewDate: '2026-11-18',
  targets: { identifiedVisitors: 100, uniqueSubscribers: 10, stocks: 5, crypto: 5 },
  resources: ['/learn', '/intel/spy-vs-qqq-divergence', '/intel/bitcoin-ethereum-divergence'],
} as const;

/** Observational acquisition report, never a claim that simultaneous changes caused growth. */
export async function getTurnaroundReport(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (today < TURNAROUND.start) return { phase: 'before_start' as const, capturedAt: now.toISOString(), policy: TURNAROUND, first: null, latestAssist: null, resourceEntries: null };
  const end = today < TURNAROUND.end ? today : TURNAROUND.end;
  const dates = { preset: 'custom' as const, start: TURNAROUND.start, end };
  const [first, latest, all] = await Promise.all([
    getAcquisitionReport({ ...dates, campaign: TURNAROUND.campaign, touch: 'first' }, undefined, now),
    getAcquisitionReport({ ...dates, campaign: TURNAROUND.campaign, touch: 'latest' }, undefined, now),
    getAcquisitionReport({ ...dates, touch: 'first' }, undefined, now),
  ]);
  const view = (report: typeof first) => ({ complete: report.coverage.complete, range: report.range,
    metrics: report.coverage.complete ? report.overview : null, newsletters: report.coverage.complete ? report.newsletterSignups : null,
    sources: report.coverage.complete ? report.sourceRows : null,
    contents: report.coverage.complete ? report.contentRows : null,
    attributionContents: report.coverage.complete ? report.attributionContentRows : null,
    coverage: report.coverage, freshness: report.freshness });
  return { phase: today > TURNAROUND.end ? 'ended' as const : 'running' as const, capturedAt: now.toISOString(), policy: TURNAROUND,
    first: view(first), latestAssist: view(latest),
    resourceEntries: { complete: all.coverage.complete, range: all.range,
      rows: all.coverage.complete ? all.landingRows.filter(r => TURNAROUND.resources.some(path => path === r.key)) : null,
      note: 'First-entry pages across all sources, including organic search and tagged visits. This overlaps the campaign report; do not add the two or sum distinct visitors across rows.' } };
}
