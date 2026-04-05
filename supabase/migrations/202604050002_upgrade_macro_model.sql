-- Upgrade Macro Bias storage for the expanded model.
-- The new engine can ingest VIX, HYG, and CPER and persist richer technical
-- indicator payloads without breaking the current frontend contract.

alter table public.etf_daily_prices
  add column if not exists technical_indicators jsonb not null default '{}'::jsonb;

alter table public.etf_daily_prices
  drop constraint if exists etf_daily_prices_ticker_check;

alter table public.etf_daily_prices
  add constraint etf_daily_prices_ticker_check
  check (ticker in ('SPY', 'QQQ', 'XLP', 'TLT', 'GLD', 'VIX', 'HYG', 'CPER'));

create index if not exists etf_daily_prices_trade_date_idx
  on public.etf_daily_prices (trade_date desc);

alter table public.macro_bias_scores
  add column if not exists model_version text not null default 'macro-model-v2',
  add column if not exists engine_inputs jsonb not null default '{}'::jsonb,
  add column if not exists technical_indicators jsonb not null default '{}'::jsonb;

create index if not exists macro_bias_scores_model_version_idx
  on public.macro_bias_scores (model_version);