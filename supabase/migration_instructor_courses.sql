-- ============================================================================
-- LearnEra - migration: instructor course links (multi-course staff)
-- ----------------------------------------------------------------------------
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste ALL of this file -> Run
--   Safe to run more than once. No row is ever deleted.
--
-- WHY
--   An instructor can now manage several courses, stored in the existing
--   public.coordinator_courses table (the same links the coordinator uses).
--   These two helper functions decide who may manage / read a course, so they
--   must also honour the links for instructors.
--
--   Nothing else changes: existing instructors keep working because their
--   profiles.course_id is still checked.
-- ============================================================================

-- can_manage_course: admin, or a staff member (instructor / coordinator)
-- linked to the course - through profiles.course_id or coordinator_courses.
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

-- belongs_to_course: admin, a student assigned to the course, or a staff
-- member (instructor / coordinator) who manages it.
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
