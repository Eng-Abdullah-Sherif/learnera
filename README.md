# LearnEra

A student platform for courses, accounts, attendance and certificates.

* Static site: plain HTML / CSS / JavaScript, **no build step**, only relative paths.
* Backend: **Supabase** (Auth + Postgres Database + Storage) loaded from CDN.
* Interface: English, left-to-right.
* Ready to host on **GitHub Pages**.

---

## 1. Files

| File | Purpose |
| --- | --- |
| `index.html` | Login page (email + password) |
| `admin.html` | Admin dashboard: Courses, Accounts, Certificates |
| `student.html` | Student dashboard: course, attendance, absence, completion %, certificate |
| `css/styles.css` | All styling (dark violet/indigo theme) |
| `js/config.js` | **Your Supabase URL + anon key (the only file you edit)** |
| `js/app.js` | Shared layer: Supabase clients, auth guard, top bar, helpers |
| `js/login.js` | Login page logic |
| `js/admin.js` | Admin dashboard logic |
| `js/student.js` | Student dashboard logic |
| `supabase/schema.sql` | Database tables, Row Level Security, storage buckets, admin helper |

---

## 2. Create the Supabase project

1. Go to <https://supabase.com> → **New project**. Pick a name and a database password, wait for it to finish.
2. Open **SQL Editor → New query**, paste the whole content of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**.
   This creates the tables (`courses`, `profiles`, `attendance`, `certificates`), all Row Level Security policies, the `avatars` (public) and `certificates` (private) storage buckets, and the admin helper functions.
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
  CERTIFICATE_BUCKET: "certificates"
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
insert into public.profiles (id, full_name, email, role)
select id, 'Administrator', email, 'admin'
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

**Courses** — *Add course* opens a popup with name, description, location (online / offline) and the course days. Courses are listed as cards; each one can be deleted.

**Accounts** — *Add account* opens a popup with profile picture, name, email, password, role (student / coordinator / instructor) and a course dropdown filled from the courses you added. Accounts are listed with **Edit** and **Delete**.
The account is created with a **second Supabase client that has `persistSession: false`**, so the administrator's own session is never replaced (you stay logged in).

**Certificates** — *Add certificate* opens a popup that walks through: choose a course → choose a student (only students of that course are listed) → upload the certificate file (PDF or image). Files go to the private `certificates` storage bucket and are opened through short-lived signed links.

### Student dashboard (`student.html`)

Shows name, picture, course, **attendance days**, **absence days**, **completion %** and the **certificate** (download button when one has been issued).

Completion is calculated as `present sessions ÷ all recorded sessions`. There is no attendance screen in the requested scope, so attendance rows are inserted in Supabase (Table Editor or SQL) — see the commented example at the end of `supabase/schema.sql`.

### Top bar (same on every page)

Left to right: profile picture → name with role underneath → notifications icon; far right: the LearnEra logo, then the name "LearnEra". Clicking the picture opens a menu with the dashboard link and **Sign out**.

---

## 6. Roles and security

| Role | Access |
| --- | --- |
| `admin` | Full dashboard: create/delete courses, create/edit/delete accounts, upload/delete certificates |
| `student` | Own profile, own course, own attendance, own certificate |
| `coordinator` / `instructor` | Own profile and course (they have no attendance or certificate section) |

Row Level Security is enabled on every table:

* `courses` — any signed-in user can read; only admins can write.
* `profiles` — a user reads only their own row; only admins write (so nobody can promote themselves).
* `attendance` / `certificates` — a student reads only their own rows; only admins write.
* Storage — avatars are public, certificates are private and readable only by the owning student or an admin.

`public.is_admin()` is a `SECURITY DEFINER` function, so the "is this person an admin?" check never recurses into the `profiles` policies.

---

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Yellow warning box under the top bar | `js/config.js` still has the placeholder URL/key. |
| "Wrong email or password" right after creating an account | **Confirm email** is still enabled in Supabase, or the password is shorter than 6 characters. |
| Account created but the user cannot sign in | Confirm the email in **Authentication → Users**, or disable email confirmation. |
| Delete account fails | `admin_delete_account()` is missing — re-run `supabase/schema.sql`. |
| Certificate link shows "Could not open file" | The `certificates` bucket or its policies are missing — re-run `supabase/schema.sql`. |
| Login works locally but not on GitHub Pages | Add the Pages URL to **Authentication → URL Configuration**. |
| Nothing loads | Open the browser console: a Supabase CDN or key problem is reported there. |
