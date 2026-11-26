# LearnEra

A platform for courses, accounts, course files, assignments and certificates.

* Static site: plain HTML / CSS / JavaScript, **no build step**, only relative paths.
* Backend: **Supabase** (Auth + Postgres Database + Storage) loaded from CDN.
* Interface: English, left-to-right.
* Ready to host on **GitHub Pages**.

---

## 1. Files

| File | Purpose |
| --- | --- |
| `index.html` | Login page (email + password) |
| `admin.html` | Admin dashboard: Courses, Accounts, Course files, Assignments, Certificates |
| `instructor.html` | Instructor dashboard: course files and assignments for their own course |
| `coordinator.html` | Coordinator dashboard: attendance, course files and announcements for the courses they manage |
| `student.html` | Student dashboard: course details, course files, assignments (with solution upload) |
| `certificates.html` | "My certificates" page for a student |
| `css/styles.css` | All styling (dark violet/indigo theme) |
| `js/config.js` | **Your Supabase URL + anon key (the only file you edit)** |
| `js/app.js` | Shared layer: Supabase clients, auth guard, top bar, notifications and the settings modal |
| `js/login.js` | Login page logic |
| `js/admin.js` | Admin dashboard logic |
| `js/instructor.js` | Instructor dashboard logic |
| `js/coordinator.js` | Coordinator dashboard logic |
| `js/student.js` | Student dashboard logic |
| `js/certificates.js` | "My certificates" page logic |
| `supabase/schema.sql` | Database tables, Row Level Security, storage buckets, helper functions |
| `supabase/migration_course_dates_and_account_id.sql` | Migration for an **existing** database: course dates + account ID (no data dropped) |
| `supabase/migration_course_files_assignments.sql` | Migration for an **existing** database: avatar position, course files, assignments and submissions (no data dropped) |
| `supabase/migration_coordinator_and_settings.sql` | Migration for an **existing** database: coordinator courses, announcements and self-service avatar/password (no data dropped) |
| `supabase/migration_instructor_grading.sql` | Migration for an **existing** database: submission grade + feedback and the `grade_submission()` function (no data dropped) |
| `supabase/migration_instructor_courses.sql` | Migration for an **existing** database: lets an instructor manage several courses through `coordinator_courses` (no data dropped) |
| `supabase/migration_combined.sql` | **One-run catch-up**: applies everything above in the right order on any existing database and guarantees `profiles.avatar_position` exists first (safe to re-run, no data dropped) |

---

## 2. Create the Supabase project

1. Go to <https://supabase.com> → **New project**. Pick a name and a database password, wait for it to finish.
2. Open **SQL Editor → New query**, paste the whole content of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**.
   This creates the tables (`courses`, `profiles`, `coordinator_courses`, `attendance`, `certificates`, `course_files`, `assignments`, `assignment_submissions`, `announcements`), all Row Level Security policies, the four storage buckets (`avatars` and `certificates`, plus `course-files` and `submissions`), and the helper functions.

   > Updating a database that already exists? Run the migrations instead, in order — [`supabase/migration_course_dates_and_account_id.sql`](supabase/migration_course_dates_and_account_id.sql), then [`supabase/migration_course_files_assignments.sql`](supabase/migration_course_files_assignments.sql), then [`supabase/migration_coordinator_and_settings.sql`](supabase/migration_coordinator_and_settings.sql), then [`supabase/migration_instructor_grading.sql`](supabase/migration_instructor_grading.sql), then [`supabase/migration_instructor_courses.sql`](supabase/migration_instructor_courses.sql). None of them deletes any rows.
   >
   > Prefer one file? Run [`supabase/migration_combined.sql`](supabase/migration_combined.sql) on its own — it applies all of the above in the same order in a single run and is safe to re-run.
3. Open **Authentication → Sign In / Providers → Email** and turn **Confirm email** *off*.
   The admin creates accounts from inside the site; with confirmation on, those users cannot sign in until they click a link in an email.
4. Open **Project Settings → API** and copy:
   * **Project URL**
   * **anon / public** API key

   > Never copy the `service_role` key. It bypasses all security rules and must never be placed in a website file.

5. Paste both values into [`js/config.js`](js/config.js):

```js
window.LEARNERA_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJI....",
  AVATAR_BUCKET: "avatars",
  CERTIFICATE_BUCKET: "certificates",
  COURSE_FILE_BUCKET: "course-files",
  SUBMISSION_BUCKET: "submissions"
};
```

---

## 3. Create the default admin account

The password is intentionally **not written in any file of this site**. Create the user in Supabase, then promote it with SQL.

**Step 1 — create the login**

Supabase Dashboard → **Authentication → Users → Add user → Create new user**

| Field | Value |
| --- | --- |
| Email | `admin@learnera.com` |
| Password | the admin password you chose (6+ characters) |
| Auto Confirm User | ✅ enabled |

> The admin password is deliberately **not written in this repository**. This README is served publicly by GitHub Pages, so the password stays only in your Supabase project (and wherever you keep it privately).

**Step 2 — give it the admin role**

SQL Editor → New query → Run:

