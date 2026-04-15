-- ============================================================
-- Crypto Regime Tracker: Database Migration
-- Adds crypto ticker support and creates crypto-specific tables
-- ============================================================

-- 1. Widen the ticker CHECK constraint on etf_daily_prices to include crypto tickers
ALTER TABLE public.etf_daily_prices
  DROP CONSTRAINT IF EXISTS etf_daily_prices_ticker_check;

ALTER TABLE public.etf_daily_prices
  ADD CONSTRAINT etf_daily_prices_ticker_check
  CHECK (ticker IN (
    'SPY', 'QQQ', 'XLP', 'TLT', 'GLD', 'VIX', 'HYG', 'CPER', 'USO',
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'DXY'
  ));

-- 2. Create crypto_bias_scores table
CREATE TABLE IF NOT EXISTS public.crypto_bias_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date date NOT NULL UNIQUE,
  score integer NOT NULL CHECK (score BETWEEN -100 AND 100),
  bias_label text NOT NULL CHECK (
    bias_label IN ('EXTREME_RISK_OFF', 'RISK_OFF', 'NEUTRAL', 'RISK_ON', 'EXTREME_RISK_ON')
  ),
  component_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  ticker_changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  engine_inputs jsonb,
  technical_indicators jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS crypto_bias_scores_trade_date_idx
  ON public.crypto_bias_scores (trade_date DESC);

CREATE TRIGGER set_crypto_bias_scores_updated_at
  BEFORE UPDATE ON public.crypto_bias_scores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Create crypto_daily_briefings table
CREATE TABLE IF NOT EXISTS public.crypto_daily_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date date NOT NULL UNIQUE,
  brief_content text NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN -100 AND 100),
  bias_label text NOT NULL,
  is_override_active boolean NOT NULL DEFAULT false,
  model_version text NOT NULL DEFAULT 'crypto-model-v1',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS crypto_daily_briefings_trade_date_idx
  ON public.crypto_daily_briefings (trade_date DESC);

-- 4. Add crypto_opted_in column to free_subscribers
ALTER TABLE public.free_subscribers
  ADD COLUMN IF NOT EXISTS crypto_opted_in boolean NOT NULL DEFAULT false;
