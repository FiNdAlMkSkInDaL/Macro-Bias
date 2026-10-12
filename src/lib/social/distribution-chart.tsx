import 'server-only';
import { ImageResponse } from 'next/og';
import { loadPaidBriefingArchive } from '@/lib/product/paid-briefing-data';
import { buildPublishedChart, type PublishedChart } from './chart-content';
import { DISTRIBUTION_ORIGIN, type DistributionMarket } from './distribution-content';

export function renderPublishedChart(chart: PublishedChart) {
  const { points } = chart;
  const start = Date.parse(points[0].date);
  const end = Date.parse(chart.date);
  const x = (date: string) => 75 + (end === start ? 0.5 : (Date.parse(date) - start) / (end - start)) * 1000;
  const y = (score: number) => 15 + (100 - score) / 200 * 190;
  const accent = chart.score < 0 ? '#f4a1aa' : '#c9f58a';
  return new ImageResponse(
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#090b0a', color: '#f1f5ef', padding: '38px 48px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#acb6ad', fontSize: 22 }}><span>MACRO BIAS / {chart.market === 'stocks' ? 'STOCKS' : 'CRYPTO'}</span><span>{chart.date}{chart.market === 'crypto' ? ' · UTC session' : ' · reading'}</span></div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 28, marginTop: 14 }}><span style={{ fontSize: 86, color: accent }}>{chart.score > 0 ? '+' : ''}{chart.score}</span><span style={{ fontSize: 35 }}>{chart.label.replace(/_/g, ' ').toLowerCase()}</span></div>
      <div style={{ display: 'flex', color: '#acb6ad', fontSize: 19, marginBottom: 12 }}>Last {points.length} published model {points.length === 1 ? 'reading' : 'readings'} · fixed scale</div>
      <div style={{ display: 'flex', position: 'relative' }}>
      <svg width="1100" height="225" viewBox="0 0 1100 225">
        {[-100, 0, 100].map(value => <line key={value} x1="75" x2="1075" y1={y(value)} y2={y(value)} stroke="#344037" />)}
        {points.slice(1).map((point, index) => Date.parse(point.date) - Date.parse(points[index].date) <= (chart.market === 'stocks' ? 4 : 1) * 86_400_000
          ? <line key={point.date} x1={x(points[index].date)} y1={y(points[index].score)} x2={x(point.date)} y2={y(point.score)} stroke={accent} strokeWidth="3" /> : null)}
        {points.map(point => <circle key={point.date} cx={x(point.date)} cy={y(point.score)} r={point.date === chart.date ? 6 : 3} fill={accent} />)}
      </svg>
      {[-100, 0, 100].map(value => <div key={value} style={{ display: 'flex', position: 'absolute', left: 0, top: y(value) - 10, color: '#acb6ad', fontSize: 17 }}>{value > 0 ? '+' : ''}{value}</div>)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: 75, marginRight: 25, color: '#acb6ad', fontSize: 17 }}><span>{points[0].date}</span><span>{chart.date}</span></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 15, fontSize: 18, color: '#acb6ad' }}><span>{chart.overrideActive ? 'News override active. Chart shows the base model.' : 'Market context, not a prediction of the next move.'}</span><span>macro-bias.com</span></div>
    </div>, { width: 1200, height: 630 },
  );
}

export async function loadPublishedChart(market: DistributionMarket, date: string) {
  const archive = await loadPaidBriefingArchive(market);
  if (archive.loadError) throw new Error('chart_source_unavailable');
  return buildPublishedChart(market, date, archive.items);
}

export async function createDistributionChart(market: DistributionMarket, date: string) {
  const chart = await loadPublishedChart(market, date);
  if (!chart) throw new Error('chart_reading_unavailable');
  const response = renderPublishedChart(chart);
  return { ...chart, data: new Uint8Array(await response.arrayBuffer()), url: `${DISTRIBUTION_ORIGIN}/charts/${market}/${date}` };
}
