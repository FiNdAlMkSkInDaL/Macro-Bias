'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { buildMarketChartSeries, marketChartPriceBounds, windowMarketChartSeries, type MarketChartCandle, type MarketChartScore } from '@/lib/product/market-chart';
import { formatBiasLabel, formatScore, formatTradeDate, formatUsd } from '@/lib/public-proof/format';
import styles from './MacroMarketChart.module.css';

const PLOT_WIDTH = 540;
const PLOT_HEIGHT = 290;
const PRICE_TOP = 12;
const PRICE_BOTTOM = 202;
const BIAS_ZERO = 253;
const BIAS_HEIGHT = 29;

function barColor(score: number) {
  if (score >= 10) return '#81c97a';
  if (score <= -10) return '#ed6874';
  return '#8c9a9e';
}

function labelTone(label: string | undefined) {
  if (label?.includes('RISK_OFF')) return styles['macro-negative'];
  if (label?.includes('RISK_ON')) return styles['macro-positive'];
  return styles['macro-neutral'];
}

function labelColor(label: string | undefined) {
  if (label?.includes('RISK_OFF')) return '#f19099';
  if (label?.includes('RISK_ON')) return '#b8e58c';
  return '#8c9a9e';
}

function shortDate(tradeDate: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${tradeDate}T00:00:00Z`));
}

function axisPrice(price: number, span: number, instrument: 'SPY' | 'BTC') {
  if (instrument === 'BTC' && Math.abs(price) >= 1000) return `${(price / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return price.toLocaleString('en-US', { minimumFractionDigits: span < 5 ? 1 : 0, maximumFractionDigits: span < 5 ? 1 : 0 });
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d={direction === 'left' ? 'M10 3.5 5.5 8 10 12.5' : 'M6 3.5 10.5 8 6 12.5'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function MacroMarketChart({
  candles, marks, latest, notice, instrument = 'SPY', title, variant = 'hero',
}: {
  candles: readonly MarketChartCandle[];
  marks: readonly MarketChartScore[];
  latest: MarketChartScore | null;
  notice: string | null;
  instrument?: 'SPY' | 'BTC';
  title?: string;
  variant?: 'hero' | 'history';
}) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const touchPointer = useRef<number | null>(null);
  const touchStart = useRef<{ index: number; x: number; wasPinned: boolean; moved: boolean; previousPinnedDate: string | null } | null>(null);
  const lastTouchTimestamp = useRef(-Infinity);
  const chartId = useId();
  const readoutId = `${chartId}-readout`;

  // Pointer selection does not rebuild the date joins or price bounds.
  const series = useMemo(() => buildMarketChartSeries(candles, marks, latest), [candles, marks, latest]);
  const history = useMemo(() => windowMarketChartSeries(series), [series]);
  const bounds = useMemo(() => marketChartPriceBounds(history.candles), [history]);
  const dateIndices = useMemo(() => new Map(history.sessions.map((session, index) => [session.tradeDate, index])), [history]);
  const { sessions, latestCandle, latestMark } = history;
  const defaultIndex = latestMark ? dateIndices.get(latestMark.tradeDate) ?? sessions.length - 1 : sessions.length - 1;
  const selectedIndex = (activeDate ? dateIndices.get(activeDate) : undefined) ?? (pinnedDate ? dateIndices.get(pinnedDate) : undefined) ?? defaultIndex;
  const selectedSession = sessions[selectedIndex] ?? null;
  const isLatestSession = Boolean(selectedSession) && selectedSession?.tradeDate === sessions[defaultIndex]?.tradeDate;
  const slot = PLOT_WIDTH / Math.max(sessions.length, 1);
  const markerPosition = latestMark ? (latestMark.score + 100) / 2 : null;
  const tickIndices = sessions.length ? Array.from(new Set([0, Math.round((sessions.length - 1) / 3), Math.round((sessions.length - 1) * 2 / 3), sessions.length - 1])) : [];
  const priceTicks = Array.from({ length: 5 }, (_, index) => ({ y: PRICE_TOP + (PRICE_BOTTOM - PRICE_TOP) * index / 4, price: bounds.maxPrice - bounds.priceSpan * index / 4 }));
  const InstrumentHeading = variant === 'history' ? 'h3' : 'h2';

  function priceY(price: number) { return PRICE_TOP + (bounds.maxPrice - price) / bounds.priceSpan * (PRICE_BOTTOM - PRICE_TOP); }

  function selectSession(index: number, focusPlot = false) {
    const nextIndex = Math.max(0, Math.min(sessions.length - 1, index));
    setPinnedDate(sessions[nextIndex]?.tradeDate ?? null);
    setActiveDate(null);
    if (focusPlot) buttonRefs.current[nextIndex]?.focus();
  }

  function navigateSession(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'Escape') {
      event.preventDefault();
      buttonRefs.current[defaultIndex]?.focus();
      setPinnedDate(null);
      setActiveDate(null);
      return;
    }
    const nextIndex = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? sessions.length - 1 : null;
    if (nextIndex === null) return;
    event.preventDefault();
    selectSession(nextIndex, true);
  }

  function touchIndex(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(sessions.length - 1, Math.floor((event.clientX - rect.left) / rect.width * sessions.length)));
  }

  return (
    <section className={`${styles['macro-panel']} ${variant === 'history' ? styles['macro-history'] : styles['macro-hero']}`} aria-label={title ?? `${instrument} prices and Macro Bias`} data-market-chart data-instrument={instrument} data-range-months={3}>
      {variant === 'hero' ? (
        <>
          <div className={styles['macro-panel-heading']}><p>{title ?? `THE MARKET BEHIND ${instrument}`}</p><span>{latestMark ? formatTradeDate(latestMark.tradeDate) : 'Score not available'}</span></div>
          <div className={styles['macro-score-row']}>
            <div className={styles['macro-score-read']}>
              <p className={styles['macro-score-caption']}>Latest bias</p>
              <p className={`${styles['macro-score']} ${labelTone(latestMark?.biasLabel)}`}>{latestMark ? formatScore(latestMark.score) : '—'}</p>
              <p className={`${styles['macro-label']} ${labelTone(latestMark?.biasLabel)}`}>{latestMark ? formatBiasLabel(latestMark.biasLabel) : 'Not available'}</p>
            </div>
            <div className={styles['macro-scale']} role="img" aria-label={latestMark ? `Macro Bias ${formatScore(latestMark.score)} on a scale from minus 100 to plus 100.` : 'Macro Bias score not available.'}>
              <span>−100</span><div className={styles['macro-rail']}><i className={styles['macro-rail-negative']} /><i className={styles['macro-rail-neutral']} /><i className={styles['macro-rail-positive']} />{markerPosition !== null ? <b className={styles['macro-rail-marker']} style={{ left: `${markerPosition}%`, background: labelColor(latestMark?.biasLabel) }} /> : null}</div><span>+100</span>
            </div>
          </div>
        </>
      ) : null}

      <div className={styles['macro-instrument-row']}>
        <div className={styles['macro-instrument']}><InstrumentHeading>{instrument}</InstrumentHeading><p>{latestCandle ? formatUsd(latestCandle.close) : 'Price not available'}</p><span className={styles['macro-close-date']}>{latestCandle ? `Close · ${shortDate(latestCandle.tradeDate)}` : 'Daily prices'}</span></div>
      </div>

      <div className={styles['macro-chart']}>
        <div className={styles['macro-plot']} role="group" aria-label={`${instrument} daily prices and Macro Bias scores, 3 calendar months, ${sessions.length} dates. Use arrow keys to move, Home or End to jump, and Escape for the latest session.`}
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' || !sessions.length) return;
            const index = touchIndex(event);
            touchPointer.current = event.pointerId;
            touchStart.current = { index, x: event.clientX, wasPinned: pinnedDate === sessions[index]?.tradeDate, moved: false, previousPinnedDate: pinnedDate };
            lastTouchTimestamp.current = event.timeStamp;
            selectSession(index);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (touchPointer.current !== event.pointerId || !sessions.length) return;
            const index = touchIndex(event);
            if (touchStart.current && (index !== touchStart.current.index || Math.abs(event.clientX - touchStart.current.x) > 8)) touchStart.current.moved = true;
            lastTouchTimestamp.current = event.timeStamp;
            selectSession(index);
          }}
          onPointerUp={(event) => {
            if (touchPointer.current !== event.pointerId) return;
            lastTouchTimestamp.current = event.timeStamp;
            if (touchStart.current?.wasPinned && !touchStart.current.moved) { setPinnedDate(null); setActiveDate(null); }
            else selectSession(touchIndex(event));
            touchPointer.current = null;
            touchStart.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { setPinnedDate(touchStart.current?.previousPinnedDate ?? null); touchPointer.current = null; touchStart.current = null; setActiveDate(null); }}>
          <svg viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} preserveAspectRatio="none" className={styles['macro-svg']} aria-hidden="true">
            {priceTicks.map((tick) => <line key={tick.y} x1="0" x2={PLOT_WIDTH} y1={tick.y} y2={tick.y} className={styles['macro-grid']} vectorEffect="non-scaling-stroke" />)}
            {tickIndices.map((index) => <line key={index} x1={(index + 0.5) * slot} x2={(index + 0.5) * slot} y1="0" y2={PLOT_HEIGHT} className={styles['macro-grid']} vectorEffect="non-scaling-stroke" />)}
            <line x1="0" x2={PLOT_WIDTH} y1={BIAS_ZERO - BIAS_HEIGHT} y2={BIAS_ZERO - BIAS_HEIGHT} className={styles['macro-grid']} vectorEffect="non-scaling-stroke" /><line x1="0" x2={PLOT_WIDTH} y1={BIAS_ZERO} y2={BIAS_ZERO} className={styles['macro-zero']} vectorEffect="non-scaling-stroke" /><line x1="0" x2={PLOT_WIDTH} y1={BIAS_ZERO + BIAS_HEIGHT} y2={BIAS_ZERO + BIAS_HEIGHT} className={styles['macro-grid']} vectorEffect="non-scaling-stroke" />
            {sessions.map((session, index) => {
              const center = (index + 0.5) * slot;
              const candle = session.candle;
              const score = session.mark?.score;
              const barHeight = score === undefined ? 0 : Math.abs(score) / 100 * BIAS_HEIGHT;
              const bodyWidth = Math.min(13, slot * 0.46);
              const color = candle && candle.close >= candle.open ? '#f0f4ed' : '#8c9a9e';
              const isLatest = session.tradeDate === latestMark?.tradeDate;
              return (
                <g key={session.tradeDate} data-trade-date={session.tradeDate}>
                  {score !== undefined ? score === 0 ? <line x1={center - bodyWidth / 2} x2={center + bodyWidth / 2} y1={BIAS_ZERO} y2={BIAS_ZERO} stroke={isLatest ? '#d8e8bc' : barColor(score)} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /> : <rect x={center - bodyWidth / 2} y={score > 0 ? BIAS_ZERO - barHeight : BIAS_ZERO} width={bodyWidth} height={barHeight} fill={barColor(score)} fillOpacity="0.55" stroke={isLatest ? '#d8e8bc' : 'none'} strokeWidth="0.8" vectorEffect="non-scaling-stroke" /> : null}
                  {candle ? <><line x1={center} x2={center} y1={priceY(candle.high)} y2={priceY(candle.low)} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" /><rect x={center - bodyWidth / 2} y={Math.min(priceY(candle.open), priceY(candle.close))} width={bodyWidth} height={Math.max(1, Math.abs(priceY(candle.open) - priceY(candle.close)))} fill={color} stroke={color} strokeWidth="0.5" vectorEffect="non-scaling-stroke" /></> : null}
                </g>
              );
            })}
            {selectedSession ? <g><line x1={(selectedIndex + 0.5) * slot} x2={(selectedIndex + 0.5) * slot} y1="0" y2={PLOT_HEIGHT} className={styles['macro-crosshair']} vectorEffect="non-scaling-stroke" />{selectedSession.candle ? <circle cx={(selectedIndex + 0.5) * slot} cy={priceY(selectedSession.candle.close)} r="3" fill="#d8e8bc" stroke="#111512" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /> : null}</g> : null}
          </svg>
          <p className={styles['macro-bias-caption']}>Daily bias</p>
          {!history.candles.length ? <p className={styles['macro-empty-price']}>{instrument} prices not available</p> : null}{!history.marks.length ? <p className={styles['macro-empty-score']}>Daily scores not available</p> : null}
          <div className={styles['macro-hit-areas']}>
            {sessions.map((session, index) => <button key={session.tradeDate} ref={(button) => { buttonRefs.current[index] = button; }} type="button" className={styles['macro-session']} tabIndex={index === selectedIndex ? 0 : -1} aria-label={`${formatTradeDate(session.tradeDate)}. Macro Bias ${session.mark ? `${formatScore(session.mark.score)}, ${formatBiasLabel(session.mark.biasLabel)}` : 'not available'}. ${instrument} close ${session.candle ? formatUsd(session.candle.close) : 'not available'}.`} aria-pressed={selectedIndex === index} aria-describedby={index === selectedIndex ? readoutId : undefined}
              onPointerEnter={(event) => { if (event.pointerType === 'mouse') setActiveDate(session.tradeDate); }}
              onPointerLeave={(event) => { if (event.pointerType === 'mouse') setActiveDate((current) => current === session.tradeDate ? null : current); }}
              onFocus={() => setActiveDate(session.tradeDate)} onBlur={() => setActiveDate((current) => current === session.tradeDate ? null : current)}
              onClick={(event) => { if (event.detail > 0 && event.timeStamp - lastTouchTimestamp.current < 750) return; setPinnedDate(pinnedDate === session.tradeDate ? null : session.tradeDate); setActiveDate(null); }}
              onKeyDown={(event) => navigateSession(event, index)} />)}
          </div>
        </div>
        <div className={styles['macro-price-axis']} aria-hidden="true">
          {history.candles.length ? priceTicks.map((tick) => <span key={tick.y} style={{ top: `${tick.y / PLOT_HEIGHT * 100}%` }}>{axisPrice(tick.price, bounds.priceSpan, instrument)}</span>) : null}<span style={{ top: `${(BIAS_ZERO - BIAS_HEIGHT) / PLOT_HEIGHT * 100}%` }}>+100</span><span style={{ top: `${BIAS_ZERO / PLOT_HEIGHT * 100}%` }}>0</span><span style={{ top: `${(BIAS_ZERO + BIAS_HEIGHT) / PLOT_HEIGHT * 100}%` }}>−100</span>
        </div>
        <div className={styles['macro-date-axis']} aria-hidden="true">{tickIndices.map((index) => sessions[index] ? <span key={index}>{shortDate(sessions[index].tradeDate)}</span> : null)}</div>
      </div>

      <div className={styles['macro-chart-footer']}>
        <ul className={styles['macro-legend']} aria-label="Daily bias bars: negative at minus 10 and below, near zero between minus 10 and plus 10, positive at plus 10 and above."><li><i style={{ background: barColor(-10) }} />Negative</li><li><i style={{ background: barColor(0) }} />Near zero</li><li><i style={{ background: barColor(10) }} />Positive</li></ul><p className={styles['macro-hint']}>Hover, tap or use arrow keys</p>
      </div>
      <p className={styles['macro-coverage']}><span>{history.candles.length} price bars · {history.marks.length} scores</span><span>{history.firstDate && history.lastDate ? `${formatTradeDate(history.firstDate)} — ${formatTradeDate(history.lastDate)}` : 'Dates not available'}</span></p>
      <div className={styles['macro-readout']} data-session-readout data-selected-date={selectedSession?.tradeDate ?? ''}>
        <div className={styles['macro-session-nav']}>
          <button type="button" aria-label="Previous session" aria-controls={readoutId} disabled={selectedIndex <= 0} onClick={() => selectSession(selectedIndex - 1)}><Chevron direction="left" /></button><div><p>{!selectedSession ? 'Session details' : isLatestSession ? 'Latest available session' : 'Selected session'}</p><strong>{selectedSession ? formatTradeDate(selectedSession.tradeDate) : 'Not available'}</strong></div><button type="button" aria-label="Next session" aria-controls={readoutId} disabled={selectedIndex >= sessions.length - 1 || !sessions.length} onClick={() => selectSession(selectedIndex + 1)}><Chevron direction="right" /></button>
        </div>
        <div id={readoutId} className={styles['macro-detail-content']} aria-live="polite" aria-atomic="true">
          <div className={styles['macro-bias-detail']}><p>Macro Bias</p><div><strong className={labelTone(selectedSession?.mark?.biasLabel)} data-empty={!selectedSession?.mark}>{selectedSession?.mark ? formatScore(selectedSession.mark.score) : 'Not available'}</strong><span className={labelTone(selectedSession?.mark?.biasLabel)}>{selectedSession?.mark ? formatBiasLabel(selectedSession.mark.biasLabel) : 'Regime not available'}</span></div></div>
          {selectedSession?.candle ? (
            <dl className={styles['macro-price-detail']}>
              <div><dt>{instrument} close</dt><dd>{formatUsd(selectedSession.candle.close)}</dd></div>
              <div><dt>Open</dt><dd>{formatUsd(selectedSession.candle.open)}</dd></div>
              <div className={styles['macro-range-detail']}><dt>Low — high</dt><dd>{`${formatUsd(selectedSession.candle.low)} — ${formatUsd(selectedSession.candle.high)}`}</dd></div>
            </dl>
          ) : (
            <div className={styles['macro-missing-price']} data-price-unavailable>
              <p>{instrument} price</p>
              <p>{selectedSession ? 'Price data isn’t available for this session.' : 'Price data isn’t available.'}</p>
            </div>
          )}
        </div>
      </div>
      {notice ? <p className={styles['macro-notice']}>{sessions.length ? 'Some market data is unavailable. Available sessions are shown above.' : 'Market data is temporarily unavailable. Please check back shortly.'}</p> : null}
    </section>
  );
}
