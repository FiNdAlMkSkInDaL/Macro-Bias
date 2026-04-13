import { ImageResponse } from '@vercel/og';
import { NextResponse, type NextRequest } from 'next/server';

import { getLatestBiasSnapshot } from '../../../lib/market-data/get-latest-bias-snapshot';
import { createSupabaseAdminClient } from '../../../lib/supabase/admin';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const IMAGE_SIZE = {
  width: 1200,
  height: 630,
} as const;

const PANEL_BORDER = '1px solid rgba(255, 255, 255, 0.1)';
const BACKGROUND_COLOR = '#09090b';
const MONO_FONT_FAMILY = 'IBM Plex Mono';
const HEADING_FONT_FAMILY = 'Space Grotesk';
const SIGNAL_STACK = ['Volatility', 'Credit', 'Trend', 'Positioning'] as const;

type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 500 | 700;
  style: 'normal';
};

let ogFontsPromise: Promise<OgFont[]> | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatDisplayDate(tradeDate: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${tradeDate}T00:00:00Z`));
}

function formatScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatBiasLabel(label: string) {
  return label
    .toLowerCase()
    .split('_')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

function getScoreAccent(score: number) {
  if (score >= 20) {
    return '#34d399';
  }

  if (score <= -20) {
    return '#fb7185';
  }

  return '#fafafa';
}

function getRegimeTagline(score: number) {
  if (score >= 20) {
    return 'Structural bids are catching across risk assets. Lean into relative strength and buy clean pullbacks.';
  }

  if (score <= -20) {
    return 'Capital is seeking shelter. Protect gross exposure and fade reflex bounces into overhead supply.';
  }

  return 'Rotation is active without commitment. Keep size small and treat breakout attempts with skepticism.';
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type SnapshotLike = {
  score: number;
  bias_label: string;
  trade_date: string;
};

async function getSnapshotForDate(date: string): Promise<SnapshotLike | null> {
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(date))) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('daily_market_briefings')
    .select('quant_score, bias_label, trade_date')
    .eq('briefing_date', date)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    score: data.quant_score as number,
    bias_label: data.bias_label as string,
    trade_date: data.trade_date as string,
  };
}

async function fetchFont(url: string) {
  const response = await fetch(url, {
    cache: 'force-cache',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch font: ${url}`);
  }

  return response.arrayBuffer();
}

async function loadOgFonts(): Promise<OgFont[]> {
  try {
    const [spaceGrotesk, ibmPlexMono] = await Promise.all([
      fetchFont(
        'https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf',
      ),
      fetchFont(
        'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-Medium.ttf',
      ),
    ]);

    const fonts: OgFont[] = [
      {
        name: HEADING_FONT_FAMILY,
        data: spaceGrotesk,
        weight: 700,
        style: 'normal' as const,
      },
      {
        name: MONO_FONT_FAMILY,
        data: ibmPlexMono,
        weight: 500,
        style: 'normal' as const,
      },
    ];

    return fonts;
  } catch (error) {
    console.error('Failed to load OG fonts.', error);
    return [];
  }
}

function getOgFonts(): Promise<OgFont[]> {
  if (ogFontsPromise) {
    return ogFontsPromise;
  }

  ogFontsPromise = loadOgFonts();
  return ogFontsPromise;
}