```sql
insert into public.profiles (id, full_name, email, role, member_id)
select id, 'Administrator', email, 'admin', 'ADMIN'
from auth.users
where email = 'admin@learnera.com'
on conflict (id) do update set role = 'admin', full_name = 'Administrator';
```

Verify:

```sql
select id, full_name, email, role from public.profiles where email = 'admin@learnera.com';
-- role must be 'admin'
```

Now sign in at `index.html` with `admin@learnera.com` and go to the admin dashboard.

---

## 4. Publish to GitHub Pages

1. Create a repository and push this folder:

```bash
git init
git add .
git commit -m "LearnEra static site"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

2. Repository → **Settings → Pages** → *Build and deployment*:
   * Source: **Deploy from a branch**
   * Branch: **main**, folder: **/ (root)** → **Save**
3. Wait a moment, then open `https://<your-user>.github.io/<your-repo>/`.
4. Add that address to **Supabase → Authentication → URL Configuration → Site URL** (and add it to *Redirect URLs*) so login works from the published site.

The `anon` key in `js/config.js` is safe to commit: it is a public key and every read/write is filtered by the Row Level Security policies in `supabase/schema.sql`.

---

## 5. Using the site

### Admin dashboard (`admin.html`)

**Courses** — *Add course* opens a popup with name, description, location (online / offline) and the exact course dates (pick a date, press *Add date*, remove any chip with its ×). Courses are listed as cards, each showing its dates, and can be deleted.

