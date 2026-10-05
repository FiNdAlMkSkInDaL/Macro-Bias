'use client';

import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import type { AcquisitionBreakdown, AcquisitionReport } from '@/lib/analytics/acquisition-data';
import { normalizeDimension } from '@/lib/analytics/attribution';

import styles from './analytics.module.css';

type View = 'overview' | 'sources' | 'campaigns' | 'landings';
type Metric = 'visitors' | 'newSubscribers' | 'newAccounts' | 'paidConversions' | 'sessions' | 'pageViews';
type Availability = { events: boolean; subscribers: boolean; accounts: boolean; linkedRates: boolean };
type FilterUpdate = Record<string, string | null>;
const VIEWS: { key: View; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'sources', label: 'Sources' },
  { key: 'campaigns', label: 'Campaigns' }, { key: 'landings', label: 'Landing pages' },
];
const METRICS: { key: Metric; label: string; color: string }[] = [
  { key: 'visitors', label: 'Tracked visitors', color: '#d7ff83' },
  { key: 'newSubscribers', label: 'New subscribers', color: '#f2f5f3' },
  { key: 'newAccounts', label: 'New accounts', color: '#8fb6a0' },
  { key: 'paidConversions', label: 'New paying members', color: '#bbd3f0' },
  { key: 'sessions', label: 'Sessions', color: '#c4bea5' },
  { key: 'pageViews', label: 'Page views', color: '#a29aac' },
];
const numberFormat = new Intl.NumberFormat('en-GB');
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const utcDateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const localDateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London', timeZoneName: 'short' });
const sourceLabels: Record<string, string> = { x: 'X', twitter: 'X', reddit: 'Reddit', google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', gmail: 'Gmail app', threads: 'Threads', bluesky: 'Bluesky', direct: 'Direct', unknown: 'Unknown' };

function displaySource(value = 'unknown') { return sourceLabels[value] ?? value; }
function displayCampaign(value?: string) { return !value || value === '(none)' ? 'No campaign recorded' : value; }
function count(value: number, available = true) { return available ? numberFormat.format(value) : 'N/A'; }
function percent(value: number | null, available = true) { return available && value !== null ? `${value.toFixed(1)}%` : 'N/A'; }
function metricAvailable(key: Metric, available: Availability) {
  return key === 'newSubscribers' ? available.subscribers : key === 'newAccounts' ? available.accounts : available.events;
}
function rateAvailable(row: AcquisitionBreakdown, available: Availability) {
  return available.events && available.subscribers && available.linkedRates && row.source !== 'unknown' && row.key !== '/unknown';
}

function Chevron() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SelectControl({ label, value, onChange, children, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; children: ReactNode; disabled?: boolean;
}) {
  return <label className={styles.selectControl}><span className={styles.srOnly}>{label}</span>
    <select aria-label={label} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}>{children}</select><Chevron />
  </label>;
}

function Kpis({ report, available }: { report: AcquisitionReport; available: Availability }) {
  const items = [
    { label: 'Tracked visitors', value: report.overview.visitors, available: available.events, caption: `${count(report.overview.pageViews, available.events)} total page views` },
    { label: 'New subscribers', value: report.overview.newSubscribers, available: available.subscribers, caption: `${count(report.coverage.knownSubscriberSources)} of ${count(report.overview.newSubscribers)} sources known` },
    { label: 'New accounts', value: report.overview.newAccounts, available: available.accounts, caption: `${count(report.coverage.knownAccountSources)} of ${count(report.overview.newAccounts)} sources known` },
    { label: 'New paying members', value: report.overview.paidConversions, available: available.events, caption: 'Tracked first payments · since rollout' },
  ];
  return <section className={styles.kpis} aria-label="Acquisition overview">{items.map(item =>
    <div className={styles.kpi} key={item.label}><h2>{item.label}</h2><p className={styles.kpiValue}>{count(item.value, item.available)}</p><p className={styles.caption}>{item.available ? item.caption : 'Data temporarily unavailable'}</p></div>
  )}</section>;
}

