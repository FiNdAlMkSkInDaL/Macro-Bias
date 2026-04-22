create table if not exists public.test_lab_regime_artifacts (
  id uuid primary key default gen_random_uuid(),
  source_trade_date date not null,
  artifact_version text not null,
  regime_matrix jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source_trade_date, artifact_version)
);

create index if not exists test_lab_regime_artifacts_trade_date_idx
  on public.test_lab_regime_artifacts (source_trade_date desc);

drop trigger if exists set_test_lab_regime_artifacts_updated_at on public.test_lab_regime_artifacts;

create trigger set_test_lab_regime_artifacts_updated_at
before update on public.test_lab_regime_artifacts
for each row
execute function public.set_updated_at();

create table if not exists public.test_lab_experiments (
  id text primary key,
  title text not null,
  owner_email text not null,
  status text not null check (status in ('proposed', 'running', 'candidate', 'promoted', 'rejected')),
  outcome text not null check (outcome in ('pending', 'promising', 'mixed', 'not_ready', 'promoted')),
  model_version text not null,
  evaluation_window text not null,
  hypothesis text not null,
  notes text not null,
  next_action text not null,
  changed_modules text[] not null default '{}',
  metrics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists test_lab_experiments_status_idx
  on public.test_lab_experiments (status, created_at desc);

drop trigger if exists set_test_lab_experiments_updated_at on public.test_lab_experiments;

create trigger set_test_lab_experiments_updated_at
before update on public.test_lab_experiments
for each row
execute function public.set_updated_at();

alter table public.test_lab_regime_artifacts enable row level security;
alter table public.test_lab_experiments enable row level security;