**Accounts** — *Add account* opens a popup with profile picture (pick a file, then **drag the picture inside the circle** to frame it — saved per account as `avatar_position`), name, **ID** (required, unique — this hand-typed ID is the account's primary key, e.g. the student number), email, password and role (student / coordinator / instructor). The course field switches with the role: picking **student** shows the single-course dropdown, while picking **coordinator** or **instructor** hides that dropdown and reveals a *Courses* section of checkboxes at the bottom of the popup, so one staff member can manage several courses (the links are stored in `coordinator_courses`). The same logic applies when editing an account. Accounts are listed with their ID, **Edit** and **Delete**; a duplicate ID is rejected with a clear message.
The account is created with a **second Supabase client that has `persistSession: false`**, so the administrator's own session is never replaced (you stay logged in).

**Course files** — pick a course, then *Upload file* (title + file) to share material with that course's students. Each file can be downloaded or deleted.

**Assignments** — pick a course, then *Add assignment* (title, description, optional due date and optional attachment) to send homework to a class. Each assignment shows a *Submissions (n)* button that lists every student's submitted solution with a *Download* link, plus a *Delete* button.

**Certificates** — *Add certificate* opens a popup that walks through: choose a course → choose a student (only students of that course are listed) → upload the certificate file (PDF or image). Files go to the private `certificates` storage bucket and are opened through short-lived signed links.

### Instructor dashboard (`instructor.html`)

An instructor signs in and lands on their own panel, scoped to the courses their account is linked to in `coordinator_courses` (a single primary `course_id` also works). When more than one course is linked, a **Course** dropdown appears in the header card to switch between them; every section below reloads for the selected course. Four sections:

* **Course files** — upload/delete the material students can download.
* **Assignments** — *Add assignment* opens a popup with a **title**, a **description** and an optional due date and attachment; the assignment then appears for every student of the course in their *Assignments* card. Each assignment shows a *Submissions (n)* button.
* **Grading** — opening an assignment's **Submissions** lists every student who uploaded a solution, each with a **Download** button plus a **Grade** and a **Feedback** field. *Save* stores them through the `grade_submission()` function; the grade and the feedback then show up on the student's own assignment card.
* **Students** — the full roster of the selected course with each student's **attendance days** (green), **absence days** (red), a **completion bar** (present ÷ course dates) and the **total grade** summed from every graded assignment, plus how many assignments were graded.

They cannot touch courses, accounts or courses they are not linked to — Row Level Security enforces this.

### Coordinator dashboard (`coordinator.html`)

A coordinator signs in and lands on a panel with a side navigation (Attendance / Course files / Announcements), scoped to the courses they are linked to in `coordinator_courses`. A course dropdown appears in each section, so a coordinator managing several courses can switch between them.

* **Attendance** — pick a course and a date, then mark every student of that course *Present* or *Absent* with the segmented buttons. *Save attendance* replaces that day's records for the course (nothing else is touched). Opening a past date reloads what was saved.
* **Course files** — upload files to a course (title + file) and delete them; students of that course can download them.
* **Announcements** — write an announcement (title + body) for a course and delete it. Each announcement appears in the **notifications bell** of every student of that course.

### Student dashboard (`student.html`)

Shows the profile hero with the account ID, and a **course details panel on the far right**. Clicking that panel opens a popup with the full course information: on the left the **name, description, location** and the present/absent totals; on the right a **vertical schedule** listing every course date in order. The next upcoming date (the first one today or later) is highlighted, **present dates are green**, **absent dates are red**, and dates with no attendance record stay neutral grey. Below, a **Course files** card (download materials) and an **Assignments** card. For each assignment the student sees its description, due date and attachment, and a **Submit solution** button that uploads a file (one solution per student per assignment; re-submitting replaces the previous file, shown with a *Submitted* / *Not submitted* badge). Once the instructor grades the solution, the student sees the **grade** as a badge and the **feedback** under the assignment. The **notifications bell** lists the announcements posted for the student's course.

Certificates are no longer on the dashboard — they moved to the standalone **My certificates** page, reachable from the profile menu in the top bar.

### Top bar (same on every page)

Left to right: profile picture → name with role underneath → notifications icon; far right: the LearnEra logo, then the name "LearnEra". Clicking the picture opens a menu with the dashboard link (Admin / Instructor / Coordinator / My dashboard, depending on the role), **My certificates** (students only), **Settings** and **Sign out**.

**Settings** opens a modal available to every signed-in user: a *Password* section (new password + confirmation, applied through `supabase.auth.updateUser`) and a *Profile picture* section (choose a new picture, then **drag the picture inside the circle** to frame it, and save — the file is uploaded to `avatars/<auth-uid>/…` and `avatar_position` is stored through the `update_my_avatar()` function, so anyone can change their own picture without admin rights).

---

## 6. Roles and security

| Role | Access |
| --- | --- |
| `admin` | Full dashboard: courses, accounts, course files, assignments, certificates |
| `instructor` | Own panel: course files, assignments and submissions for the courses linked to them |
| `coordinator` | Own panel: attendance, course files and announcements for the courses in `coordinator_courses` |
| `student` | Own profile, own course details, course files, assignments (submit a solution), own certificates, own announcements |

Row Level Security is enabled on every table:

* `courses` — any signed-in user can read; only admins can write.
* `profiles` — a user reads only their own row; an instructor also reads the profiles in their own course; only admins write (so nobody can promote themselves). Anyone may update their *own* `avatar_url` / `avatar_position`, and only through the `update_my_avatar()` function.
* `coordinator_courses` — a coordinator or instructor reads their own links (to load their courses); only admins write them.
* `attendance` — a student reads only their own rows; the admins and the course's coordinator write them.
* `certificates` — a student reads only their own rows; only admins write.
* `course_files` — the members of a course read them; the admins, that course's instructor and that course's coordinator write them.
* `assignments` — the members of a course read them; the admins and that course's instructor write them.
* `assignment_submissions` — a student reads and writes only their own solutions; the course's instructor, coordinators and admins read all of them, and may set the **grade** and **feedback** through the `grade_submission()` function.
* `announcements` — the members of a course read them; the admins, that course's instructor and that course's coordinator write them.
* Storage — `avatars` are public; `certificates`, `course-files` and `submissions` are private and reachable only through the policies above (short-lived signed URLs).

`public.is_admin()`, `public.can_manage_course()` and `public.belongs_to_course()` are `SECURITY DEFINER` functions, so the access checks never recurse into the `profiles` policies. `can_manage_course()` returns true for admins, for the course's instructor and for any coordinator linked to the course in `coordinator_courses`.

---

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Yellow warning box under the top bar | `js/config.js` still has the placeholder URL/key. |
| "Wrong email or password" right after creating an account | **Confirm email** is still enabled in Supabase, or the password is shorter than 6 characters. |
| Account created but the user cannot sign in | Confirm the email in **Authentication → Users**, or disable email confirmation. |
| Delete account fails | `admin_delete_account()` is missing — re-run `supabase/schema.sql`. |
| Certificate link shows "Could not open file" | The `certificates` bucket or its policies are missing — re-run `supabase/schema.sql`. |
| Course files / assignments errors | The `course-files` and `submissions` buckets or their policies are missing — re-run `supabase/schema.sql` (or the `migration_course_files_assignments.sql` migration). |
| An instructor sees no course / only one course | Tick every course the instructor manages in the *Courses* section of **Admin → Accounts → Edit** (stored in `coordinator_courses`); re-run `supabase/migration_instructor_courses.sql` so `can_manage_course()` accepts instructors. |
| A coordinator sees no course | Tick the coordinator's courses from **Admin → Accounts → Edit** (stored in `coordinator_courses`). |
| Attendance / announcements errors | The `coordinator_courses` or `announcements` table or its policies are missing — re-run `supabase/schema.sql` (or the `migration_coordinator_and_settings.sql` migration). |
| Settings → save picture fails | The `update_my_avatar()` function or the `avatars` bucket is missing — re-run `supabase/schema.sql`. |
| Error `column "avatar_position" does not exist` | The column was never added to the existing `profiles` table (a `create table if not exists` never adds columns) — run `supabase/migration_combined.sql` (or `migration_course_files_assignments.sql`), which adds it with `ADD COLUMN IF NOT EXISTS`. |
| Saving a grade / feedback fails | The `grade`, `feedback` and `graded_at` columns or the `grade_submission()` function are missing — re-run `supabase/schema.sql` (or the `migration_instructor_grading.sql` migration). |
| The instructor's Students list is empty | The students must have the instructor's course selected as their `course_id` in **Admin → Accounts** (role `student`). |
| Login works locally but not on GitHub Pages | Add the Pages URL to **Authentication → URL Configuration**. |
| Nothing loads | Open the browser console: a Supabase CDN or key problem is reported there. |