function TrendChart({ report, available }: { report: AcquisitionReport; available: Availability }) {
  const [selected, setSelected] = useState<Metric[]>(['visitors', 'newSubscribers']);
  const series = report.dailySeries;
  const selectedMetrics = METRICS.filter(metric => selected.includes(metric.key));
  const maxValue = Math.max(1, ...series.flatMap(row => selected.map(key => metricAvailable(key, available) ? row[key] : 0)));
  const magnitude = 10 ** Math.floor(Math.log10(maxValue));
  const axisMax = Math.ceil(maxValue / magnitude) * magnitude;
  const width = 760, height = 320, left = 45, right = 12, top = 10, bottom = 30;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = (index: number) => left + (series.length <= 1 ? plotWidth / 2 : index / (series.length - 1) * plotWidth);
  const y = (value: number) => top + (1 - value / axisMax) * plotHeight;
  const labelIndices = [...new Set(Array.from({ length: Math.min(6, series.length) }, (_, index) => Math.round(index / Math.max(1, Math.min(6, series.length) - 1) * (series.length - 1))))];
  const hasAvailableMetric = selected.some(key => metricAvailable(key, available));
  return <section className={styles.trend} aria-labelledby="trend-title">
    <div className={styles.sectionHeading}><h2 id="trend-title">Visits and subscriptions</h2>
      <details className={styles.metricPicker}><summary>Daily <Chevron /></summary><div className={styles.metricOptions}>{METRICS.map(metric =>
        <label key={metric.key}><input type="checkbox" checked={selected.includes(metric.key)} disabled={!metricAvailable(metric.key, available) || (selected.length === 1 && selected.includes(metric.key))}
          onChange={event => setSelected(current => event.target.checked ? [...current, metric.key] : current.filter(key => key !== metric.key))} />{metric.label}{!metricAvailable(metric.key, available) ? ' · N/A' : ''}</label>
      )}</div></details>
    </div>
    {hasAvailableMetric ? <div className={styles.chartFrame}><svg viewBox={`0 0 ${width} ${height}`} className={styles.chart} role="img" aria-label={`Daily ${selectedMetrics.map(metric => metric.label.toLowerCase()).join(' and ')} from ${report.range.startDate} to ${report.range.endDate}. Values are available in the daily data table.`}>
      {Array.from({ length: 5 }, (_, index) => { const value = axisMax * index / 4; return <g key={index}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className={styles.gridLine} /><text x={left - 9} y={y(value) + 4} textAnchor="end">{numberFormat.format(value)}</text></g>; })}
      {labelIndices.map(index => <g key={index}><line x1={x(index)} x2={x(index)} y1={top} y2={height - bottom} className={styles.gridLine} /><text x={x(index)} y={height - 8} textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}>{dateFormat.format(new Date(`${series[index].date}T00:00:00Z`))}</text></g>)}
      {selectedMetrics.filter(metric => metricAvailable(metric.key, available)).map(metric => <polyline key={metric.key} fill="none" stroke={metric.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={series.map((row, index) => `${x(index).toFixed(2)},${y(row[metric.key]).toFixed(2)}`).join(' ')} />)}
      {series.length === 1 ? selectedMetrics.filter(metric => metricAvailable(metric.key, available)).map(metric => <circle key={`${metric.key}-point`} cx={x(0)} cy={y(series[0][metric.key])} r="4" fill={metric.color} />) : null}
    </svg></div> : <div className={styles.chartUnavailable}>Chart data is temporarily unavailable.</div>}
    <div className={styles.legend}>{selectedMetrics.map(metric => <span key={metric.key}><i style={{ background: metric.color }} />{metric.label}{!metricAvailable(metric.key, available) ? ' · N/A' : ''}</span>)}</div>
    <details className={styles.dailyData}><summary>Show daily data</summary><div className={styles.tableScroll}><table><thead><tr><th>Date · UTC</th>{selectedMetrics.map(metric => <th key={metric.key}>{metric.label}</th>)}</tr></thead><tbody>{series.map(row => <tr key={row.date}><td>{row.date}</td>{selectedMetrics.map(metric => <td key={metric.key}>{count(row[metric.key], metricAvailable(metric.key, available))}</td>)}</tr>)}</tbody></table></div></details>
  </section>;
}

