-- ============================================================================
-- LearnEra - Supabase schema, Row Level Security and storage setup
-- ----------------------------------------------------------------------------
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste ALL of this file -> Run
--   It is safe to run more than once (everything is idempotent).
--
-- WHAT IT CREATES
--   tables : courses, profiles, coordinator_courses, attendance, certificates,
--            course_files, assignments, assignment_submissions, announcements
--   views  : none
--   funcs  : is_admin(), can_manage_course(), belongs_to_course(),
--            update_my_avatar(), grade_submission(), handle_new_user() trigger,
--            admin_delete_account()
--   buckets: avatars (public), certificates (private), course-files (private),
--            submissions (private)
--   RLS    : read limited to own data; admins, course instructors and course
--            coordinators write
--
-- NOTE: profiles.member_id (the ID entered by hand when creating an account) is
--       the PRIMARY KEY. profiles.id is the Supabase auth UUID, kept as a unique
--       column for authentication and Row Level Security.
-- ============================================================================

create extension if not exists pgcrypto;

-- =========================== TABLES ========================================

-- Courses ------------------------------------------------------------------
create table if not exists public.courses (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  location     text not null default 'online' check (location in ('online', 'offline')),
  course_dates date[] not null default '{}',
  created_at   timestamptz not null default now()
);

-- Profiles (one row per auth user) -----------------------------------------
-- member_id is the ID typed by hand when the account is created and is the
-- PRIMARY KEY; id is the Supabase auth UUID and stays unique for auth + RLS.
create table if not exists public.profiles (
  member_id   text primary key,
  id          uuid not null unique references auth.users (id) on delete cascade,
  full_name   text not null,
  email       text not null,
  role        text not null default 'student'
              check (role in ('admin', 'student', 'coordinator', 'instructor')),
  course_id   uuid references public.courses (id) on delete set null,
  avatar_url  text,
  avatar_position text not null default '50% 50%',
  created_at  timestamptz not null default now()
);

-- create table if not exists never adds columns to a table that already exists,
-- so make sure avatar_position is present on a database created before it.
alter table public.profiles add column if not exists avatar_position text not null default '50% 50%';

-- Staff course access (an instructor or coordinator can manage several) -----
create table if not exists public.coordinator_courses (
  member_id  text not null references public.profiles (member_id) on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, course_id)
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

-- Course files (material the instructor/admin shares with the course) ------
create table if not exists public.course_files (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  title       text not null,
  file_path   text not null,
  uploaded_at timestamptz not null default now()
);

-- Assignments (homework the instructor/admin sends to the course) ----------
create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  title       text not null,
  description text,
  file_path   text,
  due_date    date,
  created_at  timestamptz not null default now()
);

-- Assignment submissions (one solution file per student per assignment) ----
-- grade / feedback / graded_at are filled in by the course staff.
create table if not exists public.assignment_submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id    uuid not null references public.profiles (id) on delete cascade,
  file_path     text not null,
  submitted_at  timestamptz not null default now(),
  grade         numeric,
  feedback      text,
  graded_at     timestamptz,
  unique (assignment_id, student_id)
);

-- Add the grading columns when upgrading a database created before them.
alter table public.assignment_submissions add column if not exists grade numeric;
alter table public.assignment_submissions add column if not exists feedback text;
alter table public.assignment_submissions add column if not exists graded_at timestamptz;

-- Announcements (a coordinator / instructor posts news to a course) ---------
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  title      text not null,
  body       text,
  author_id  uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_student_idx on public.attendance (student_id);
create index if not exists certificates_student_idx on public.certificates (student_id);
create index if not exists course_files_course_idx on public.course_files (course_id);
create index if not exists assignments_course_idx on public.assignments (course_id);
create index if not exists submissions_assignment_idx on public.assignment_submissions (assignment_id);
create index if not exists submissions_student_idx on public.assignment_submissions (student_id);
create index if not exists coordinator_courses_member_idx on public.coordinator_courses (member_id);
create index if not exists announcements_course_idx on public.announcements (course_id);

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

-- True when the caller may manage content for the given course: an
-- administrator, or a staff member (instructor / coordinator) linked to it -
-- either through profiles.course_id or through the coordinator_courses table.
create or replace function public.can_manage_course(target_course uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'instructor', 'coordinator')
      and (
        p.role = 'admin'
        or p.course_id = target_course
        or exists (
          select 1 from public.coordinator_courses cc
          where cc.member_id = p.member_id and cc.course_id = target_course
        )
      )
  );
$$;

