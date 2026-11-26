-- ============================================================================
-- LearnEra - migration: instructor grading (grade + feedback) and course roster
-- ----------------------------------------------------------------------------
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste ALL of this file -> Run
--   Safe to run more than once. No row is ever deleted.
--
-- It applies, on top of an existing database:
--   1) assignment_submissions gains grade / feedback / graded_at columns.
--   2) grade_submission() - the course staff (admin / instructor / coordinator)
--      sets the grade and the feedback of a submission; the student keeps
--      reading them through the normal RLS select policy.
-- Nothing else changes: the roster shown on the instructor page only reads
-- profiles, attendance and assignment_submissions through the existing
-- can_manage_course() policies.
-- ============================================================================

-- 1) grading columns on the submissions ---------------------------------------
alter table public.assignment_submissions add column if not exists grade numeric;
alter table public.assignment_submissions add column if not exists feedback text;
alter table public.assignment_submissions add column if not exists graded_at timestamptz;

-- 2) staff RPC: grade a student's submission ----------------------------------
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