function LinkedOutcomes({ report, available }: { report: AcquisitionReport; available: Availability }) {
  const labels: Record<string, string> = { visitors: 'Tracked visitors', subscribers: 'Linked subscriber signups', account: 'Linked accounts', paid: 'Linked paying members' };
  return <section className={styles.funnel} aria-labelledby="outcomes-title"><h2 id="outcomes-title">Linked outcomes</h2><p className={styles.sectionSubtitle}>Tracked visitors and independent outcomes.</p>
    <div className={styles.funnelStages}>{report.funnel.map(stage => {
      const isAvailable = available.events && (stage.key === 'subscribers' ? available.subscribers : stage.key === 'account' ? available.accounts : true);
      const rate = stage.key === 'visitors' ? (stage.value ? 100 : null) : stage.rate;
      const linkedCount = stage.key === 'visitors' ? stage.value : stage.key === 'subscribers' ? report.coverage.linkedSubscriberCount : stage.key === 'account' ? report.coverage.linkedAccountCount : report.coverage.linkedPaidCount;
      const unlinkedCount = stage.key === 'subscribers' ? report.coverage.unlinkedSubscriberCount : stage.key === 'account' ? report.coverage.unlinkedAccountCount : stage.key === 'paid' ? report.coverage.unlinkedPaidCount : 0;
      const knownOutcome = stage.key === 'visitors' || (stage.key === 'subscribers' ? available.linkedRates : stage.key === 'account' ? report.coverage.knownAccountSources > 0 : (report.coverage.linkedPaidCount ?? 0) > 0);
      return <div className={styles.funnelStage} key={stage.key}><div><p>{labels[stage.key] ?? stage.label}</p><strong>{count(linkedCount ?? 0, isAvailable)}</strong>{isAvailable && unlinkedCount > 0 ? <span className={styles.unlinkedOutcome}>{count(unlinkedCount)} without a recorded visit link</span> : null}</div><div><strong className={styles.funnelRate}>{percent(rate, isAvailable && knownOutcome && report.filters.source !== 'unknown')}</strong><span>of tracked visitors</span>{stage.key !== 'visitors' && (linkedCount ?? 0) !== stage.value ? <span>{count(stage.value, isAvailable)} linked visitors</span> : null}</div></div>;
    })}</div>
    <p className={styles.funnelNote}>Rates use distinct linked visitors against the same tracked-visitor denominator. Outcomes can happen independently.</p>
    <div className={styles.funnelCoverage}><div><strong>Page views with browser IDs</strong><p>{report.coverage.legacyPageViews > 0 ? 'Historical IDs predate consented tracking.' : 'Browser IDs require analytics consent.'}</p></div><div><strong>{percent(report.coverage.identityCoveragePct, available.events)}</strong><span>of page views</span></div></div>
  </section>;
}

