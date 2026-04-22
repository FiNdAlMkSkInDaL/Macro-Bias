-- Security hardening migration:
-- - restores RLS on every repo-managed table
-- - forces explicit opt-in access instead of implicit public exposure
-- - creates repo-managed compatibility tables that were previously unmanaged
-- - removes unsafe function defaults that could bypass table protections

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  is_pro boolean not null default false,
  stripe_customer_id text unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  post_body text not null,
  link text,
  status text not null default 'scheduled' check (status in ('scheduled', 'published', 'failed', 'cancelled')),
  scheduled_at timestamptz not null,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists scheduled_posts_status_scheduled_at_idx
  on public.scheduled_posts (status, scheduled_at asc);

insert into public.profiles (id)
select id
from auth.users
on conflict (id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email;

  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists set_public_profiles_updated_at on public.profiles;
create trigger set_public_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_public_scheduled_posts_updated_at on public.scheduled_posts;
create trigger set_public_scheduled_posts_updated_at
  before update on public.scheduled_posts
  for each row
  execute function public.set_updated_at();

alter table public.etf_daily_prices enable row level security;
alter table public.etf_daily_prices force row level security;

alter table public.macro_bias_scores enable row level security;
alter table public.macro_bias_scores force row level security;

alter table public.users enable row level security;
alter table public.users force row level security;

alter table public.published_marketing_posts enable row level security;
alter table public.published_marketing_posts force row level security;

alter table public.daily_market_briefings enable row level security;
alter table public.daily_market_briefings force row level security;

alter table public.free_subscribers enable row level security;
alter table public.free_subscribers force row level security;

alter table public.marketing_event_log enable row level security;
alter table public.marketing_event_log force row level security;

alter table public.welcome_email_drip_enrollments enable row level security;
alter table public.welcome_email_drip_enrollments force row level security;

alter table public.welcome_email_drip_deliveries enable row level security;
alter table public.welcome_email_drip_deliveries force row level security;

alter table public.crypto_bias_scores enable row level security;
alter table public.crypto_bias_scores force row level security;

alter table public.crypto_daily_briefings enable row level security;
alter table public.crypto_daily_briefings force row level security;

alter table public.referrals enable row level security;
alter table public.referrals force row level security;

alter table public.referral_rewards enable row level security;
alter table public.referral_rewards force row level security;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

alter table public.scheduled_posts enable row level security;
alter table public.scheduled_posts force row level security;

revoke all on table public.etf_daily_prices from public, anon, authenticated;
revoke all on table public.macro_bias_scores from public, anon, authenticated;
revoke all on table public.users from public, anon, authenticated;
revoke all on table public.published_marketing_posts from public, anon, authenticated;
revoke all on table public.daily_market_briefings from public, anon, authenticated;
revoke all on table public.free_subscribers from public, anon, authenticated;
revoke all on table public.marketing_event_log from public, anon, authenticated;
revoke all on table public.welcome_email_drip_enrollments from public, anon, authenticated;
revoke all on table public.welcome_email_drip_deliveries from public, anon, authenticated;
revoke all on table public.crypto_bias_scores from public, anon, authenticated;
revoke all on table public.crypto_daily_briefings from public, anon, authenticated;
revoke all on table public.referrals from public, anon, authenticated;
revoke all on table public.referral_rewards from public, anon, authenticated;
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.scheduled_posts from public, anon, authenticated;

grant select on table public.users to authenticated;
grant select on table public.profiles to authenticated;

drop policy if exists "Users can read their own billing row" on public.users;
create policy "Users can read their own billing row"
  on public.users
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Users can read their own profile compatibility row" on public.profiles;
create policy "Users can read their own profile compatibility row"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

create or replace function public.get_top_pages(since timestamptz, lim int default 15)
returns table(page_path text, view_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select page_path, count(*) as view_count
  from marketing_event_log
  where event_name = 'page_view'
    and created_at >= since
    and page_path is not null
  group by page_path
  order by view_count desc
  limit lim;
$$;

create or replace function public.get_top_events(since timestamptz, lim int default 15)
returns table(event_name text, event_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select event_name, count(*) as event_count
  from marketing_event_log
  where created_at >= since
  group by event_name
  order by event_count desc
  limit lim;
$$;

create or replace function public.get_utm_sources(since timestamptz, lim int default 15)
returns table(utm_source text, source_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(utm_source, '(direct)') as utm_source, count(*) as source_count
  from marketing_event_log
  where created_at >= since
    and event_name = 'page_view'
  group by utm_source
  order by source_count desc
  limit lim;
$$;

create or replace function public.get_top_referrers(lim int default 10)
returns table(referrer_email text, verified_count bigint, pending_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    referrer_email,
    count(*) filter (where status = 'verified') as verified_count,
    count(*) filter (where status = 'pending') as pending_count
  from referrals
  group by referrer_email
  order by verified_count desc, pending_count desc
  limit lim;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.get_top_pages(timestamptz, int) from public, anon, authenticated;
revoke execute on function public.get_top_events(timestamptz, int) from public, anon, authenticated;
revoke execute on function public.get_utm_sources(timestamptz, int) from public, anon, authenticated;
revoke execute on function public.get_top_referrers(int) from public, anon, authenticated;

grant execute on function public.get_top_pages(timestamptz, int) to service_role;
grant execute on function public.get_top_events(timestamptz, int) to service_role;
grant execute on function public.get_utm_sources(timestamptz, int) to service_role;
grant execute on function public.get_top_referrers(int) to service_role;
