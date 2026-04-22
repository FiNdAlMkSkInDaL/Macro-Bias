create extension if not exists pgcrypto;

create table if not exists public.paper_trading_runs (
  id uuid primary key default gen_random_uuid(),
  briefing_date date not null unique,
  source_trade_date date not null,
  daily_market_briefing_id uuid not null references public.daily_market_briefings (id) on delete restrict,
  macro_bias_score_id uuid not null references public.macro_bias_scores (id) on delete restrict,
  asset text not null default 'SPY' check (asset in ('SPY')),
  decision text not null check (decision in ('BUY', 'SELL', 'HOLD')),
  target_spy_weight numeric(6, 4) not null check (target_spy_weight >= 0 and target_spy_weight <= 1),
  target_cash_weight numeric(6, 4) not null check (target_cash_weight >= 0 and target_cash_weight <= 1),
  conviction_score integer not null check (conviction_score between 0 and 100),
  reasoning_summary text not null check (char_length(trim(reasoning_summary)) > 0),
  risk_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(risk_flags) = 'array'),
  prompt_version text not null check (char_length(trim(prompt_version)) > 0),
  source_model text not null check (char_length(trim(source_model)) > 0),
  generation_method text not null check (generation_method in ('anthropic', 'fallback')),
  prompt_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(prompt_payload) = 'object'),
  decision_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(decision_payload) = 'object'),
  raw_response text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (round(target_spy_weight + target_cash_weight, 4) = 1.0000)
);

create index if not exists paper_trading_runs_briefing_date_idx
  on public.paper_trading_runs (briefing_date desc);

create index if not exists paper_trading_runs_source_trade_date_idx
  on public.paper_trading_runs (source_trade_date desc);

create index if not exists paper_trading_runs_status_briefing_date_idx
  on public.paper_trading_runs (status, briefing_date desc);

create index if not exists paper_trading_runs_daily_market_briefing_id_idx
  on public.paper_trading_runs (daily_market_briefing_id);

create index if not exists paper_trading_runs_macro_bias_score_id_idx
  on public.paper_trading_runs (macro_bias_score_id);

create table if not exists public.paper_trading_executions (
  id uuid primary key default gen_random_uuid(),
  paper_trading_run_id uuid not null references public.paper_trading_runs (id) on delete cascade,
  briefing_date date not null,
  pricing_trade_date date not null,
  executed_at timestamptz not null default timezone('utc', now()),
  asset text not null default 'SPY' check (asset in ('SPY')),
  side text not null check (side in ('BUY', 'SELL')),
  quantity numeric(18, 6) not null check (quantity > 0),
  price numeric(12, 4) not null check (price > 0),
  notional numeric(18, 4) not null check (notional >= 0),
  conviction_score integer not null check (conviction_score between 0 and 100),
  price_source text not null default 'etf_daily_prices.close' check (char_length(trim(price_source)) > 0),
  cash_balance_after numeric(18, 4) not null check (cash_balance_after >= 0),
  position_quantity_after numeric(18, 6) not null check (position_quantity_after >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists paper_trading_executions_run_id_idx
  on public.paper_trading_executions (paper_trading_run_id);

create index if not exists paper_trading_executions_briefing_date_idx
  on public.paper_trading_executions (briefing_date desc);

create index if not exists paper_trading_executions_asset_briefing_date_idx
  on public.paper_trading_executions (asset, briefing_date desc);

create index if not exists paper_trading_executions_pricing_trade_date_idx
  on public.paper_trading_executions (pricing_trade_date desc);

create index if not exists paper_trading_executions_run_id_executed_at_idx
  on public.paper_trading_executions (paper_trading_run_id, executed_at asc);

create table if not exists public.paper_trading_portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  paper_trading_run_id uuid not null unique references public.paper_trading_runs (id) on delete cascade,
  briefing_date date not null unique,
  pricing_trade_date date not null,
  asset text not null default 'SPY' check (asset in ('SPY')),
  cash_balance numeric(18, 4) not null check (cash_balance >= 0),
  position_quantity numeric(18, 6) not null default 0 check (position_quantity >= 0),
  position_avg_cost numeric(12, 4) check (position_avg_cost is null or position_avg_cost > 0),
  mark_price numeric(12, 4) not null check (mark_price > 0),
  position_market_value numeric(18, 4) not null check (position_market_value >= 0),
  total_equity numeric(18, 4) not null check (total_equity >= 0),
  daily_pnl numeric(18, 4) not null,
  daily_return_pct numeric(10, 4) not null,
  total_return_pct numeric(10, 4) not null,
  cash_weight numeric(6, 4) not null check (cash_weight >= 0 and cash_weight <= 1),
  asset_weight numeric(6, 4) not null check (asset_weight >= 0 and asset_weight <= 1),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (round(cash_balance + position_market_value, 4) = round(total_equity, 4)),
  check (round(cash_weight + asset_weight, 4) = 1.0000)
);

create index if not exists paper_trading_portfolio_snapshots_briefing_date_idx
  on public.paper_trading_portfolio_snapshots (briefing_date desc);

create index if not exists paper_trading_portfolio_snapshots_asset_briefing_date_idx
  on public.paper_trading_portfolio_snapshots (asset, briefing_date desc);

create index if not exists paper_trading_portfolio_snapshots_pricing_trade_date_idx
  on public.paper_trading_portfolio_snapshots (pricing_trade_date desc);

drop trigger if exists set_paper_trading_runs_updated_at on public.paper_trading_runs;
create trigger set_paper_trading_runs_updated_at
  before update on public.paper_trading_runs
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_paper_trading_portfolio_snapshots_updated_at on public.paper_trading_portfolio_snapshots;
create trigger set_paper_trading_portfolio_snapshots_updated_at
  before update on public.paper_trading_portfolio_snapshots
  for each row
  execute function public.set_updated_at();

alter table public.paper_trading_runs enable row level security;
alter table public.paper_trading_runs force row level security;

alter table public.paper_trading_executions enable row level security;
alter table public.paper_trading_executions force row level security;

alter table public.paper_trading_portfolio_snapshots enable row level security;
alter table public.paper_trading_portfolio_snapshots force row level security;

revoke all on table public.paper_trading_runs from public, anon, authenticated;
revoke all on table public.paper_trading_executions from public, anon, authenticated;
revoke all on table public.paper_trading_portfolio_snapshots from public, anon, authenticated;