function AcquisitionTable({ rows, available, kind = 'sources', compact = false, onDrill }: {
  rows: AcquisitionBreakdown[]; available: Availability; kind?: 'sources' | 'campaigns' | 'landings' | 'content'; compact?: boolean;
  onDrill?: (row: AcquisitionBreakdown) => void;
}) {
  const firstLabel = kind === 'sources' ? 'Source / Medium' : kind === 'campaigns' ? 'Campaign' : kind === 'landings' ? 'Page' : 'Content';
  return <>{!compact && rows.length > 0 ? <p className={styles.tableScrollHint}>Scroll to compare columns</p> : null}<div className={styles.tableScroll}><table className={`${styles.dataTable} ${compact ? styles.compactTable : ''}`}><thead><tr><th>{firstLabel}</th>{kind === 'campaigns' && !compact ? <th>Source / Medium</th> : null}<th>{compact ? 'Page views' : 'Tracked visitors'}</th>{!compact ? <th>Page views</th> : null}<th>New subscribers</th>{!compact ? <><th>New accounts</th><th>New paying</th><th>Linked signup rate</th></> : null}</tr></thead>
    <tbody>{rows.length ? rows.map(row => <tr key={row.key}><td>{onDrill ? <button type="button" className={`${styles.rowLink} ${kind === 'sources' ? styles.sourceLink : ''}`} onClick={() => onDrill(row)} title={kind === 'sources' ? `Filter every view to ${displaySource(row.source)}` : `View ${displayCampaign(row.campaign)} from ${displaySource(row.source)}`}>
      {kind === 'sources' ? `${displaySource(row.source)} / ${row.medium ?? 'unknown'}` : kind === 'campaigns' ? displayCampaign(row.campaign) : row.label}
    </button> : <span>{row.label === '/unknown' || row.label === 'unknown' ? 'Unknown' : row.label}</span>}{kind === 'campaigns' && compact ? <span className={styles.campaignSource}>{displaySource(row.source)}</span> : null}</td>
    {kind === 'campaigns' && !compact ? <td>{displaySource(row.source)} / {row.medium ?? 'unknown'}</td> : null}
    <td>{count(compact ? row.pageViews : row.visitors, available.events)}</td>{!compact ? <td>{count(row.pageViews, available.events)}</td> : null}<td>{count(row.newSubscribers, available.subscribers)}</td>{!compact ? <><td>{count(row.newAccounts, available.accounts)}</td><td>{count(row.paidConversions, available.events)}</td><td>{percent(row.subscriberRate, rateAvailable(row, available))}</td></> : null}</tr>) : <tr><td colSpan={compact ? 3 : kind === 'campaigns' ? 8 : 7} className={styles.emptyCell}>{!available.events && !available.subscribers && !available.accounts ? 'Data is temporarily unavailable.' : 'No records for this period and these filters.'}</td></tr>}</tbody>
  </table></div></>;
}

function TrackingLinks() {
  const [destination, setDestination] = useState('/');
  const [source, setSource] = useState('x');
  const [medium, setMedium] = useState('organic_social');
  const [campaign, setCampaign] = useState('daily_update');
  const [content, setContent] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const normalizedSource = normalizeDimension(source), normalizedMedium = normalizeDimension(medium);
  const normalizedCampaign = normalizeDimension(campaign), normalizedContent = normalizeDimension(content);
  const valid = Boolean(normalizedSource && normalizedMedium && (!campaign.trim() || normalizedCampaign) && (!content.trim() || normalizedContent));
  const params = new URLSearchParams();
  if (normalizedSource) params.set('utm_source', normalizedSource);
  if (normalizedMedium) params.set('utm_medium', normalizedMedium);
  if (normalizedCampaign) params.set('utm_campaign', normalizedCampaign);
  if (normalizedContent) params.set('utm_content', normalizedContent);
  const trackingUrl = valid ? `https://www.macro-bias.com${destination}?${params}` : '';
  async function copyLink() {
    try { await navigator.clipboard.writeText(trackingUrl); setCopyStatus('Link copied.'); }
    catch { setCopyStatus('Select the link below to copy it.'); }
  }
  return <div className={styles.linkBuilder}>
    <div className={styles.sectionHeading}><h2>Tracking links</h2></div><p className={styles.sectionSubtitle}>Use a distinct campaign for each post or promotion, then compare its confirmed signups here.</p>
    <div className={styles.presets} aria-label="Source presets">{['x', 'reddit', 'threads', 'bluesky'].map(value => <button type="button" key={value} className={source === value ? styles.presetActive : ''} onClick={() => { setSource(value); setMedium('organic_social'); setCopyStatus(''); }}>{displaySource(value)}</button>)}</div>
    <div className={styles.builderFields}>
      <label>Destination<select value={destination} onChange={event => { setDestination(event.target.value); setCopyStatus(''); }}><option value="/">Home</option><option value="/today">Stocks · Today</option><option value="/crypto">Crypto</option><option value="/emails">Free emails</option><option value="/pricing">Pro pricing</option></select></label>
      <label>Source<input value={source} maxLength={80} onChange={event => { setSource(event.target.value); setCopyStatus(''); }} placeholder="reddit" /></label>
      <label>Medium<input value={medium} maxLength={80} onChange={event => { setMedium(event.target.value); setCopyStatus(''); }} placeholder="social" /></label>
      <label>Campaign<input value={campaign} maxLength={80} onChange={event => { setCampaign(event.target.value); setCopyStatus(''); }} placeholder="october_crypto" /></label>
      <label>Content · optional<input value={content} maxLength={80} onChange={event => { setContent(event.target.value); setCopyStatus(''); }} placeholder="post_a" /></label>
    </div>
    <div className={styles.generatedLink}><label><span className={styles.srOnly}>Generated tracking link</span><input readOnly value={trackingUrl} aria-label="Generated tracking link" onFocus={event => event.target.select()} placeholder="Enter a source and medium to create a link." /></label><button type="button" className={styles.outlineButton} onClick={copyLink} disabled={!valid}>Copy link</button></div>
    <p className={styles.caption} role="status">{copyStatus || (valid ? 'Lowercase labels keep reports consistent. Copy the link into your post.' : 'Use short source and campaign labels without email addresses or URLs.')}</p>
  </div>;
}

