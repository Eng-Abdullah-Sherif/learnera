-- ============================================================================
-- LearnEra - migration: coordinator role, announcements and self-service
--                             profile settings
-- ----------------------------------------------------------------------------
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste ALL of this file -> Run
--   Safe to run more than once. No row is ever deleted.
--
-- It applies, on top of an existing database:
--   1) profiles.member_id (the ID typed by hand) becomes the PRIMARY KEY;
--      profiles.id stays as the unique Supabase auth UUID used by auth + RLS.
--   2) coordinator_courses  - a coordinator can be linked to several courses.
--   3) announcements        - course news shown in the students' bell.
--   4) can_manage_course() / belongs_to_course() now also honour coordinators.
--   5) attendance may be written by the course staff (admin / instructor /
--      coordinator), not only by admins.
--   6) update_my_avatar()   - a user may change their own picture + position.
--   7) avatars storage: a user may upload to avatars/<their auth uid>/...
-- ============================================================================

-- 1) profiles: make the manually entered ID the primary key -------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conname = 'profiles_pkey'
      and c.conrelid = 'public.profiles'::regclass
      and pg_get_constraintdef(c.oid) ilike '%(member_id)%'
  ) then
    -- The child tables reference profiles(id); drop those FKs first so the old
    -- primary key can be replaced.
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

-- 2) coordinator course access -------------------------------------------------
create table if not exists public.coordinator_courses (
  member_id  text not null references public.profiles (member_id) on delete cascade,
  course_id  uuid not null references public.courses (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, course_id)
);
create index if not exists coordinator_courses_member_idx on public.coordinator_courses (member_id);

-- 3) announcements -------------------------------------------------------------
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  title      text not null,
  body       text,
  author_id  uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists announcements_course_idx on public.announcements (course_id);

-- 4) helper functions honour coordinators -------------------------------------
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
        or (
          p.role = 'coordinator'
          and exists (
            select 1 from public.coordinator_courses cc
            where cc.member_id = p.member_id and cc.course_id = target_course
          )
        )
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
      and (
        p.role = 'admin'
        or p.course_id = target_course
        or (
          p.role = 'coordinator'
          and exists (
            select 1 from public.coordinator_courses cc
            where cc.member_id = p.member_id and cc.course_id = target_course
          )
        )
      )
  );
$$;

-- 6) self-service avatar / position -------------------------------------------
-- The column must exist before update_my_avatar() references it. It is normally
-- added by migration_course_files_assignments.sql, but this file must not rely
-- on that one having been run first.
alter table public.profiles
  add column if not exists avatar_position text not null default '50% 50%';

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

-- 5) + row level security ------------------------------------------------------
alter table public.coordinator_courses enable row level security;
alter table public.announcements       enable row level security;

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

drop policy if exists coordinator_courses_select_own_or_admin on public.coordinator_courses;
create policy coordinator_courses_select_own_or_admin on public.coordinator_courses
  for select to authenticated using (
    member_id = (select p.member_id from public.profiles p where p.id = auth.uid())
    or public.is_admin()
  );

drop policy if exists coordinator_courses_write_admin on public.coordinator_courses;
create policy coordinator_courses_write_admin on public.coordinator_courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

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

-- 7) avatars storage: allow a user to write their own folder ------------------
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
