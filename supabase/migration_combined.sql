-- ============================================================================
-- LearnEra - COMBINED migration (catch-up script)
-- ----------------------------------------------------------------------------
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste ALL of this file -> Run
--   SAFE TO RE-RUN: it never drops a table and never deletes a row or a file.
--
-- WHY
--   Brings ANY LearnEra database (fresh or from an older release) up to the
--   current structure in a single run. It is the five individual migrations
--   applied in the right order, plus a fix that guarantees the column
--   public.profiles.avatar_position exists BEFORE any function, policy or app
--   query uses it (that missing column is what raises
--   'column "avatar_position" does not exist').
--
-- WHAT IT CREATES / UPDATES
--   1. courses               : course_dates (real dates) instead of course_days
--   2. profiles              : member_id (the hand-typed ID) + avatar_position
--   3. other tables          : coordinator_courses, attendance, certificates,
--                              course_files, assignments, assignment_submissions
--                              (with grade / feedback / graded_at), announcements
--   4. primary key           : profiles.member_id becomes the primary key
--   5. functions             : is_admin, can_manage_course, belongs_to_course,
--                              handle_new_user, admin_delete_account,
--                              update_my_avatar, grade_submission
--   6. indexes, RLS policies and the four storage buckets
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================ 1. TABLES ====================================

-- Courses -------------------------------------------------------------------
create table if not exists public.courses (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  location     text not null default 'online' check (location in ('online', 'offline')),
  course_dates date[] not null default '{}',
  created_at   timestamptz not null default now()
);

-- The weekday column of the very first release becomes a list of real dates.
alter table public.courses add column if not exists course_dates date[] not null default '{}';
alter table public.courses drop column if exists course_days;

-- Profiles (one row per auth user) ------------------------------------------
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

-- 'create table if not exists' never adds columns to an existing table, so the
-- columns introduced after the first release are added explicitly here.
alter table public.profiles add column if not exists member_id text;
alter table public.profiles add column if not exists avatar_position text not null default '50% 50%';

-- Give every pre-existing account an ID so the column can become required.
update public.profiles
set member_id = 'USR-' || upper(substring(replace(id::text, '-', '') from 1 for 8))
where member_id is null or member_id = '';

alter table public.profiles alter column member_id set not null;

-- member_id must be unique before other tables can reference it (only needed
-- while profiles.member_id is not yet the primary key).
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conname = 'profiles_member_id_key'
      and c.conrelid = 'public.profiles'::regclass
  ) and not exists (
    select 1 from pg_constraint c
    where c.conname = 'profiles_pkey'
      and c.conrelid = 'public.profiles'::regclass
      and pg_get_constraintdef(c.oid) ilike '%(member_id)%'
  ) then
    alter table public.profiles add constraint profiles_member_id_key unique (member_id);
  end if;
end $$;

-- Staff course access: an instructor or a coordinator manages several courses.
create table if not exists public.coordinator_courses (
  member_id  text not null references public.profiles (member_id) on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, course_id)
);

-- Attendance ----------------------------------------------------------------
create table if not exists public.attendance (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.profiles (id) on delete cascade,
  course_id     uuid references public.courses (id) on delete set null,
  session_date  date not null default current_date,
  status        text not null check (status in ('present', 'absent')),
  created_at    timestamptz not null default now()
);

-- Certificates --------------------------------------------------------------
create table if not exists public.certificates (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.profiles (id) on delete cascade,
  course_id   uuid not null references public.courses (id) on delete cascade,
  file_path   text not null,
  issued_at   timestamptz not null default now()
);

-- Course files --------------------------------------------------------------
create table if not exists public.course_files (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  title       text not null,
  file_path   text not null,
  uploaded_at timestamptz not null default now()
);

-- Assignments ---------------------------------------------------------------
create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  title       text not null,
  description text,
  file_path   text,
  due_date    date,
  created_at  timestamptz not null default now()
);

-- Assignment submissions (one solution file per student per assignment) -----
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

alter table public.assignment_submissions add column if not exists grade numeric;
alter table public.assignment_submissions add column if not exists feedback text;
alter table public.assignment_submissions add column if not exists graded_at timestamptz;

-- Announcements -------------------------------------------------------------
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  title      text not null,
  body       text,
  author_id  uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ================= 2. PRIMARY KEY -> profiles.member_id =====================
