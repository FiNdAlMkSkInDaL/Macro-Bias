create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  subscription_status text not null default 'inactive' check (
    subscription_status in (
      'inactive',
      'active',
      'trialing',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired'
    )
  ),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.users enable row level security;

create policy "Users can read their own billing row"
  on public.users
  for select
  using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

drop trigger if exists set_public_users_updated_at on public.users;
create trigger set_public_users_updated_at
  before update on public.users
  for each row
  execute function public.set_updated_at();