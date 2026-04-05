-- Macro Bias storage for daily ETF prices and the derived market regime score.
-- Apply this migration in Supabase before running the ingestion script.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- Raw daily market data. One row per ticker per trading session.
create table if not exists public.etf_daily_prices (
  id uuid primary key default gen_random_uuid(),
  ticker text not null check (ticker in ('SPY', 'QQQ', 'XLP', 'TLT', 'GLD')),
  trade_date date not null,
  open numeric(12, 4) not null,
  high numeric(12, 4) not null,
  low numeric(12, 4) not null,
  close numeric(12, 4) not null,
  adjusted_close numeric(12, 4) not null,
  volume bigint not null default 0,
  source text not null default 'yahoo-chart-api',
  created_at timestamptz not null default timezone('utc', now()),
  unique (ticker, trade_date)
);

create index if not exists etf_daily_prices_ticker_trade_date_idx
  on public.etf_daily_prices (ticker, trade_date desc);

-- Daily score output. The JSON columns store the exact inputs used by the frontend
-- so the read API can respond without rebuilding the calculation every request.
create table if not exists public.macro_bias_scores (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null unique,
  score integer not null check (score between -100 and 100),
  bias_label text not null check (
    bias_label in (
      'EXTREME_RISK_OFF',
      'RISK_OFF',
      'NEUTRAL',
      'RISK_ON',
      'EXTREME_RISK_ON'
    )
  ),
  component_scores jsonb not null default '[]'::jsonb,
  ticker_changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists macro_bias_scores_trade_date_idx
  on public.macro_bias_scores (trade_date desc);

drop trigger if exists set_macro_bias_scores_updated_at on public.macro_bias_scores;

create trigger set_macro_bias_scores_updated_at
before update on public.macro_bias_scores
for each row
execute function public.set_updated_at();

-- RLS is enabled so only trusted server-side code using the service-role key
-- can read and write until you intentionally open policies for authenticated users.
alter table public.etf_daily_prices enable row level security;
alter table public.macro_bias_scores enable row level security;