function Coverage({ report, available, linksOpen, onToggleLinks }: {
  report: AcquisitionReport; available: Availability; linksOpen: boolean; onToggleLinks: () => void;
}) {
  const unknownPct = report.overview.newSubscribers ? report.coverage.unknownSubscriberSources / report.overview.newSubscribers * 100 : null;
  const lastReceived = [report.freshness.latestPageViewAt, report.freshness.latestConversionAt].filter((value): value is string => Boolean(value)).sort().at(-1);
  return <footer className={styles.coverage}>
    <div className={styles.coverageStrip}><h2>Data coverage</h2><div><strong>{percent(report.coverage.identityCoveragePct, available.events)}</strong><span>page views with browser IDs</span></div><div><strong>{percent(unknownPct, available.subscribers)}</strong><span>subscriber sources unknown</span></div><div className={styles.lastReceived}><strong>Last received</strong><span>{lastReceived ? localDateFormat.format(new Date(lastReceived)) : 'No activity in this period'}</span></div><button type="button" className={styles.outlineButton} aria-expanded={linksOpen} aria-controls="tracking-link-builder" onClick={onToggleLinks}>Tracking links</button></div>
    {linksOpen ? <div id="tracking-link-builder"><TrackingLinks /></div> : null}
    <details className={styles.definitions}><summary>How these numbers are counted <Chevron /></summary><div className={styles.definitionContent}>
      <p>Dates are inclusive UTC calendar days. Today’s totals are still accumulating. Loaded {utcDateFormat.format(new Date(report.freshness.loadedAt))} UTC.</p>
      <p>Tracked visitors and sessions cover saved visit identities. Other visits count as page views only. New subscribers and accounts use their original creation dates; repeat signups and reactivations add no new subscription.</p>
      <p>Signup rate is the share of tracked visitors who also made a confirmed new subscription in this period and source view. Unknown sources have no comparable signup rate. Visitors can appear in several groups, so visitor totals across rows do not add up.</p>
      <p>First discovery is the earliest saved source within 90 days. Latest non-direct is the latest saved acquisition source; returning directly, signing in and checking out do not overwrite it. Untracked visits show only their current recorded source.</p>
      <p>Historical subscriber and account sources stay Unknown where attribution was never recorded. Paying members show tracked, verified first payments since rollout. Historical payment conversions and revenue are unavailable.</p>
      <p>Bot/test traffic, delivery records, repeat conversions and active referral-only records without newsletter opt-ins are excluded. Older session identifiers did not record 30-minute inactivity boundaries.</p>
      <div className={styles.datasetStatuses}>{report.coverage.datasets.map(dataset => <span key={dataset.name}>{dataset.name === 'events' ? 'Visits and tracked payments' : dataset.name === 'accounts' ? 'Accounts' : 'Subscribers'}: <strong>{!dataset.available ? 'Unavailable' : dataset.complete ? 'Complete' : 'Partial'}</strong></span>)}</div>
    </div></details>
    <div className={styles.bottomLine}><span>Private acquisition analytics · no subscriber details in exports</span><span>Macro Bias</span></div>
  </footer>;
}