export async function GET(request: NextRequest) {
  try {
    const dateParam = request.nextUrl.searchParams.get('date');
    const snapshotPromise = dateParam
      ? getSnapshotForDate(dateParam)
      : getLatestBiasSnapshot();

    const [snapshot, fonts] = await Promise.all([
      snapshotPromise,
      getOgFonts(),
    ]);

    if (!snapshot) {
      return new ImageResponse(
        (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: BACKGROUND_COLOR,
              color: '#fafafa',
              fontFamily: `${HEADING_FONT_FAMILY}, ui-sans-serif, system-ui, sans-serif`,
              fontSize: 42,
              fontWeight: 700,
              letterSpacing: '-0.05em',
            }}
          >
            Macro Bias is warming up today&apos;s terminal readout.
          </div>
        ),
        {
          ...IMAGE_SIZE,
          fonts,
        },
      );
    }

    const score = clamp(snapshot.score, -100, 100);
    const scoreAccent = getScoreAccent(score);
    const gaugeProgress = clamp(((score + 100) / 200) * 100, 0, 100);
    const gaugeNeedleLeft = `${clamp(gaugeProgress, 3, 97)}%`;
    const regimeLabel = formatBiasLabel(snapshot.bias_label);

    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '48px 56px 80px',
            background: BACKGROUND_COLOR,
            color: '#fafafa',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          }}
        >
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 28,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                maxWidth: 760,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontFamily: `${MONO_FONT_FAMILY}, ui-monospace, SFMono-Regular, monospace`,
                  fontSize: 18,
                  fontWeight: 500,
                  letterSpacing: '0.32em',
                  textTransform: 'uppercase',
                  color: '#71717a',
                }}
              >
                [ Regime Data Terminal ]
              </div>
              <div
                style={{
                  display: 'flex',
                  marginTop: 16,
                  fontFamily: `${HEADING_FONT_FAMILY}, ui-sans-serif, system-ui, sans-serif`,
                  fontSize: 70,
                  fontWeight: 700,
                  letterSpacing: '-0.06em',
                  lineHeight: 1,
                }}
              >
                Daily Macro Bias
              </div>
              <div
                style={{
                  display: 'flex',
                  marginTop: 18,
                  maxWidth: 720,
                  fontSize: 24,
                  lineHeight: 1.35,
                  color: '#a1a1aa',
                }}
              >
                Institutional-grade macro regime context for active traders, delivered in a sharp pre-market terminal snapshot.
              </div>
            </div>

            <div
              style={{
                width: 270,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  border: PANEL_BORDER,
                  padding: '16px 18px',
                  background: 'rgba(255, 255, 255, 0.02)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontFamily: `${MONO_FONT_FAMILY}, ui-monospace, SFMono-Regular, monospace`,
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: '0.28em',
                    textTransform: 'uppercase',
                    color: '#71717a',
                  }}
                >
                  Data As Of
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontFamily: `${HEADING_FONT_FAMILY}, ui-sans-serif, system-ui, sans-serif`,
                    fontSize: 24,
                    fontWeight: 700,
                    color: '#fafafa',
                  }}
                >
                  {formatDisplayDate(snapshot.trade_date)}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  border: `1px solid ${scoreAccent}`,
                  padding: '16px 18px',
                  background: 'rgba(255, 255, 255, 0.02)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontFamily: `${MONO_FONT_FAMILY}, ui-monospace, SFMono-Regular, monospace`,
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: '0.28em',
                    textTransform: 'uppercase',
                    color: '#71717a',
                  }}
                >
                  Bias Label
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontFamily: `${MONO_FONT_FAMILY}, ui-monospace, SFMono-Regular, monospace`,
                    fontSize: 20,
                    fontWeight: 500,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: scoreAccent,
                  }}
                >
                  {regimeLabel}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'stretch',
              gap: 24,
              marginTop: 28,
            }}
          >
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: PANEL_BORDER,
                padding: '28px 30px 30px',
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontFamily: `${MONO_FONT_FAMILY}, ui-monospace, SFMono-Regular, monospace`,
                    fontSize: 16,
                    fontWeight: 500,
                    letterSpacing: '0.28em',
                    textTransform: 'uppercase',
                    color: '#71717a',
                  }}
                >
                  Bias Gauge
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 24,
                    marginTop: 18,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      fontFamily: `${HEADING_FONT_FAMILY}, ui-sans-serif, system-ui, sans-serif`,
                      fontSize: 142,
                      fontWeight: 700,
                      letterSpacing: '-0.08em',
                      lineHeight: 0.88,
                      color: scoreAccent,
                    }}
                  >
                    {formatScore(score)}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      marginBottom: 14,
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        fontFamily: `${MONO_FONT_FAMILY}, ui-monospace, SFMono-Regular, monospace`,
                        fontSize: 12,
                        fontWeight: 500,
                        letterSpacing: '0.28em',
                        textTransform: 'uppercase',
                        color: '#71717a',
                      }}
                    >
                      Execution State
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        fontFamily: `${HEADING_FONT_FAMILY}, ui-sans-serif, system-ui, sans-serif`,
                        fontSize: 32,
                        fontWeight: 700,
                        color: '#fafafa',
                      }}
                    >
                      {regimeLabel}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    marginTop: 18,
                    maxWidth: 720,
                    fontSize: 24,
                    lineHeight: 1.4,
                    color: '#d4d4d8',
                  }}
                >
                  {getRegimeTagline(score)}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  marginTop: 26,
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: 22,
                    display: 'flex',
                    border: PANEL_BORDER,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ width: '33.333%', display: 'flex', background: '#7f1d1d' }} />
                  <div style={{ width: '33.334%', display: 'flex', background: '#27272a' }} />
                  <div style={{ width: '33.333%', display: 'flex', background: '#14532d' }} />
                  <div
                    style={{
                      position: 'absolute',
                      top: -12,
                      left: gaugeNeedleLeft,
                      width: 2,
                      height: 46,
                      display: 'flex',
                      marginLeft: -1,
                      background: '#fafafa',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: -8,
                      left: gaugeNeedleLeft,
                      width: 12,
                      height: 12,
                      display: 'flex',
                      marginLeft: -6,
                      border: '1px solid #fafafa',
                      background: BACKGROUND_COLOR,
                    }}
                  />
                </div>

                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 14,
                    fontFamily: `${MONO_FONT_FAMILY}, ui-monospace, SFMono-Regular, monospace`,
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: '#71717a',
                  }}
                >
                  <div style={{ display: 'flex' }}>Risk Off</div>
                  <div style={{ display: 'flex' }}>Neutral</div>
                  <div style={{ display: 'flex' }}>Risk On</div>
                </div>
              </div>
            </div>

            <div
              style={{
                width: 304,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: PANEL_BORDER,
                padding: '24px 24px 26px',
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontFamily: `${MONO_FONT_FAMILY}, ui-monospace, SFMono-Regular, monospace`,
                    fontSize: 16,
                    fontWeight: 500,
                    letterSpacing: '0.28em',
                    textTransform: 'uppercase',
                    color: '#71717a',
                  }}
                >
                  Signal Stack
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    marginTop: 18,
                  }}
                >
                  {SIGNAL_STACK.map((pillar, index) => (
                    <div
                      key={pillar}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 0',
                        borderTop: index === 0 ? 'none' : PANEL_BORDER,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          gap: 12,
                          alignItems: 'baseline',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            minWidth: 26,
                            fontFamily: `${MONO_FONT_FAMILY}, ui-monospace, SFMono-Regular, monospace`,
                            fontSize: 13,
                            fontWeight: 500,
                            letterSpacing: '0.18em',
                            textTransform: 'uppercase',
                            color: '#71717a',
                          }}
                        >
                          {String(index + 1).padStart(2, '0')}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            fontFamily: `${HEADING_FONT_FAMILY}, ui-sans-serif, system-ui, sans-serif`,
                            fontSize: 22,
                            fontWeight: 700,
                            color: '#fafafa',
                          }}
                        >
                          {pillar}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          fontFamily: `${MONO_FONT_FAMILY}, ui-monospace, SFMono-Regular, monospace`,
                          fontSize: 13,
                          fontWeight: 500,
                          letterSpacing: '0.18em',
                          textTransform: 'uppercase',
                          color: '#a1a1aa',
                        }}
                      >
                        25%
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  paddingTop: 18,
                  borderTop: PANEL_BORDER,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontFamily: `${MONO_FONT_FAMILY}, ui-monospace, SFMono-Regular, monospace`,
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: '0.24em',
                    textTransform: 'uppercase',
                    color: '#71717a',
                  }}
                >
                  Signal Position
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontFamily: `${HEADING_FONT_FAMILY}, ui-sans-serif, system-ui, sans-serif`,
                    fontSize: 54,
                    fontWeight: 700,
                    letterSpacing: '-0.05em',
                    color: '#fafafa',
                  }}
                >
                  {Math.round(gaugeProgress)}%
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontSize: 18,
                    lineHeight: 1.45,
                    color: '#a1a1aa',
                  }}
                >
                  Four-pillar regime stack with equal 25% weighting across volatility, credit, trend, and positioning.
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      {
        ...IMAGE_SIZE,
        fonts,
      },
    );
  } catch (error) {
    console.error('Failed to generate Macro Bias OG image.', error);

    return NextResponse.json(
      {
        error: 'Failed to generate the Macro Bias share image.',
      },
      { status: 500 },
    );
  }
}