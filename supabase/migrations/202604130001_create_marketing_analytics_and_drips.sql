create table if not exists public.marketing_event_log (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  page_path text not null,
  session_id text,
  anonymous_id text,
  subscriber_email text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.marketing_event_log enable row level security;

create index if not exists marketing_event_log_event_name_idx
  on public.marketing_event_log (event_name);

create index if not exists marketing_event_log_page_path_idx
  on public.marketing_event_log (page_path);

create index if not exists marketing_event_log_created_at_idx
  on public.marketing_event_log (created_at desc);

create table if not exists public.welcome_email_drip_enrollments (
  email text primary key,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'unsubscribed')),
  enrolled_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.welcome_email_drip_enrollments enable row level security;

create table if not exists public.welcome_email_drip_deliveries (
  id uuid primary key default gen_random_uuid(),
  email text not null references public.welcome_email_drip_enrollments(email) on delete cascade,
  sequence_day integer not null check (sequence_day in (0, 1, 3, 7)),
  sequence_order integer not null check (sequence_order between 1 and 4),
  scheduled_for timestamptz not null,
  delivered_at timestamptz,
  resend_email_id text,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'failed', 'cancelled')),
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (email, sequence_order)
);

alter table public.welcome_email_drip_deliveries enable row level security;

create index if not exists welcome_email_drip_deliveries_status_scheduled_for_idx
  on public.welcome_email_drip_deliveries (status, scheduled_for asc);

drop trigger if exists set_public_welcome_email_drip_enrollments_updated_at on public.welcome_email_drip_enrollments;
create trigger set_public_welcome_email_drip_enrollments_updated_at
  before update on public.welcome_email_drip_enrollments
  for each row
  execute function public.set_updated_at();

drop trigger if exists set_public_welcome_email_drip_deliveries_updated_at on public.welcome_email_drip_deliveries;
create trigger set_public_welcome_email_drip_deliveries_updated_at
  before update on public.welcome_email_drip_deliveries
  for each row
  execute function public.set_updated_at();
