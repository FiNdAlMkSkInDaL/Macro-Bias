create table if not exists public.daily_market_briefings (
  id uuid primary key default gen_random_uuid(),
  briefing_date date not null,
  trade_date date not null,
  quant_score integer not null check (quant_score between -100 and 100),
  bias_label text not null check (
    bias_label in (
      'EXTREME_RISK_OFF',
      'RISK_OFF',
      'NEUTRAL',
      'RISK_ON',
      'EXTREME_RISK_ON'
    )
  ),
  is_override_active boolean not null,
  news_status text not null check (news_status in ('available', 'unavailable')),
  news_summary text not null,
  news_headlines jsonb not null default '[]'::jsonb,
  analog_reference text,
  brief_content text not null,
  source_model text not null,
  generation_method text not null check (generation_method in ('anthropic', 'fallback')),
  generated_at timestamptz not null default timezone('utc', now())
);

create index if not exists daily_market_briefings_briefing_date_idx
  on public.daily_market_briefings (briefing_date desc);

create index if not exists daily_market_briefings_trade_date_idx
  on public.daily_market_briefings (trade_date desc);

alter table public.daily_market_briefings enable row level security;