create table if not exists public.published_marketing_posts (
  slug text primary key,
  published_at timestamptz not null default now()
);

alter table public.published_marketing_posts disable row level security;