-- All the tables now exist, so it is safe to swap the key: profiles.id (the
-- Supabase auth UUID) stays unique for auth + RLS, member_id becomes the key.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conname = 'profiles_pkey'
      and c.conrelid = 'public.profiles'::regclass
      and pg_get_constraintdef(c.oid) ilike '%(member_id)%'
  ) then
    alter table public.attendance             drop constraint if exists attendance_student_id_fkey;
    alter table public.certificates           drop constraint if exists certificates_student_id_fkey;
    alter table public.assignment_submissions drop constraint if exists assignment_submissions_student_id_fkey;

    alter table public.profiles alter column id set not null;
    alter table public.profiles drop constraint if exists profiles_member_id_key;
    alter table public.profiles drop constraint if exists profiles_pkey;
    alter table public.profiles add constraint profiles_id_key unique (id);
    alter table public.profiles add constraint profiles_pkey primary key (member_id);

    alter table public.attendance add constraint attendance_student_id_fkey
      foreign key (student_id) references public.profiles (id) on delete cascade;
    alter table public.certificates add constraint certificates_student_id_fkey
      foreign key (student_id) references public.profiles (id) on delete cascade;
    alter table public.assignment_submissions add constraint assignment_submissions_student_id_fkey
      foreign key (student_id) references public.profiles (id) on delete cascade;
  end if;
end $$;

-- ============================= 3. INDEXES ==================================
create index if not exists coordinator_courses_member_idx on public.coordinator_courses (member_id);
create index if not exists attendance_student_idx         on public.attendance (student_id);
create index if not exists certificates_student_idx       on public.certificates (student_id);
create index if not exists course_files_course_idx        on public.course_files (course_id);
create index if not exists assignments_course_idx         on public.assignments (course_id);
create index if not exists submissions_assignment_idx     on public.assignment_submissions (assignment_id);
create index if not exists submissions_student_idx        on public.assignment_submissions (student_id);
create index if not exists announcements_course_idx       on public.announcements (course_id);

-- ============================ 4. FUNCTIONS =================================

-- True when the caller is an administrator.
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

-- True when the caller may manage content for the course: an administrator, or
-- a staff member (instructor / coordinator) linked to it - through
-- profiles.course_id or through the coordinator_courses table.
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

-- True when the caller belongs to the course (assigned student, or a staff
-- member who manages it) - or is an administrator.
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

-- Auto-create a profile for every new auth user (uses avatar_position).
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

-- Admin-only: delete an account completely (auth user cascades to profiles).
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

-- Self-service: a user changes their own picture and its position.
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

-- Staff: set the grade and the feedback of a submission.
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

-- ========================= ROW LEVEL SECURITY ==============================
alter table public.courses                enable row level security;
alter table public.profiles               enable row level security;
alter table public.coordinator_courses    enable row level security;
alter table public.attendance             enable row level security;
alter table public.certificates           enable row level security;
alter table public.course_files           enable row level security;
alter table public.assignments            enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.announcements          enable row level security;

-- Courses -------------------------------------------------------------------
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

-- Profiles ------------------------------------------------------------------
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

drop policy if exists profiles_select_course_staff on public.profiles;
create policy profiles_select_course_staff on public.profiles
  for select to authenticated using (public.can_manage_course(course_id));

-- Attendance ----------------------------------------------------------------
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

-- retire the previous admin-only attendance policies
drop policy if exists attendance_select_own_or_admin on public.attendance;
drop policy if exists attendance_insert_admin on public.attendance;
drop policy if exists attendance_update_admin on public.attendance;
drop policy if exists attendance_delete_admin on public.attendance;

-- Certificates --------------------------------------------------------------
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

-- Course files --------------------------------------------------------------
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

-- Assignments ---------------------------------------------------------------
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

-- Submissions ---------------------------------------------------------------
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

-- Coordinator / instructor course access ------------------------------------
drop policy if exists coordinator_courses_select_own_or_admin on public.coordinator_courses;
create policy coordinator_courses_select_own_or_admin on public.coordinator_courses
  for select to authenticated using (
    member_id = (select p.member_id from public.profiles p where p.id = auth.uid())
    or public.is_admin()
  );

drop policy if exists coordinator_courses_write_admin on public.coordinator_courses;
create policy coordinator_courses_write_admin on public.coordinator_courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Announcements -------------------------------------------------------------
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
-- avatars      : public read (plain URL) + admin write + self-service write
-- certificates : private (short-lived signed URLs)
-- course-files : private, readable by the course members
-- submissions  : private, readable by the owning student and the course staff

insert into storage.buckets (id, name, public) values ('avatars',      'avatars',      true)  on conflict (id) do update set public = excluded.public;
insert into storage.buckets (id, name, public) values ('certificates', 'certificates', false) on conflict (id) do update set public = excluded.public;
insert into storage.buckets (id, name, public) values ('course-files', 'course-files', false) on conflict (id) do update set public = excluded.public;
insert into storage.buckets (id, name, public) values ('submissions',  'submissions',  false) on conflict (id) do update set public = excluded.public;

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
-- DEFAULT ADMIN ACCOUNT (optional)
-- Create the user in Dashboard -> Authentication -> Users first, then run:
--   insert into public.profiles (id, full_name, email, role, member_id)
--   select id, 'Administrator', email, 'admin', 'ADMIN'
--   from auth.users where email = 'admin@learnera.com'
--   on conflict (id) do update set role = 'admin', full_name = 'Administrator';
-- ============================================================================
