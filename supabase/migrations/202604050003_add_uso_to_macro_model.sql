-- Expand the macro-model raw price universe to include crude oil.

alter table public.etf_daily_prices
  drop constraint if exists etf_daily_prices_ticker_check;

alter table public.etf_daily_prices
  add constraint etf_daily_prices_ticker_check
  check (ticker in ('SPY', 'QQQ', 'XLP', 'TLT', 'GLD', 'VIX', 'HYG', 'CPER', 'USO'));