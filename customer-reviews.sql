-- Desert Forest Landscape: moderated customer reviews
-- Run in the Supabase SQL Editor for project wfxuxrvygyzonkflpwoq.
create extension if not exists pgcrypto;
create table if not exists public.dfl_customer_reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  email text not null check (char_length(trim(email)) between 3 and 254),
  phone text not null check (char_length(trim(phone)) between 10 and 40),
  rating smallint not null check (rating between 1 and 5),
  review text not null check (char_length(trim(review)) between 10 and 3000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create index if not exists dfl_customer_reviews_status_created_idx on public.dfl_customer_reviews(status,created_at desc);
alter table public.dfl_customer_reviews enable row level security;

revoke all on public.dfl_customer_reviews from anon, authenticated;
grant insert(name,email,phone,rating,review) on public.dfl_customer_reviews to anon;
grant select on public.dfl_customer_reviews to authenticated;
grant update(status,reviewed_at,reviewed_by) on public.dfl_customer_reviews to authenticated;

drop policy if exists "Customers submit pending reviews" on public.dfl_customer_reviews;
create policy "Customers submit pending reviews" on public.dfl_customer_reviews
for insert to anon with check (status='pending' and reviewed_at is null and reviewed_by is null);

drop policy if exists "Admins read reviews" on public.dfl_customer_reviews;
create policy "Admins read reviews" on public.dfl_customer_reviews
for select to authenticated using (
  exists (select 1 from public.dfl_admins a where a.user_id = (select auth.uid()))
);

drop policy if exists "Admins moderate reviews" on public.dfl_customer_reviews;
create policy "Admins moderate reviews" on public.dfl_customer_reviews
for update to authenticated
using (exists (select 1 from public.dfl_admins a where a.user_id = (select auth.uid())))
with check (exists (select 1 from public.dfl_admins a where a.user_id = (select auth.uid())));

-- Expose only approved review content. Never expose private emails or phone numbers.
create or replace view public.dfl_approved_customer_reviews
with (security_barrier=true) as
select id,name,rating,review,created_at
from public.dfl_customer_reviews
where status='approved';
revoke all on public.dfl_approved_customer_reviews from public;
grant select on public.dfl_approved_customer_reviews to anon, authenticated;

-- Automatically record moderator and time without trusting the browser.
create or replace function public.dfl_review_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_at = now();
    new.reviewed_by = auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists dfl_review_audit_trigger on public.dfl_customer_reviews;
create trigger dfl_review_audit_trigger
before update on public.dfl_customer_reviews
for each row execute function public.dfl_review_audit();
