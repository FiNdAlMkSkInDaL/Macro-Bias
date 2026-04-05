-- Enable the KNN analog engine to persist USO alongside the existing
-- macro series and mark the latest engine version at the score table.

alter table public.etf_daily_prices
  drop constraint if exists etf_daily_prices_ticker_check;

alter table public.etf_daily_prices
  add constraint etf_daily_prices_ticker_check
  check (ticker in ('SPY', 'QQQ', 'XLP', 'TLT', 'GLD', 'VIX', 'HYG', 'CPER', 'USO'));

alter table public.macro_bias_scores
  alter column model_version set default 'macro-model-v3-knn';