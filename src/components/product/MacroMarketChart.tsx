'use client';

import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

import { formatBiasLabel, formatScore, formatTradeDate, formatUsd } from '@/lib/public-proof/format';
import type { LatestRegimeRead, StoredCandle, StoredStockScore } from '@/lib/public-proof/load-public-proof';

import styles from './MacroMarketChart.module.css';

const PLOT_WIDTH = 540;
const PLOT_HEIGHT = 290;
const PRICE_TOP = 12;
const PRICE_BOTTOM = 202;
const BIAS_ZERO = 253;
const BIAS_HEIGHT = 29;
const SESSION_LIMIT = 20;

type MarketSession = {
  tradeDate: string;
  candle: StoredCandle | null;
  mark: StoredStockScore | null;
};

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

function shortDate(tradeDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return tradeDate;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${tradeDate}T00:00:00Z`));
}

function axisPrice(price: number, span: number) {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: span < 5 ? 1 : 0,
    maximumFractionDigits: span < 5 ? 1 : 0,
  });
}

export function MacroMarketChart({
  candles,
  marks,
  latest,
  notice,
}: {
  candles: StoredCandle[];
  marks: StoredStockScore[];
  latest: LatestRegimeRead | null;
  notice: string | null;
}) {
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const chartId = useId();
  const tooltipId = `${chartId}-tip`;

  // Join on trade date: a newer score without a price must not shift the candles.
  const candleMap = new Map(candles.map((candle) => [candle.tradeDate, candle]));
  const scoreMap = new Map(marks.map((mark) => [mark.tradeDate, mark]));
  if (latest) {
    scoreMap.set(latest.tradeDate, {
      tradeDate: latest.tradeDate,
      score: latest.score,
      biasLabel: latest.biasLabel,
    });
  }
  const sessions: MarketSession[] = Array.from(new Set([...candleMap.keys(), ...scoreMap.keys()]))
    .sort()
    .slice(-SESSION_LIMIT)
    .map((tradeDate) => ({
      tradeDate,
      candle: candleMap.get(tradeDate) ?? null,
      mark: scoreMap.get(tradeDate) ?? null,
    }));
  const latestMark = Array.from(scoreMap.values()).sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))[0];
  const latestCandle = Array.from(candleMap.values()).sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))[0];
  const plottedCandles = sessions.flatMap((session) => session.candle ? [session.candle] : []);
  const low = plottedCandles.length ? Math.min(...plottedCandles.map((candle) => candle.low)) : 0;
  const high = plottedCandles.length ? Math.max(...plottedCandles.map((candle) => candle.high)) : 1;
  const rawSpan = high - low;
  const pricePad = rawSpan > 0 ? rawSpan * 0.12 : Math.max(Math.abs(high) * 0.005, 1);
  const minPrice = low - pricePad;
  const maxPrice = high + pricePad;
  const priceSpan = maxPrice - minPrice;
  const slot = PLOT_WIDTH / Math.max(sessions.length, 1);
  const activeIndex = sessions.findIndex((session) => session.tradeDate === activeDate);
  const activeSession = activeIndex >= 0 ? sessions[activeIndex] : null;
  const latestScoreIndex = sessions.findIndex((session) => session.tradeDate === latestMark?.tradeDate);
  const markerPosition = latestMark ? (Math.max(-100, Math.min(100, latestMark.score)) + 100) / 2 : null;
  const dateIndices = Array.from(new Set([
    0,
    Math.round((sessions.length - 1) / 3),
    Math.round((sessions.length - 1) * 2 / 3),
    sessions.length - 1,
  ])).filter((index) => index >= 0);
  const priceTicks = Array.from({ length: 5 }, (_, index) => ({
    y: PRICE_TOP + (PRICE_BOTTOM - PRICE_TOP) * index / 4,
    price: maxPrice - priceSpan * index / 4,
  }));

  function priceY(price: number) {
    return PRICE_TOP + (maxPrice - price) / priceSpan * (PRICE_BOTTOM - PRICE_TOP);
  }

  function closeTransientDate(tradeDate: string) {
    setActiveDate((current) => current === tradeDate ? pinnedDate : current);
  }

  function navigateSession(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setPinnedDate(null);
      setActiveDate(null);
      return;
    }

    const nextIndex = event.key === 'ArrowRight' ? Math.min(index + 1, sessions.length - 1)
      : event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? sessions.length - 1
      : null;

    if (nextIndex === null) return;
    event.preventDefault();
    setPinnedDate(null);
    setActiveDate(sessions[nextIndex].tradeDate);
    buttonRefs.current[nextIndex]?.focus();
  }

  return (
    <section className={styles['macro-panel']} aria-label="Macro Bias market preview">
      <div className={styles['macro-panel-heading']}>
        <p>THE MARKET BEHIND SPY</p>
        <span>{latestMark ? formatTradeDate(latestMark.tradeDate) : 'Score not available'}</span>
      </div>

      <div className={styles['macro-score-row']}>
        <div className={styles['macro-score-read']}>
          <p className={styles['macro-score-caption']}>Latest bias</p>
          <p className={`${styles['macro-score']} ${labelTone(latestMark?.biasLabel)}`}>
            {latestMark ? formatScore(latestMark.score) : '—'}
          </p>
          <p className={`${styles['macro-label']} ${labelTone(latestMark?.biasLabel)}`}>
            {latestMark ? formatBiasLabel(latestMark.biasLabel) : 'Not available'}
          </p>
        </div>
        <div
          className={styles['macro-scale']}
          role="img"
          aria-label={latestMark ? `Macro Bias ${formatScore(latestMark.score)} on a scale from minus 100 to plus 100.` : 'Macro Bias score not available.'}
        >
          <span>−100</span>
          <div className={styles['macro-rail']}>
            <i className={styles['macro-rail-negative']} />
            <i className={styles['macro-rail-neutral']} />
            <i className={styles['macro-rail-positive']} />
            {markerPosition !== null ? <b className={styles['macro-rail-marker']} style={{ left: `${markerPosition}%` }} /> : null}
          </div>
          <span>+100</span>
        </div>
      </div>

      <div className={styles['macro-instrument']}>
        <div>
          <h2>SPY</h2>
          <p>{latestCandle ? formatUsd(latestCandle.close) : 'Price not available'}</p>
        </div>
        <p className={styles['macro-close-date']}>
          {latestCandle ? `Close · ${shortDate(latestCandle.tradeDate)}` : 'Daily price'}
        </p>
      </div>

      <div className={styles['macro-chart']}>
        <div
          className={styles['macro-plot']}
          role="group"
          aria-label={`SPY daily prices and Macro Bias scores, ${sessions.length} sessions. Select a day for details. Use arrow keys to move and Escape to close.`}
        >
          <svg viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} preserveAspectRatio="none" className={styles['macro-svg']} aria-hidden="true">
            {priceTicks.map((tick) => (
              <line key={tick.y} x1="0" x2={PLOT_WIDTH} y1={tick.y} y2={tick.y} className={styles['macro-grid']} vectorEffect="non-scaling-stroke" />
            ))}
            {dateIndices.map((index) => (
              <line key={index} x1={(index + 0.5) * slot} x2={(index + 0.5) * slot} y1="0" y2={PLOT_HEIGHT} className={styles['macro-grid']} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1="0" x2={PLOT_WIDTH} y1={BIAS_ZERO - BIAS_HEIGHT} y2={BIAS_ZERO - BIAS_HEIGHT} className={styles['macro-grid']} vectorEffect="non-scaling-stroke" />
            <line x1="0" x2={PLOT_WIDTH} y1={BIAS_ZERO} y2={BIAS_ZERO} className={styles['macro-zero']} vectorEffect="non-scaling-stroke" />
            <line x1="0" x2={PLOT_WIDTH} y1={BIAS_ZERO + BIAS_HEIGHT} y2={BIAS_ZERO + BIAS_HEIGHT} className={styles['macro-grid']} vectorEffect="non-scaling-stroke" />

            {latestScoreIndex >= 0 ? (
              <line x1={(latestScoreIndex + 0.5) * slot} x2={(latestScoreIndex + 0.5) * slot} y1="0" y2={PLOT_HEIGHT} className={styles['macro-latest-line']} vectorEffect="non-scaling-stroke" />
            ) : null}

            {sessions.map((session, index) => {
              const center = (index + 0.5) * slot;
              const candle = session.candle;
              const score = session.mark?.score;
              const barHeight = score === undefined ? 0 : Math.abs(Math.max(-100, Math.min(100, score))) / 100 * BIAS_HEIGHT;
              const isLatest = session.tradeDate === latestMark?.tradeDate;
              const bodyWidth = Math.min(13, slot * 0.46);
              const candleColor = candle && candle.close >= candle.open ? '#f0f4ed' : '#8c9a9e';

              return (
                <g key={session.tradeDate} data-trade-date={session.tradeDate}>
                  {score !== undefined ? (
                    score === 0 ? (
                      <line x1={center - bodyWidth / 2} x2={center + bodyWidth / 2} y1={BIAS_ZERO} y2={BIAS_ZERO} stroke={isLatest ? '#d8e8bc' : barColor(score)} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                    ) : (
                      <rect
                        x={center - bodyWidth / 2}
                        y={score > 0 ? BIAS_ZERO - barHeight : BIAS_ZERO}
                        width={bodyWidth}
                        height={barHeight}
                        fill={barColor(score)}
                        fillOpacity="0.55"
                        stroke={isLatest ? '#d8e8bc' : 'none'}
                        strokeWidth="0.8"
                        vectorEffect="non-scaling-stroke"
                      />
                    )
                  ) : null}
                  {candle ? (
                    <>
                      <line x1={center} x2={center} y1={priceY(candle.high)} y2={priceY(candle.low)} stroke={candleColor} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                      <rect
                        x={center - bodyWidth / 2}
                        y={Math.min(priceY(candle.open), priceY(candle.close))}
                        width={bodyWidth}
                        height={Math.max(1, Math.abs(priceY(candle.open) - priceY(candle.close)))}
                        fill={candleColor}
                        stroke={candleColor}
                        strokeWidth="0.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    </>
                  ) : null}
                </g>
              );
            })}

            {activeSession ? (
              <g>
                <line x1={(activeIndex + 0.5) * slot} x2={(activeIndex + 0.5) * slot} y1="0" y2={PLOT_HEIGHT} className={styles['macro-crosshair']} vectorEffect="non-scaling-stroke" />
                {activeSession.candle ? (
                  <circle cx={(activeIndex + 0.5) * slot} cy={priceY(activeSession.candle.close)} r="3.5" fill="#d8e8bc" stroke="#101512" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                ) : null}
              </g>
            ) : null}
          </svg>

          {!plottedCandles.length ? <p className={styles['macro-empty-price']}>SPY prices not available</p> : null}
          {!sessions.length ? <p className={styles['macro-empty-score']}>Daily scores not available</p> : null}

          <div className={styles['macro-hit-areas']}>
            {sessions.map((session, index) => (
              <button
                key={session.tradeDate}
                ref={(button) => { buttonRefs.current[index] = button; }}
                type="button"
                className={styles['macro-session']}
                aria-label={`${formatTradeDate(session.tradeDate)}. Macro Bias ${session.mark ? `${formatScore(session.mark.score)}, ${formatBiasLabel(session.mark.biasLabel)}` : 'not available'}. SPY close ${session.candle ? formatUsd(session.candle.close) : 'not available'}.`}
                aria-pressed={pinnedDate === session.tradeDate}
                aria-describedby={activeDate === session.tradeDate ? tooltipId : undefined}
                onPointerEnter={(event) => { if (event.pointerType !== 'touch') setActiveDate(session.tradeDate); }}
                onPointerLeave={(event) => { if (event.pointerType !== 'touch') closeTransientDate(session.tradeDate); }}
                onFocus={() => setActiveDate(session.tradeDate)}
                onBlur={() => closeTransientDate(session.tradeDate)}
                onClick={() => {
                  const nextDate = pinnedDate === session.tradeDate ? null : session.tradeDate;
                  setPinnedDate(nextDate);
                  setActiveDate(nextDate);
                }}
                onKeyDown={(event) => navigateSession(event, index)}
              />
            ))}
          </div>

          {activeSession ? (
            <div
              id={tooltipId}
              role="tooltip"
              className={styles['macro-tip']}
              style={{ '--macro-tip-x': `${(activeIndex + 0.5) / sessions.length * 100}%` } as CSSProperties}
            >
              <p className={styles['macro-tip-date']}>{formatTradeDate(activeSession.tradeDate)}</p>
              <div className={styles['macro-tip-score-row']}>
                <span>Macro Bias</span>
                <strong className={labelTone(activeSession.mark?.biasLabel)}>{activeSession.mark ? formatScore(activeSession.mark.score) : 'Not available'}</strong>
              </div>
              {activeSession.mark ? <p className={`${styles['macro-tip-bias']} ${labelTone(activeSession.mark.biasLabel)}`}>{formatBiasLabel(activeSession.mark.biasLabel)}</p> : null}
              <div className={styles['macro-tip-price']}>
                <p><span>SPY close</span><strong>{activeSession.candle ? formatUsd(activeSession.candle.close) : 'Not available'}</strong></p>
                {activeSession.candle ? (
                  <>
                    <p><span>Open</span><span>{formatUsd(activeSession.candle.open)}</span></p>
                    <p><span>Low — high</span><span>{formatUsd(activeSession.candle.low)} — {formatUsd(activeSession.candle.high)}</span></p>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className={styles['macro-price-axis']} aria-hidden="true">
          {plottedCandles.length ? priceTicks.map((tick) => <span key={tick.y} style={{ top: `${tick.y / PLOT_HEIGHT * 100}%` }}>{axisPrice(tick.price, priceSpan)}</span>) : null}
          <span style={{ top: `${(BIAS_ZERO - BIAS_HEIGHT) / PLOT_HEIGHT * 100}%` }}>+100</span>
          <span style={{ top: `${BIAS_ZERO / PLOT_HEIGHT * 100}%` }}>0</span>
          <span style={{ top: `${(BIAS_ZERO + BIAS_HEIGHT) / PLOT_HEIGHT * 100}%` }}>−100</span>
        </div>

        <div className={styles['macro-date-axis']} aria-hidden="true">
          {dateIndices.map((index) => sessions[index] ? <span key={index}>{shortDate(sessions[index].tradeDate)}</span> : null)}
        </div>
      </div>

      <div className={styles['macro-chart-footer']}>
        <ul className={styles['macro-legend']} aria-label="Daily bias bars: negative at minus 10 and below, mixed between minus 10 and plus 10, positive at plus 10 and above.">
          <li><i style={{ background: barColor(-10) }} />Negative</li>
          <li><i style={{ background: barColor(0) }} />Mixed</li>
          <li><i style={{ background: barColor(10) }} />Positive</li>
        </ul>
        <p className={styles['macro-hint']}>Hover or tap a day</p>
      </div>
      {notice ? (
        <p className={styles['macro-notice']}>
          {sessions.length ? 'Some market data is unavailable. Available sessions are shown above.' : 'Market data is temporarily unavailable. Please check back shortly.'}
        </p>
      ) : null}
    </section>
  );
}
