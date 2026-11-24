-- ============================================================================
-- LearnEra - Supabase schema, Row Level Security and storage setup
-- ----------------------------------------------------------------------------
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste ALL of this file -> Run
--   It is safe to run more than once (everything is idempotent).
--
-- WHAT IT CREATES
--   tables : courses, profiles, attendance, certificates
--   views  : none
--   funcs  : is_admin(), handle_new_user() trigger, admin_delete_account()
--   buckets: avatars (public), certificates (private)
--   RLS    : everyone can read only their own data; only admins can write
-- ============================================================================

create extension if not exists pgcrypto;

-- =========================== TABLES ========================================

-- Courses ------------------------------------------------------------------
create table if not exists public.courses (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  location     text not null default 'online' check (location in ('online', 'offline')),
  course_days  text[] not null default '{}',
  created_at   timestamptz not null default now()
);

-- Profiles (one row per auth user) -----------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  email       text not null,
  role        text not null default 'student'
              check (role in ('admin', 'student', 'coordinator', 'instructor')),
  course_id   uuid references public.courses (id) on delete set null,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- Attendance ---------------------------------------------------------------
create table if not exists public.attendance (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.profiles (id) on delete cascade,
  course_id     uuid references public.courses (id) on delete set null,
  session_date  date not null default current_date,
  status        text not null check (status in ('present', 'absent')),
  created_at    timestamptz not null default now()
);

-- Certificates -------------------------------------------------------------
create table if not exists public.certificates (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.profiles (id) on delete cascade,
  course_id   uuid not null references public.courses (id) on delete cascade,
  file_path   text not null,
  issued_at   timestamptz not null default now()
);

create index if not exists attendance_student_idx on public.attendance (student_id);
create index if not exists certificates_student_idx on public.certificates (student_id);

-- ====================== HELPER FUNCTION ====================================

