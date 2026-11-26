-- ============================================================================
-- LearnEra - migration: course dates + account ID
-- ----------------------------------------------------------------------------
-- Brings an EXISTING database up to date with supabase/schema.sql.
-- It does NOT drop any table, and no account, course, attendance or
-- certificate row is deleted. Run once in the Supabase SQL Editor.
--
-- Changes
--   1. courses : course_days (weekday names) -> course_dates (real dates)
--   2. profiles: new member_id (text, required, unique) e.g. student number
--   3. handle_new_user() trigger now stores member_id
-- ============================================================================

-- 1) COURSES: a list of real dates instead of weekday names ------------------
alter table public.courses
  add column if not exists course_dates date[] not null default '{}';

-- The old weekday values (e.g. 'Monday') cannot be turned into real dates, so
-- the obsolete column is removed. Every course row itself is preserved and its
-- new course_dates list simply starts empty (edit the course to set dates).
alter table public.courses
  drop column if exists course_days;

-- 2) PROFILES: an account ID such as a student number ------------------------
alter table public.profiles
  add column if not exists member_id text;

-- Backfill the existing accounts with a unique placeholder so the column can
-- become required. Replace these with the real numbers in the admin page.
update public.profiles
set member_id = 'USR-' || upper(substring(replace(id::text, '-', '') from 1 for 8))
where member_id is null or member_id = '';

alter table public.profiles
  alter column member_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_member_id_key'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_member_id_key unique (member_id);
  end if;
end $$;

-- 3) TRIGGER: keep the profile in sync with newly created accounts -----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted_role text := coalesce(nullif(meta->>'role', ''), 'student');
begin
  if wanted_role not in ('admin', 'student', 'coordinator', 'instructor') then
    wanted_role := 'student';
  end if;

  insert into public.profiles (id, full_name, email, role, course_id, avatar_url, member_id)
  values (
    new.id,
    coalesce(nullif(meta->>'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    wanted_role,
    nullif(meta->>'course_id', '')::uuid,
    nullif(meta->>'avatar_url', ''),
    coalesce(nullif(meta->>'member_id', ''), 'USR-' || upper(substring(replace(new.id::text, '-', '') from 1 for 8)))
  )
  on conflict (id) do update
    set full_name  = excluded.full_name,
        email      = excluded.email,
        role       = excluded.role,
        course_id  = excluded.course_id,
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);

  return new;
end;
$$;

-- The default admin account also needs an ID (optional, adjust as you like):
-- update public.profiles set member_id = 'ADMIN' where email = 'admin@learnera.com';
-- ============================================================================