-- True when the caller belongs to the given course (student assigned to it, or
-- an instructor / coordinator who manages it) - or is an administrator.
create or replace function public.belongs_to_course(target_course uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or p.course_id = target_course
        or (
          p.role in ('coordinator', 'instructor')
          and exists (
            select 1 from public.coordinator_courses cc
            where cc.member_id = p.member_id and cc.course_id = target_course
          )
        )
      )
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

  insert into public.profiles (id, full_name, email, role, course_id, avatar_url, avatar_position, member_id)
  values (
    new.id,
    coalesce(nullif(meta->>'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    wanted_role,
    nullif(meta->>'course_id', '')::uuid,
    nullif(meta->>'avatar_url', ''),
    coalesce(nullif(meta->>'avatar_position', ''), '50% 50%'),
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

-- ============ SELF-SERVICE RPC: UPDATE MY OWN AVATAR / POSITION ============
-- A user may change their own picture and its position, but nothing else
-- (RLS itself keeps all other profile columns admin-only).
create or replace function public.update_my_avatar(new_avatar_url text, new_avatar_position text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set avatar_url = coalesce(nullif(new_avatar_url, ''), avatar_url),
         avatar_position = coalesce(nullif(new_avatar_position, ''), avatar_position)
   where id = auth.uid();
end;
$$;

revoke all on function public.update_my_avatar(text, text) from public;
grant execute on function public.update_my_avatar(text, text) to authenticated;

-- ============ STAFF RPC: GRADE A STUDENT'S SUBMISSION =====================
-- The course staff (admins, the course's instructor and its coordinators) may
-- set the grade and the feedback of a submission. The student keeps the right
-- to read them through the normal RLS select policy.
create or replace function public.grade_submission(target_id uuid, new_grade numeric, new_feedback text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_course uuid;
begin
  select a.course_id into target_course
  from public.assignment_submissions s
  join public.assignments a on a.id = s.assignment_id
  where s.id = target_id;

  if target_course is null then
    raise exception 'Submission not found';
  end if;
  if not public.can_manage_course(target_course) then
    raise exception 'Not authorized';
  end if;

  update public.assignment_submissions
     set grade     = new_grade,
         feedback  = nullif(new_feedback, ''),
         graded_at = now()
   where id = target_id;
end;
$$;

revoke all on function public.grade_submission(uuid, numeric, text) from public;
grant execute on function public.grade_submission(uuid, numeric, text) to authenticated;

-- ============================ ROW LEVEL SECURITY ===========================

alter table public.courses                enable row level security;
alter table public.profiles               enable row level security;
alter table public.coordinator_courses    enable row level security;
alter table public.attendance             enable row level security;
alter table public.certificates           enable row level security;
alter table public.course_files           enable row level security;
alter table public.assignments            enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.announcements          enable row level security;

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

-- Course staff (an instructor of a course) additionally read the profiles of
-- the members of that course, so the instructor panel can show student names.
drop policy if exists profiles_select_course_staff on public.profiles;
create policy profiles_select_course_staff on public.profiles
  for select to authenticated using (public.can_manage_course(course_id));

-- Attendance: students see only their own records; the course's staff (admins,
-- its instructor and its coordinators) read and write the whole course.
drop policy if exists attendance_select_own_or_manager on public.attendance;
create policy attendance_select_own_or_manager on public.attendance
  for select to authenticated using (
    student_id = auth.uid() or public.can_manage_course(course_id)
  );

drop policy if exists attendance_insert_manager on public.attendance;
create policy attendance_insert_manager on public.attendance
  for insert to authenticated with check (public.can_manage_course(course_id));

drop policy if exists attendance_update_manager on public.attendance;
create policy attendance_update_manager on public.attendance
  for update to authenticated using (public.can_manage_course(course_id))
  with check (public.can_manage_course(course_id));

drop policy if exists attendance_delete_manager on public.attendance;
create policy attendance_delete_manager on public.attendance
  for delete to authenticated using (public.can_manage_course(course_id));

-- Drop the previous admin-only attendance policies if an older schema is being
-- upgraded in place.
drop policy if exists attendance_select_own_or_admin on public.attendance;
drop policy if exists attendance_insert_admin on public.attendance;
drop policy if exists attendance_update_admin on public.attendance;
drop policy if exists attendance_delete_admin on public.attendance;

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

-- Course files: members of the course read; admins and its instructor write.
drop policy if exists course_files_select_member on public.course_files;
create policy course_files_select_member on public.course_files
  for select to authenticated using (public.belongs_to_course(course_id));

drop policy if exists course_files_insert_manager on public.course_files;
create policy course_files_insert_manager on public.course_files
  for insert to authenticated with check (public.can_manage_course(course_id));

drop policy if exists course_files_update_manager on public.course_files;
create policy course_files_update_manager on public.course_files
  for update to authenticated using (public.can_manage_course(course_id))
  with check (public.can_manage_course(course_id));

drop policy if exists course_files_delete_manager on public.course_files;
create policy course_files_delete_manager on public.course_files
  for delete to authenticated using (public.can_manage_course(course_id));

-- Assignments: members of the course read; admins and its instructor write.
drop policy if exists assignments_select_member on public.assignments;
create policy assignments_select_member on public.assignments
  for select to authenticated using (public.belongs_to_course(course_id));

drop policy if exists assignments_insert_manager on public.assignments;
create policy assignments_insert_manager on public.assignments
  for insert to authenticated with check (public.can_manage_course(course_id));

drop policy if exists assignments_update_manager on public.assignments;
create policy assignments_update_manager on public.assignments
  for update to authenticated using (public.can_manage_course(course_id))
  with check (public.can_manage_course(course_id));

drop policy if exists assignments_delete_manager on public.assignments;
create policy assignments_delete_manager on public.assignments
  for delete to authenticated using (public.can_manage_course(course_id));

-- Submissions: a student reads/writes only their own; the course's instructor
-- (and admins) read them.
drop policy if exists submissions_select_own_or_manager on public.assignment_submissions;
create policy submissions_select_own_or_manager on public.assignment_submissions
  for select to authenticated using (
    student_id = auth.uid()
    or public.can_manage_course((select a.course_id from public.assignments a where a.id = assignment_id))
  );

drop policy if exists submissions_insert_own on public.assignment_submissions;
create policy submissions_insert_own on public.assignment_submissions
  for insert to authenticated with check (student_id = auth.uid());

drop policy if exists submissions_update_own on public.assignment_submissions;
create policy submissions_update_own on public.assignment_submissions
  for update to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid());

drop policy if exists submissions_delete_own_or_manager on public.assignment_submissions;
create policy submissions_delete_own_or_manager on public.assignment_submissions
  for delete to authenticated using (student_id = auth.uid());

-- Coordinator course access: a coordinator reads their own links; admins manage.
drop policy if exists coordinator_courses_select_own_or_admin on public.coordinator_courses;
create policy coordinator_courses_select_own_or_admin on public.coordinator_courses
  for select to authenticated using (
    member_id = (select p.member_id from public.profiles p where p.id = auth.uid())
    or public.is_admin()
  );

drop policy if exists coordinator_courses_write_admin on public.coordinator_courses;
create policy coordinator_courses_write_admin on public.coordinator_courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Announcements: the course members read them; the course staff write them.
drop policy if exists announcements_select_member on public.announcements;
create policy announcements_select_member on public.announcements
  for select to authenticated using (public.belongs_to_course(course_id));

drop policy if exists announcements_insert_manager on public.announcements;
create policy announcements_insert_manager on public.announcements
  for insert to authenticated with check (public.can_manage_course(course_id));

drop policy if exists announcements_update_manager on public.announcements;
create policy announcements_update_manager on public.announcements
  for update to authenticated using (public.can_manage_course(course_id))
  with check (public.can_manage_course(course_id));

drop policy if exists announcements_delete_manager on public.announcements;
create policy announcements_delete_manager on public.announcements
  for delete to authenticated using (public.can_manage_course(course_id));

-- ============================== STORAGE ====================================
-- avatars      : public read (so profile pictures can be shown with a plain URL)
-- certificates : private (accessed through short-lived signed URLs)
-- course-files : private, readable by the course members
-- submissions  : private, readable by the owning student and the course staff

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('certificates', 'certificates', false)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('course-files', 'course-files', false)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
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

-- A user may change their own picture: self-service uploads live under
-- avatars/<their auth uid>/... (used by the Settings dialog).
drop policy if exists avatars_self_insert on storage.objects;
create policy avatars_self_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_self_update on storage.objects;
create policy avatars_self_update on storage.objects
  for update to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_self_delete on storage.objects;
create policy avatars_self_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

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

-- Course files (path convention: course_id/file). The course members read the
-- files; the admins and that course's instructor upload/delete them.
drop policy if exists course_files_read_member on storage.objects;
create policy course_files_read_member on storage.objects
  for select to authenticated using (
    bucket_id = 'course-files'
    and public.belongs_to_course((storage.foldername(name))[1]::uuid)
  );

drop policy if exists course_files_write_manager on storage.objects;
create policy course_files_write_manager on storage.objects
  for insert to authenticated with check (
    bucket_id = 'course-files'
    and public.can_manage_course((storage.foldername(name))[1]::uuid)
  );

drop policy if exists course_files_delete_manager on storage.objects;
create policy course_files_delete_manager on storage.objects
  for delete to authenticated using (
    bucket_id = 'course-files'
    and public.can_manage_course((storage.foldername(name))[1]::uuid)
  );

-- Submissions (path convention: assignment_id/student_id/file). A student reads
-- and writes only inside their own folder; the course staff read everything.
drop policy if exists submissions_read_own_or_manager on storage.objects;
create policy submissions_read_own_or_manager on storage.objects
  for select to authenticated using (
    bucket_id = 'submissions'
    and (
      (storage.foldername(name))[2]::uuid = auth.uid()
      or public.can_manage_course(
        (select a.course_id from public.assignments a where a.id = (storage.foldername(name))[1]::uuid)
      )
    )
  );

drop policy if exists submissions_write_own on storage.objects;
create policy submissions_write_own on storage.objects
  for insert to authenticated with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[2]::uuid = auth.uid()
  );

drop policy if exists submissions_delete_own on storage.objects;
create policy submissions_delete_own on storage.objects
  for delete to authenticated using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[2]::uuid = auth.uid()
  );

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
-- insert into public.profiles (id, full_name, email, role, member_id)
-- select id, 'Administrator', email, 'admin', 'ADMIN'
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