-- True when the caller is an administrator. SECURITY DEFINER is required so
-- the check can read public.profiles without triggering its own RLS policies.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ============== AUTO-CREATE A PROFILE FOR EVERY NEW USER ===================
-- The admin page creates accounts with supabase.auth.signUp(). This trigger
-- turns the metadata sent with that call into the matching profile row.
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

  insert into public.profiles (id, full_name, email, role, course_id, avatar_url)
  values (
    new.id,
    coalesce(nullif(meta->>'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    wanted_role,
    nullif(meta->>'course_id', '')::uuid,
    nullif(meta->>'avatar_url', '')
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============ ADMIN-ONLY RPC: DELETE AN ACCOUNT COMPLETELY =================
-- Removing the auth user cascades to profiles, attendance and certificates.
create or replace function public.admin_delete_account(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  delete from auth.users where id = target_id;
end;
$$;

revoke all on function public.admin_delete_account(uuid) from public;
grant execute on function public.admin_delete_account(uuid) to authenticated;

-- ============================ ROW LEVEL SECURITY ===========================

alter table public.courses      enable row level security;
alter table public.profiles     enable row level security;
alter table public.attendance   enable row level security;
alter table public.certificates enable row level security;

-- Courses: any signed-in user reads the course list (needed for dropdowns
-- and for showing the student their own course). Only admins write.
drop policy if exists courses_select_authenticated on public.courses;
create policy courses_select_authenticated on public.courses
  for select to authenticated using (true);

drop policy if exists courses_insert_admin on public.courses;
create policy courses_insert_admin on public.courses
  for insert to authenticated with check (public.is_admin());

drop policy if exists courses_update_admin on public.courses;
create policy courses_update_admin on public.courses
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists courses_delete_admin on public.courses;
create policy courses_delete_admin on public.courses
  for delete to authenticated using (public.is_admin());

-- Profiles: a user reads only their own row; admins read everything.
-- Nobody writes profiles except admins (so a student can never change their role).
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated with check (public.is_admin());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles
  for delete to authenticated using (public.is_admin());

-- Attendance: students see only their own records; admins see and write all.
drop policy if exists attendance_select_own_or_admin on public.attendance;
create policy attendance_select_own_or_admin on public.attendance
  for select to authenticated using (student_id = auth.uid() or public.is_admin());

drop policy if exists attendance_insert_admin on public.attendance;
create policy attendance_insert_admin on public.attendance
  for insert to authenticated with check (public.is_admin());

drop policy if exists attendance_update_admin on public.attendance;
create policy attendance_update_admin on public.attendance
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists attendance_delete_admin on public.attendance;
create policy attendance_delete_admin on public.attendance
  for delete to authenticated using (public.is_admin());

-- Certificates: students see only their own certificate records.
drop policy if exists certificates_select_own_or_admin on public.certificates;
create policy certificates_select_own_or_admin on public.certificates
  for select to authenticated using (student_id = auth.uid() or public.is_admin());

drop policy if exists certificates_insert_admin on public.certificates;
create policy certificates_insert_admin on public.certificates
  for insert to authenticated with check (public.is_admin());

drop policy if exists certificates_update_admin on public.certificates;
create policy certificates_update_admin on public.certificates
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists certificates_delete_admin on public.certificates;
create policy certificates_delete_admin on public.certificates
  for delete to authenticated using (public.is_admin());

-- ============================== STORAGE ====================================
-- avatars       : public read (so profile pictures can be shown with a plain URL)
-- certificates  : private (accessed through short-lived signed URLs)

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('certificates', 'certificates', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists avatars_admin_insert on storage.objects;
create policy avatars_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars' and public.is_admin());

drop policy if exists avatars_admin_update on storage.objects;
create policy avatars_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'avatars' and public.is_admin());

drop policy if exists avatars_admin_delete on storage.objects;
create policy avatars_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and public.is_admin());

-- A student may read a certificate file only when a certificate record for that
-- exact file belongs to them (path convention: course_id/student_id/file).
drop policy if exists certificates_read_own_or_admin on storage.objects;
create policy certificates_read_own_or_admin on storage.objects
  for select to authenticated using (
    bucket_id = 'certificates'
    and (
      public.is_admin()
      or exists (
        select 1 from public.certificates c
        where c.file_path = storage.objects.name
          and c.student_id = auth.uid()
      )
    )
  );

drop policy if exists certificates_admin_insert on storage.objects;
create policy certificates_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'certificates' and public.is_admin());

drop policy if exists certificates_admin_update on storage.objects;
create policy certificates_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'certificates' and public.is_admin());

drop policy if exists certificates_admin_delete on storage.objects;
create policy certificates_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'certificates' and public.is_admin());

-- ============================================================================
-- DEFAULT ADMIN ACCOUNT
-- ----------------------------------------------------------------------------
-- The password must NEVER live in a file inside this website. Create the admin
-- user in the dashboard, then promote it here. See README.md for full steps.
--
-- 1) Dashboard -> Authentication -> Users -> "Add user"
--      Email:    admin@learnera.com
--      Password: <the password you chose>
--      [x] Auto Confirm User
--
-- 2) Then run this (works whether or not the trigger already created the row):
-- ----------------------------------------------------------------------------
-- insert into public.profiles (id, full_name, email, role)
-- select id, 'Administrator', email, 'admin'
-- from auth.users
-- where email = 'admin@learnera.com'
-- on conflict (id) do update set role = 'admin', full_name = 'Administrator';
-- ============================================================================

-- ============================================================================
-- OPTIONAL: attendance data
-- The admin page manages courses, accounts and certificates. Attendance rows
-- (used by the student dashboard for attendance days / absence days /
-- completion %) are inserted here or in Table Editor.
--
-- insert into public.attendance (student_id, course_id, session_date, status)
-- select p.id, p.course_id, d::date, case when random() < 0.85 then 'present' else 'absent' end
-- from public.profiles p
-- cross join generate_series(current_date - interval '9 days', current_date, interval '1 day') d
-- where p.role = 'student';
-- ============================================================================
