-- ============================================================================
-- LearnEra - migration: avatar position, course files and assignments
-- ----------------------------------------------------------------------------
-- Brings an EXISTING database up to date with supabase/schema.sql.
-- It does NOT drop any table and no existing row is deleted. Safe to re-run.
--
-- Changes
--   1. profiles   : new avatar_position (image focal point, e.g. '50% 30%')
--   2. new tables : course_files, assignments, assignment_submissions
--   3. new funcs  : can_manage_course(), belongs_to_course()
--   4. new buckets: course-files (private), submissions (private)
--   5. RLS + storage policies for everything above
--   6. handle_new_user() now stores avatar_position
-- ============================================================================

-- 1) PROFILE IMAGE POSITION --------------------------------------------------
alter table public.profiles
  add column if not exists avatar_position text not null default '50% 50%';

-- 2) NEW TABLES --------------------------------------------------------------
create table if not exists public.course_files (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  title       text not null,
  file_path   text not null,
  uploaded_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  title       text not null,
  description text,
  file_path   text,
  due_date    date,
  created_at  timestamptz not null default now()
);

create table if not exists public.assignment_submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id    uuid not null references public.profiles (id) on delete cascade,
  file_path     text not null,
  submitted_at  timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index if not exists course_files_course_idx on public.course_files (course_id);
create index if not exists assignments_course_idx on public.assignments (course_id);
create index if not exists submissions_assignment_idx on public.assignment_submissions (assignment_id);
create index if not exists submissions_student_idx on public.assignment_submissions (student_id);

-- 3) HELPER FUNCTIONS --------------------------------------------------------
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
      and (
        p.role = 'admin'
        or (p.role = 'instructor' and p.course_id = target_course)
      )
  );
$$;

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
      and (p.role = 'admin' or p.course_id = target_course)
  );
$$;

-- 4) TRIGGER: keep avatar_position in sync with new accounts -----------------
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

-- 5) ROW LEVEL SECURITY ------------------------------------------------------
-- An instructor of a course may read the profiles of that course's members
-- (used by the instructor panel to show student names on submissions).
drop policy if exists profiles_select_course_staff on public.profiles;
create policy profiles_select_course_staff on public.profiles
  for select to authenticated using (public.can_manage_course(course_id));

alter table public.course_files           enable row level security;
alter table public.assignments            enable row level security;
alter table public.assignment_submissions enable row level security;

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

-- 6) STORAGE -----------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('course-files', 'course-files', false)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', false)
on conflict (id) do update set public = excluded.public;

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