export default function AnalyticsDashboard({ report, initialView }: { report: AcquisitionReport; initialView?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const view: View = VIEWS.some(item => item.key === initialView) ? initialView as View : 'overview';
  const rangeKey = `${report.filters.preset}:${report.range.startDate}:${report.range.endDate}`;
  const [dateDraft, setDateDraft] = useState(() => ({
    rangeKey, open: report.filters.preset === 'custom', start: report.range.startDate, end: report.range.endDate,
  }));
  // Replace the stored draft when the canonical report changes, so returning
  // with Browser Back cannot revive an earlier edited draft for that range.
  if (dateDraft.rangeKey !== rangeKey) {
    setDateDraft({ rangeKey, open: report.filters.preset === 'custom', start: report.range.startDate, end: report.range.endDate });
  }
  const editor = dateDraft;
  const [rangeError, setRangeError] = useState('');
  const [linksOpen, setLinksOpen] = useState(false);
  const available: Availability = {
    events: report.coverage.datasets.find(item => item.name === 'events')?.available !== false,
    subscribers: report.coverage.datasets.find(item => item.name === 'subscribers')?.available !== false,
    accounts: report.coverage.datasets.find(item => item.name === 'accounts')?.available !== false,
    linkedRates: report.coverage.knownSubscriberSources > 0,
  };
  function reportParams() {
    const params = new URLSearchParams({ preset: report.filters.preset, touch: report.filters.touch });
    if (report.filters.preset === 'custom') { params.set('start', report.range.startDate); params.set('end', report.range.endDate); }
    if (report.filters.source) params.set('source', report.filters.source);
    if (report.filters.campaign) params.set('campaign', report.filters.campaign);
    if (view !== 'overview') params.set('view', view);
    return params;
  }
  function updateFilters(update: FilterUpdate) {
    const params = reportParams();
    for (const [key, value] of Object.entries(update)) { if (value) params.set(key, value); else params.delete(key); }
    startTransition(() => router.push(`/analytics?${params}`, { scroll: false }));
  }
  function chooseRange(preset: string) {
    setRangeError('');
    if (preset === 'custom') { setDateDraft({ rangeKey, open: true, start: report.range.startDate, end: report.range.endDate }); return; }
    setDateDraft({ ...editor, open: false }); updateFilters({ preset, start: null, end: null });
  }
  function editDate(field: 'start' | 'end', value: string) {
    setDateDraft(current => ({ ...(current.rangeKey === rangeKey ? current : editor), [field]: value }));
  }
  function applyCustomRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Submit the visible native input values, including autofill/accessibility
    // updates; do not rely on a potentially batched editor state snapshot.
    const values = new FormData(event.currentTarget);
    const startDate = String(values.get('start') ?? ''), endDate = String(values.get('end') ?? '');
    setDateDraft({ rangeKey, open: true, start: startDate, end: endDate });
    const start = Date.parse(`${startDate}T00:00:00Z`), end = Date.parse(`${endDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || (end - start) / 86400000 >= 365 || endDate > report.freshness.loadedAt.slice(0, 10)) {
      setRangeError('Choose up to 365 days, ending today or earlier.'); return;
    }
    setRangeError(''); updateFilters({ preset: 'custom', start: startDate, end: endDate });
  }
  const exportParams = reportParams();
  exportParams.set('view', view === 'overview' ? 'sources' : view);
  const dateRangeLabel = `${dateFormat.format(new Date(`${report.range.startDate}T00:00:00Z`))} — ${longDateFormat.format(new Date(`${report.range.endDate}T00:00:00Z`))} · UTC`;
  const sourceOptions = [...new Set([...report.options.sources, ...(report.filters.source ? [report.filters.source] : [])])];
  const campaignOptions = [...new Set([...report.options.campaigns, ...(report.filters.campaign ? [report.filters.campaign] : [])])];
  const sourceControl = <SelectControl label="Filter by source" value={report.filters.source || 'all'} disabled={isPending} onChange={source => updateFilters({ source: source === 'all' ? null : source })}><option value="all">All sources</option>{sourceOptions.map(source => <option key={source} value={source}>{displaySource(source)}</option>)}</SelectControl>;
  const campaignControl = <SelectControl label="Filter by campaign" value={report.filters.campaign || 'all'} disabled={isPending} onChange={campaign => updateFilters({ campaign: campaign === 'all' ? null : campaign })}><option value="all">All campaigns</option>{campaignOptions.map(campaign => <option key={campaign} value={campaign}>{displayCampaign(campaign)}</option>)}</SelectControl>;
  const sourceDrill = (row: AcquisitionBreakdown) => updateFilters({ source: row.source === report.filters.source ? null : row.source ?? null });
  const campaignDrill = (row: AcquisitionBreakdown) => updateFilters({ source: row.source ?? null, campaign: row.campaign ?? null, view: 'campaigns' });
  return <main className={styles.page} aria-busy={isPending}>
    <div className={styles.container}>
      <header className={styles.header}><div><h1 className={styles.title}>What brings people in?</h1><p className={styles.subtitle}>See which sources turn visits into subscribers and paying members.</p></div><a href={`/api/analytics/export?${exportParams}`} className={styles.outlineButton}>Export CSV</a></header>
      <div className={styles.toolbar}><div className={styles.rangeControls}><SelectControl label="Reporting period" value={editor.open ? 'custom' : report.filters.preset} onChange={chooseRange} disabled={isPending}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="custom">Custom dates</option></SelectControl><span>{dateRangeLabel}</span></div>
        <div className={styles.touchControls}><span>Attribution:</span><div className={styles.segmented}><button type="button" className={report.filters.touch === 'first' ? styles.segmentActive : ''} aria-pressed={report.filters.touch === 'first'} disabled={isPending} onClick={() => updateFilters({ touch: 'first' })}>First discovery</button><button type="button" className={report.filters.touch === 'latest' ? styles.segmentActive : ''} aria-pressed={report.filters.touch === 'latest'} disabled={isPending} onClick={() => updateFilters({ touch: 'latest' })}>Latest non-direct</button></div></div>
        <button type="button" className={styles.refresh} disabled={isPending} onClick={() => startTransition(() => router.refresh())}>{isPending ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {editor.open ? <form className={styles.customDates} onSubmit={applyCustomRange}><label>From · UTC<input type="date" name="start" required value={editor.start} max={editor.end || report.freshness.loadedAt.slice(0, 10)} onChange={event => editDate('start', event.currentTarget.value)} /></label><label>Through · UTC<input type="date" name="end" required value={editor.end} min={editor.start} max={report.freshness.loadedAt.slice(0, 10)} onChange={event => editDate('end', event.currentTarget.value)} /></label><button type="submit" className={styles.outlineButton} disabled={isPending}>Apply dates</button>{rangeError && dateDraft.rangeKey === rangeKey ? <p role="alert">{rangeError}</p> : null}</form> : null}
      <nav className={styles.tabs} aria-label="Analytics views">{VIEWS.map(item => <button key={item.key} type="button" className={view === item.key ? styles.tabActive : ''} aria-current={view === item.key ? 'page' : undefined} disabled={isPending} onClick={() => updateFilters({ view: item.key === 'overview' ? null : item.key })}>{item.label}</button>)}</nav>
      {report.filters.source || report.filters.campaign ? <div className={styles.activeFilters}><span>Showing {report.filters.source ? displaySource(report.filters.source) : 'all sources'}{report.filters.campaign ? ` · ${displayCampaign(report.filters.campaign)}` : ''}</span><button type="button" onClick={() => updateFilters({ source: null, campaign: null })} disabled={isPending}>Clear filters</button></div> : null}
      {!report.coverage.complete ? <p className={styles.partialNotice} role="status">Some data could not be loaded. Available counts are partial; unavailable figures show N/A. Refresh to try again.</p> : null}
      <Kpis report={report} available={available} />
      {report.coverage.legacyPageViews > 0 ? <p className={styles.historyNotice}>Tracked browser IDs in historical records predate consented tracking. <strong>{count(report.coverage.knownSubscriberSources + report.coverage.knownAccountSources)} of {count(report.overview.newSubscribers + report.overview.newAccounts)} subscriber/account sources known.</strong> Unrecorded sources stay Unknown{available.linkedRates ? '.' : '; linked rates show N/A.'}</p> : null}
      {view === 'overview' ? <><div className={styles.chartAndFunnel}><TrendChart report={report} available={available} /><LinkedOutcomes report={report} available={available} /></div><section className={styles.sourcesSection}><div className={styles.sectionHeading}><h2>Which sources work?</h2>{sourceControl}</div><AcquisitionTable rows={report.sourceRows} available={available} onDrill={sourceDrill} /><p className={styles.tableNote}>Signup rate uses linked tracked visitors. Select a source to filter every view.</p></section><div className={styles.bottomTables}><section><div className={styles.sectionHeading}><h2>Top landing pages</h2><button type="button" className={styles.textButton} onClick={() => updateFilters({ view: 'landings' })}>View all</button></div><AcquisitionTable rows={report.landingRows.slice(0, 5)} available={available} kind="landings" compact /></section><section><div className={styles.sectionHeading}><h2>Campaigns</h2><button type="button" className={styles.textButton} onClick={() => updateFilters({ view: 'campaigns' })}>View all</button></div><AcquisitionTable rows={report.campaignRows.slice(0, 5)} available={available} kind="campaigns" compact onDrill={campaignDrill} /></section></div></> : null}
      {view === 'sources' ? <section className={styles.expandedSection}><div className={styles.sectionHeading}><h2>Which sources work?</h2><div className={styles.tableControls}>{sourceControl}{campaignControl}</div></div><p className={styles.sectionSubtitle}>Compare confirmed conversions with tracked visitors from the same source and period.</p><AcquisitionTable rows={report.sourceRows} available={available} onDrill={sourceDrill} /><p className={styles.tableNote}>Select a source to drill into its campaigns and landing pages. Unknown sources have no comparable signup rate.</p></section> : null}
      {view === 'campaigns' ? <section className={styles.expandedSection}><div className={styles.sectionHeading}><h2>Campaigns</h2><div className={styles.tableControls}>{sourceControl}{campaignControl}</div></div><p className={styles.sectionSubtitle}>Track a campaign’s visits and confirmed subscriptions across channels.</p><AcquisitionTable rows={report.campaignRows} available={available} kind="campaigns" onDrill={campaignDrill} /><p className={styles.tableNote}>Select a campaign to filter the report. Missing campaign labels stay “No campaign recorded”.</p></section> : null}
      {view === 'landings' ? <><section className={styles.expandedSection}><div className={styles.sectionHeading}><h2>Top landing pages</h2><div className={styles.tableControls}>{sourceControl}{campaignControl}</div></div><p className={styles.sectionSubtitle}>The first page recorded for the selected acquisition touch.</p><AcquisitionTable rows={report.landingRows} available={available} kind="landings" /></section><section className={styles.expandedSection}><div className={styles.sectionHeading}><h2>Stocks and crypto</h2></div><AcquisitionTable rows={report.contentRows} available={available} kind="content" /><p className={styles.tableNote}>Visitors can appear in both markets. Historical content stays Unknown when it was never recorded.</p></section></> : null}
      <Coverage report={report} available={available} linksOpen={linksOpen} onToggleLinks={() => setLinksOpen(current => !current)} />
    </div>
  </main>;
}
