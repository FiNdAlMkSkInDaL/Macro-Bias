import { resolveAcquisitionRange, type AcquisitionFilters } from './acquisition-data';

type Search = URLSearchParams | Record<string, string | string[] | undefined>;

export function parseAcquisitionFilters(search: Search): AcquisitionFilters {
  const value = (key: string) => search instanceof URLSearchParams ? search.get(key) : Array.isArray(search[key]) ? search[key][0] : search[key];
  const preset = value('preset') ?? '30d';
  const touch = value('touch') ?? 'first';
  if (!['7d', '30d', '90d', 'custom'].includes(preset) || !['first', 'latest'].includes(touch)) throw new Error('Choose a valid reporting period and attribution view.');
  const dimension = (key: string) => {
    const raw = value(key);
    if (!raw || raw === 'all') return undefined;
    if (raw.length > 128 || /[\u0000-\u001f\u007f@]/.test(raw)) throw new Error('Choose a valid source or campaign.');
    return raw;
  };
  const filters: AcquisitionFilters = {
    preset: preset as AcquisitionFilters['preset'], touch: touch as AcquisitionFilters['touch'],
    start: value('start') ?? undefined, end: value('end') ?? undefined,
    source: dimension('source'), campaign: dimension('campaign'),
  };
  resolveAcquisitionRange(filters);
  return filters;
}
