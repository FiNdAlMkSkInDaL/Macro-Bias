import { ImageResponse } from '@vercel/og';
import { NextResponse } from 'next/server';

import { getLatestBiasSnapshot } from '../../../lib/market-data/get-latest-bias-snapshot';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const IMAGE_SIZE = {
  width: 1200,
  height: 630,
} as const;

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

function getScoreAccent(score: number) {
  if (score >= 20) {
    return '#22c55e';
  }

  if (score <= -20) {
    return '#f97316';
  }

  return '#f8fafc';
}

function getRegimeTagline(score: number) {
  if (score >= 20) {
    return 'Risk appetite is expanding across the tape.';
  }

  if (score <= -20) {
    return 'Defensive positioning is overpowering cyclical momentum.';
  }

  return 'Cross-asset signals are split and conviction is selective.';
}

export async function GET() {
  try {
    const snapshot = await getLatestBiasSnapshot();

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
              background: '#020617',
              color: '#f8fafc',
              fontSize: 42,
              letterSpacing: '-0.04em',
            }}
          >
            Macro Bias is warming up today&apos;s weather report.
          </div>
        ),
        IMAGE_SIZE,
      );
    }

    const score = clamp(snapshot.score, -100, 100);
    const gaugeProgress = clamp(((score + 100) / 200) * 100, 0, 100);
    const scoreAccent = getScoreAccent(score);
    const regimeLabel = snapshot.bias_label.replace(/_/g, ' ');
    const gaugeNeedleLeft = `${clamp(gaugeProgress, 4, 96)}%`;

    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(145deg, #020617 0%, #0f172a 58%, #111827 100%)',
            color: '#f8fafc',
            fontFamily:
              'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -160,
              right: -140,
              width: 520,
              height: 520,
              display: 'flex',
              borderRadius: 9999,
              background: 'radial-gradient(circle, rgba(56,189,248,0.22) 0%, rgba(15,23,42,0) 72%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: -220,
              left: -120,
              width: 520,
              height: 520,
              display: 'flex',
              borderRadius: 9999,
              background: 'radial-gradient(circle, rgba(34,197,94,0.15) 0%, rgba(15,23,42,0) 70%)',
            }}
          />
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '54px 64px',
            }}
          >
            <div
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 760 }}>
                <div
                  style={{
                    display: 'flex',
                    fontSize: 20,
                    letterSpacing: '0.28em',
                    textTransform: 'uppercase',
                    color: '#94a3b8',
                  }}
                >
                  Macro Bias
                </div>
                <div
                  style={{
                    display: 'flex',
                    marginTop: 18,
                    fontSize: 66,
                    fontWeight: 700,
                    letterSpacing: '-0.05em',
                    lineHeight: 1,
                  }}
                >
                  Today&apos;s Macro Weather Report.
                </div>
                <div
                  style={{
                    display: 'flex',
                    marginTop: 20,
                    fontSize: 24,
                    color: '#cbd5e1',
                  }}
                >
                  Live cross-asset regime context for active traders and fast risk decisions.
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    padding: '12px 18px',
                    borderRadius: 9999,
                    border: '1px solid rgba(148,163,184,0.22)',
                    background: 'rgba(15,23,42,0.68)',
                    fontSize: 18,
                    color: '#e2e8f0',
                  }}
                >
                  {formatDisplayDate(snapshot.trade_date)}
                </div>
                <div
                  style={{
                    display: 'flex',
                    padding: '10px 16px',
                    borderRadius: 9999,
                    background: 'rgba(15,23,42,0.6)',
                    border: `1px solid ${scoreAccent}`,
                    fontSize: 18,
                    color: scoreAccent,
                    textTransform: 'uppercase',
                    letterSpacing: '0.18em',
                  }}
                >
                  {regimeLabel}
                </div>
              </div>
            </div>

            <div
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'stretch',
                gap: 28,
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: 32,
                  border: '1px solid rgba(148,163,184,0.18)',
                  background: 'rgba(15,23,42,0.72)',
                  padding: '30px 32px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    fontSize: 18,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    color: '#94a3b8',
                  }}
                >
                  Macro Bias Gauge
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 20,
                    marginTop: 18,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      fontSize: 132,
                      fontWeight: 800,
                      letterSpacing: '-0.08em',
                      color: scoreAccent,
                      lineHeight: 0.9,
                    }}
                  >
                    {formatScore(score)}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      fontSize: 30,
                      color: '#e2e8f0',
                    }}
                  >
                    {regimeLabel}
                  </div>
                </div>

                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: 26,
                    display: 'flex',
                    marginTop: 28,
                    borderRadius: 9999,
                    background:
                      'linear-gradient(90deg, #7f1d1d 0%, #ea580c 26%, #f8fafc 50%, #65a30d 74%, #166534 100%)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 2,
                      display: 'flex',
                      borderRadius: 9999,
                      background: 'rgba(2,6,23,0.28)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: -10,
                      left: gaugeNeedleLeft,
                      width: 6,
                      height: 46,
                      display: 'flex',
                      marginLeft: -3,
                      borderRadius: 9999,
                      background: '#f8fafc',
                      boxShadow: '0 0 0 4px rgba(15,23,42,0.5)',
                    }}
                  />
                </div>

                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 16,
                    fontSize: 18,
                    color: '#94a3b8',
                  }}
                >
                  <div style={{ display: 'flex' }}>Risk Off</div>
                  <div style={{ display: 'flex' }}>Neutral</div>
                  <div style={{ display: 'flex' }}>Risk On</div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    marginTop: 26,
                    fontSize: 24,
                    color: '#e2e8f0',
                    lineHeight: 1.35,
                  }}
                >
                  {getRegimeTagline(score)}
                </div>
              </div>

              <div
                style={{
                  width: 290,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  borderRadius: 32,
                  border: '1px solid rgba(148,163,184,0.18)',
                  background: 'rgba(15,23,42,0.72)',
                  padding: '28px 26px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div
                    style={{
                      display: 'flex',
                      fontSize: 16,
                      letterSpacing: '0.22em',
                      textTransform: 'uppercase',
                      color: '#94a3b8',
                    }}
                  >
                    Signal Stack
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', fontSize: 18, color: '#e2e8f0' }}>
                      Volatility
                    </div>
                    <div style={{ display: 'flex', fontSize: 18, color: '#e2e8f0' }}>
                      Credit
                    </div>
                    <div style={{ display: 'flex', fontSize: 18, color: '#e2e8f0' }}>
                      Trend
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div
                    style={{
                      display: 'flex',
                      fontSize: 54,
                      fontWeight: 700,
                      letterSpacing: '-0.05em',
                      color: '#f8fafc',
                    }}
                  >
                    {Math.round(gaugeProgress)}%
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      fontSize: 18,
                      color: '#94a3b8',
                      lineHeight: 1.4,
                    }}
                  >
                    Signal position across the full -100 to +100 macro regime range.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      IMAGE_SIZE,
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