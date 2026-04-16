-- Analytics dashboard helper functions (admin only, no RLS bypass needed - called via service role)

-- Top pages by page_view count
create or replace function public.get_top_pages(since timestamptz, lim int default 15)
returns table(page_path text, view_count bigint) as $$
  select page_path, count(*) as view_count
  from marketing_event_log
  where event_name = 'page_view'
    and created_at >= since
    and page_path is not null
  group by page_path
  order by view_count desc
  limit lim;
$$ language sql stable security definer;

-- Top events by count
create or replace function public.get_top_events(since timestamptz, lim int default 15)
returns table(event_name text, event_count bigint) as $$
  select event_name, count(*) as event_count
  from marketing_event_log
  where created_at >= since
  group by event_name
  order by event_count desc
  limit lim;
$$ language sql stable security definer;

-- UTM source breakdown
create or replace function public.get_utm_sources(since timestamptz, lim int default 15)
returns table(utm_source text, source_count bigint) as $$
  select coalesce(utm_source, '(direct)') as utm_source, count(*) as source_count
  from marketing_event_log
  where created_at >= since
    and event_name = 'page_view'
  group by utm_source
  order by source_count desc
  limit lim;
$$ language sql stable security definer;

-- Top referrers by verified referral count
create or replace function public.get_top_referrers(lim int default 10)
returns table(referrer_email text, verified_count bigint, pending_count bigint) as $$
  select
    referrer_email,
    count(*) filter (where status = 'verified') as verified_count,
    count(*) filter (where status = 'pending') as pending_count
  from referrals
  group by referrer_email
  order by verified_count desc, pending_count desc
  limit lim;
$$ language sql stable security definer;
