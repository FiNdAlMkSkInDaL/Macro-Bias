create table if not exists public.free_subscribers (
  email text primary key,
  status text not null default 'active' check (status in ('active', 'inactive')),
  tier text not null default 'free' check (tier in ('free')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.free_subscribers enable row level security;

drop trigger if exists set_public_free_subscribers_updated_at on public.free_subscribers;
create trigger set_public_free_subscribers_updated_at
  before update on public.free_subscribers
  for each row
  execute function public.set_updated_at();
