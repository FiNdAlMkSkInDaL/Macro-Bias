/** Distribution reuses the briefing's editorial voice and facts; no second model call. */
export type DistributionMarket = 'stocks' | 'crypto';
export type DistributionChannel = 'bluesky' | 'threads';
export const DISTRIBUTION_CAMPAIGN = 'mb_distribution_v1';
export const CHART_DISTRIBUTION_CAMPAIGN = 'mb_chart_distribution_v1';
export const DISTRIBUTION_ORIGIN = 'https://www.macro-bias.com';

export function isDistributionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function distributionDestination(channel: string, market: string, date: string, chart = false): URL | null {
  if (!['bluesky', 'threads'].includes(channel) || !['stocks', 'crypto'].includes(market) || !isDistributionDate(date)) return null;
  const url = new URL(market === 'crypto' ? '/crypto' : chart ? '/today' : '/', DISTRIBUTION_ORIGIN);
  url.searchParams.set('utm_source', channel);
  url.searchParams.set('utm_medium', 'social');
  url.searchParams.set('utm_campaign', chart ? CHART_DISTRIBUTION_CAMPAIGN : DISTRIBUTION_CAMPAIGN);
  url.searchParams.set('utm_content', `${market}_${date}`);
  return url;
}

/** One slot per newsletter on weekdays. Freshness checks skip closed/missing sessions. */
export function scheduledDistributionMarkets(now: Date): DistributionMarket[] {
  return now.getUTCDay() >= 1 && now.getUTCDay() <= 5 ? ['stocks', 'crypto'] : [];
}

export function regimeExcerpt(content: string): string | null {
  const start = content.match(/^\s*(?:#{1,6}\s*)?(?:\*\*)?REGIME STATUS(?:\*\*)?\s*:\s*/i);
  if (!start) return null;
  const section = content.slice(start[0].length).split(/\n\s*(?:#{1,6}\s*)?(?:\*\*)?(?:TRADING IMPLICATION|BASE SCORE|WHY IT MATTERS|MODEL CONTEXT|MARKET MAP|RISK CHECK|RISK FRAME|MODEL NOTES)\b/i)[0];
  const text = section.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^Override active:\s*(?:COMMENTARY:\s*)?/i, '');
  // Keep the complete thought. Do not manufacture a fallback slogan or cut off its limitation.
  if (text.length < 40 || !/[.!?]$/.test(text) || /https?:|<[^>]+>|\bas an ai\b|\bunlock\b|\bsubscribe now\b|\bgame.changer\b|\bdon.t miss\b/i.test(text)) return null;
  return text;
}

export function buildDistributionPost(input: {
  market: DistributionMarket; channel: DistributionChannel; date: string;
  score: number; label: string; content: string;
  chart?: boolean;
  previous?: { date: string; score: number };
  overrideActive?: boolean;
}): string | null {
  if (!distributionDestination(input.channel, input.market, input.date) || !Number.isFinite(input.score)) return null;
  const excerpt = regimeExcerpt(input.content);
  if (!excerpt) return null;
  const date = new Date(`${input.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const label = input.label.toLowerCase().replace(/_/g, ' ');
  if (!/^(extreme )?risk (on|off)$|^neutral$/.test(label)) return null;
  const horizon = input.market === 'crypto' ? 'close' : 'reading';
  const score = input.score > 0 ? `+${input.score}` : String(input.score);
  const link = `${DISTRIBUTION_ORIGIN}/go/${input.chart ? 'chart/' : ''}${input.channel}/${input.market}/${input.date}`;
  const text = `${excerpt}\n\n${input.market === 'crypto' ? 'Crypto' : 'Stocks'} · ${date} ${horizon}. Model: ${label} (${score}).\n${link}`;
  const length = [...new Intl.Segmenter().segment(text)].length;
  if (length <= (input.channel === 'bluesky' ? 300 : 500)) return text;
  // A complete source paragraph can exceed platform limits. Describe the real
  // chart instead, retaining the limitation; never truncate an editorial caveat.
  if (!input.chart || !input.previous || !isDistributionDate(input.previous.date) || input.previous.date >= input.date || !Number.isFinite(input.previous.score) || Math.abs(input.previous.score) > 100) return null;
  const previousDate = new Date(`${input.previous.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const previous = input.previous.score > 0 ? `+${input.previous.score}` : String(input.previous.score);
  const short = `${input.market === 'crypto' ? 'Crypto' : 'Stocks'} · ${date} ${horizon}.\nThe model score went from ${previous} (${previousDate}) to ${score}: ${label}.\n${input.overrideActive ? 'News override active; chart shows the base model.' : 'Market context, not a prediction of the next move.'}\n${link}`;
  return [...new Intl.Segmenter().segment(short)].length <= (input.channel === 'bluesky' ? 300 : 500) ? short : null;
}
