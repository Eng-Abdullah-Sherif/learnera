/* ============================================================================
   LearnEra - admin dashboard
   Sections: Courses, Accounts, Certificates
   ========================================================================== */
(function () {
  "use strict";

  var db = App.db;
  var state = { profile: null, courses: [], accounts: [], certificates: [] };
  var $ = function (id) { return document.getElementById(id); };

  var ROLE_BADGE = {
    admin: "badge-violet",
    student: "badge-indigo",
    coordinator: "badge-cyan",
    instructor: "badge-amber"
  };

  /* --- small helpers ------------------------------------------------------ */
  function setError(el, message) {
    if (!message) { el.hidden = true; el.textContent = ""; return; }
    el.textContent = message;
    el.hidden = false;
  }
  function emptyBlock(text) { return '<div class="empty">' + App.esc(text) + "</div>"; }
  function sanitizeName(name) { return String(name).replace(/[^a-zA-Z0-9._-]/g, "-").slice(-60) || "file"; }
  function busy(btn, isBusy, label) {
    btn.disabled = isBusy;
    btn.innerHTML = isBusy ? '<span class="spinner"></span> ' + App.esc(label) : App.esc(label);
  }

  /* ======================= Navigation ======================= */
  function bindNav() {
    document.querySelectorAll(".nav-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".nav-item").forEach(function (b) {
          var on = b === btn;
          b.classList.toggle("active", on);
          b.setAttribute("aria-selected", String(on));
        });
        document.querySelectorAll(".section").forEach(function (s) {
          s.classList.toggle("active", s.id === "section-" + btn.dataset.section);
        });
      });
    });
  }

  /* ======================= Courses ======================= */
  function buildDayChips() {
    $("courseDays").innerHTML = App.WEEKDAYS.map(function (d) {
      return '<label class="chip" title="' + d + '"><input type="checkbox" value="' + d + '">' +
        d.slice(0, 3) + "</label>";
    }).join("");
  }

  function checkedDays() {
    return Array.prototype.slice.call(document.querySelectorAll("#courseDays input:checked"))
      .map(function (i) { return i.value; });
  }

  async function loadCourses() {
    var res = await db.from("courses").select("*").order("created_at", { ascending: true });
    if (res.error) { App.toast(res.error.message, "error"); return; }
    state.courses = res.data || [];
    renderCourses();
    fillCourseSelects();
  }

  function renderCourses() {
    var grid = $("coursesGrid");
    $("navCountCourses").textContent = state.courses.length;
    if (!state.courses.length) {
      grid.innerHTML = emptyBlock('No courses yet. Use "Add course" to create the first one.');
      return;
    }
    grid.innerHTML = state.courses.map(function (c) {
      var online = c.location === "online";
      return '<article class="item-card">' +
        "<h3>" + App.esc(c.name) + "</h3>" +
        '<p class="desc">' + (c.description ? App.esc(c.description) : "No description.") + "</p>" +
        '<div class="meta">' +
          '<span class="badge ' + (online ? "badge-cyan" : "badge-indigo") + '">' + (online ? "Online" : "Offline") + "</span>" +
          '<span class="badge badge-muted">' + App.esc(App.daysLabel(c.course_days)) + "</span>" +
        "</div>" +
        '<div class="row-actions">' +
          '<button type="button" class="btn btn-sm btn-danger" data-del-course="' + c.id + '">Delete</button>' +
        "</div>" +
        "</article>";
    }).join("");
  }

  function fillCourseSelects() {
    var options = state.courses.map(function (c) {
      return '<option value="' + c.id + '">' + App.esc(c.name) + "</option>";
    }).join("");

    $("accCourse").innerHTML = state.courses.length ? options : '<option value="">No courses yet</option>';
    $("certCourse").innerHTML = '<option value="">Select a course…</option>' + options;
    $("certStudent").innerHTML = '<option value="">Select a student…</option>';
    $("certStudent").disabled = true;
  }

  async function onSubmitCourse(e) {
    e.preventDefault();
    var errBox = $("courseError");
    setError(errBox, "");
    var name = $("courseName").value.trim();
    if (!name) return setError(errBox, "Course name is required.");

    var btn = $("courseSubmit");
    busy(btn, true, "Saving…");
    var res = await db.from("courses").insert({
      name: name,
      description: $("courseDesc").value.trim() || null,
      location: $("courseLocation").value,
      course_days: checkedDays()
    });
    busy(btn, false, "Save course");

    if (res.error) return setError(errBox, res.error.message);
    e.target.reset();
    App.closeModal("courseModal");
    App.toast("Course added.", "success");
    await loadAll();
  }

  /* ======================= Accounts ======================= */
  async function loadAccounts() {
    var res = await db.from("profiles")
      .select("id, full_name, email, role, course_id, avatar_url, created_at, courses:course_id(name)")
      .order("created_at", { ascending: true });
    if (res.error) { App.toast(res.error.message, "error"); return; }
    state.accounts = res.data || [];
    renderAccounts();
  }

  function renderAccounts() {
    var list = $("accountsList");
    $("navCountAccounts").textContent = state.accounts.length;
    if (!state.accounts.length) {
      list.innerHTML = emptyBlock('No accounts yet. Use "Add account" to create one.');
      return;
    }
    list.innerHTML = state.accounts.map(function (a) {
      return '<div class="row">' +
        App.avatarMarkup(a.avatar_url, a.full_name, "avatar-md") +
        '<div class="row-main row-grow">' +
          '<span class="title">' + App.esc(a.full_name) + "</span>" +
          '<span class="sub">' + App.esc(a.email) + "</span>" +
        "</div>" +
        '<span class="badge ' + (ROLE_BADGE[a.role] || "badge-muted") + '">' + App.esc(App.roleLabel(a.role)) + "</span>" +
        '<span class="badge badge-muted">' + App.esc(a.courses ? a.courses.name : "No course") + "</span>" +
        '<div class="row-actions">' +
          '<button type="button" class="btn btn-sm" data-edit="' + a.id + '">Edit</button>' +
          '<button type="button" class="btn btn-sm btn-danger" data-del="' + a.id + '">Delete</button>' +
        "</div></div>";
    }).join("");
  }

  function courseOptions(selectedId) {
    return '<option value="">No course</option>' + state.courses.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === selectedId ? " selected" : "") + ">" + App.esc(c.name) + "</option>";
    }).join("");
  }

  function openEditAccount(id) {
    var a = state.accounts.find(function (x) { return x.id === id; });
    if (!a) return;
    $("editId").value = a.id;
    $("editName").value = a.full_name || "";
    $("editEmail").value = a.email || "";
    $("editRole").value = a.role;
    $("editCourse").innerHTML = courseOptions(a.course_id);
    $("editAvatar").value = "";
    var preview = $("editAvatarPreview");
    if (a.avatar_url) { preview.src = a.avatar_url; preview.hidden = false; }
    else { preview.removeAttribute("src"); preview.hidden = true; }
    setError($("editAccountError"), "");
    App.openModal("editAccountModal");
  }

  async function uploadAvatar(file, prefix) {
    if (!file) return null;
    if (file.size > 3 * 1024 * 1024) throw new Error("Profile picture must be smaller than 3 MB.");
    var path = prefix + "-" + Date.now() + "-" + sanitizeName(file.name);
    var up = await db.storage.from(App.AVATAR_BUCKET).upload(path, file, { cacheControl: "3600" });
    if (up.error) throw new Error("Picture upload failed: " + up.error.message);
    return db.storage.from(App.AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function onSubmitAccount(e) {
    e.preventDefault();
    var errBox = $("accountError");
    setError(errBox, "");

    var name = $("accName").value.trim();
    var email = $("accEmail").value.trim().toLowerCase();
    var password = $("accPassword").value;
    var role = $("accRole").value;
    var courseId = $("accCourse").value || null;

    if (!name) return setError(errBox, "Full name is required.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError(errBox, "Please enter a valid email address.");
    if (password.length < 6) return setError(errBox, "Password must be at least 6 characters long.");

    var btn = $("accountSubmit");
    busy(btn, true, "Creating…");
    try {
      var avatarUrl = await uploadAvatar($("accAvatar").files[0], "user");

      /* The account is created with the SECONDARY client (persistSession:false)
         so the admin's own session is never replaced. */
      var signUp = await App.adminAuth.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { full_name: name, role: role, course_id: courseId, avatar_url: avatarUrl }
        }
      });
      if (signUp.error) throw new Error(signUp.error.message);
      if (signUp.data.user && signUp.data.user.identities && signUp.data.user.identities.length === 0) {
        throw new Error("An account with this email already exists.");
      }

      var userId = signUp.data.user ? signUp.data.user.id : null;
      if (userId) {
        var save = await db.from("profiles").upsert({
          id: userId,
          full_name: name,
          email: email,
          role: role,
          course_id: courseId,
          avatar_url: avatarUrl
        }, { onConflict: "id" });
        if (save.error) throw new Error("Account created, but saving the profile failed: " + save.error.message);
      }

      e.target.reset();
      $("accAvatarPreview").hidden = true;
      App.closeModal("accountModal");
      await loadAll();

      if (!signUp.data.session) {
        App.toast("Account created. Turn off email confirmation in Supabase (or confirm the email) so the user can sign in.", "error");
      } else {
        App.toast("Account created.", "success");
      }
    } catch (err) {
      setError(errBox, err.message);
    } finally {
      busy(btn, false, "Create account");
    }
  }

  async function onSubmitEditAccount(e) {
    e.preventDefault();
    var errBox = $("editAccountError");
    setError(errBox, "");
    var id = $("editId").value;
    var name = $("editName").value.trim();
    if (!name) return setError(errBox, "Full name is required.");

    var btn = $("editAccountSubmit");
    busy(btn, true, "Saving…");
    try {
      var avatarUrl = await uploadAvatar($("editAvatar").files[0], "user");
      var patch = {
        full_name: name,
        role: $("editRole").value,
        course_id: $("editCourse").value || null
      };
      if (avatarUrl) patch.avatar_url = avatarUrl;

      var res = await db.from("profiles").update(patch).eq("id", id);
      if (res.error) throw new Error(res.error.message);

      App.closeModal("editAccountModal");
      await loadAll();
      App.toast("Account updated.", "success");
    } catch (err) {
      setError(errBox, err.message);
    } finally {
      busy(btn, false, "Save changes");
    }
  }

  async function deleteAccount(id) {
    var a = state.accounts.find(function (x) { return x.id === id; });
    if (!a) return;
    if (state.profile && id === state.profile.id) {
      return App.toast("You cannot delete your own account.", "error");
    }
    if (!confirm('Delete "' + a.full_name + '" (' + a.email + ")? This also removes the login.")) return;

    /* admin_delete_account() is a SECURITY DEFINER function defined in
       supabase/schema.sql - it removes the auth user and cascades to the profile. */
    var res = await db.rpc("admin_delete_account", { target_id: id });
    if (res.error) {
      App.toast("Delete failed: " + res.error.message + " (is admin_delete_account() installed?)", "error");
      return;
    }
    await loadAll();
    App.toast("Account deleted.", "success");
  }

  /* ======================= Certificates ======================= */
  async function loadCertificates() {
    var res = await db.from("certificates")
      .select("id, file_path, issued_at, student_id, course_id, courses:course_id(name), students:student_id(full_name, email)")
      .order("issued_at", { ascending: false });
    if (res.error) { App.toast(res.error.message, "error"); return; }
    state.certificates = res.data || [];
    renderCertificates();
  }

  function renderCertificates() {
    var list = $("certsList");
    $("navCountCerts").textContent = state.certificates.length;
    if (!state.certificates.length) {
      list.innerHTML = emptyBlock('No certificates yet. Use "Add certificate" to upload one.');
      return;
    }
    list.innerHTML = state.certificates.map(function (c) {
      var studentName = c.students ? c.students.full_name : "Unknown student";
      return '<div class="row">' +
        '<span class="avatar avatar-md avatar-fallback">' + App.esc(App.initials(studentName)) + "</span>" +
        '<div class="row-main row-grow">' +
          '<span class="title">' + App.esc(studentName) + "</span>" +
          '<span class="sub">' + App.esc(c.courses ? c.courses.name : "No course") +
            " · Issued " + App.fmtDate(c.issued_at) + "</span>" +
        "</div>" +
        '<div class="row-actions">' +
          '<button type="button" class="btn btn-sm" data-open-cert="' + c.id + '">Open file</button>' +
          '<button type="button" class="btn btn-sm btn-danger" data-del-cert="' + c.id + '">Delete</button>' +
        "</div></div>";
    }).join("");
  }

  async function loadCertStudents() {
    var courseId = $("certCourse").value;
    var sel = $("certStudent");
    var hint = $("certStudentHint");

    if (!courseId) {
      sel.innerHTML = '<option value="">Select a student…</option>';
      sel.disabled = true;
      hint.textContent = "Pick a course first.";
      return;
    }
    sel.disabled = true;
    sel.innerHTML = '<option value="">Loading…</option>';

    var res = await db.from("profiles")
      .select("id, full_name, email")
      .eq("role", "student")
      .eq("course_id", courseId)
      .order("full_name", { ascending: true });

    if (res.error) {
      sel.innerHTML = '<option value="">Could not load students</option>';
      hint.textContent = res.error.message;
      return;
    }
    if (!res.data || !res.data.length) {
      sel.innerHTML = '<option value="">No students in this course</option>';
      hint.textContent = "Add a student to this course first.";
      return;
    }
    sel.innerHTML = '<option value="">Select a student…</option>' + res.data.map(function (s) {
      return '<option value="' + s.id + '">' + App.esc(s.full_name) + " — " + App.esc(s.email) + "</option>";
    }).join("");
    sel.disabled = false;
    hint.textContent = res.data.length + " student(s) in this course.";
  }

  async function onSubmitCertificate(e) {
    e.preventDefault();
    var errBox = $("certError");
    setError(errBox, "");

    var courseId = $("certCourse").value;
    var studentId = $("certStudent").value;
    var file = $("certFile").files[0];

    if (!courseId) return setError(errBox, "Choose a course first.");
    if (!studentId) return setError(errBox, "Choose a student first.");
    if (!file) return setError(errBox, "Choose the certificate file.");
    if (file.size > 10 * 1024 * 1024) return setError(errBox, "Certificate file must be smaller than 10 MB.");

    var btn = $("certSubmit");
    busy(btn, true, "Uploading…");
    try {
      var path = courseId + "/" + studentId + "/" + Date.now() + "-" + sanitizeName(file.name);
      var up = await db.storage.from(App.CERTIFICATE_BUCKET).upload(path, file, { cacheControl: "3600" });
      if (up.error) throw new Error("Upload failed: " + up.error.message);

      var ins = await db.from("certificates").insert({
        student_id: studentId,
        course_id: courseId,
        file_path: path
      });
      if (ins.error) throw new Error("File uploaded, but saving the record failed: " + ins.error.message);

      e.target.reset();
      $("certStudent").disabled = true;
      $("certStudent").innerHTML = '<option value="">Select a student…</option>';
      $("certStudentHint").textContent = "Pick a course first.";
      App.closeModal("certModal");
      await loadAll();
      App.toast("Certificate uploaded.", "success");
    } catch (err) {
      setError(errBox, err.message);
    } finally {
      busy(btn, false, "Upload certificate");
    }
  }

  async function openCertificate(id) {
    var c = state.certificates.find(function (x) { return x.id === id; });
    if (!c) return;
    var res = await db.storage.from(App.CERTIFICATE_BUCKET).createSignedUrl(c.file_path, 3600);
    if (res.error) return App.toast("Could not open file: " + res.error.message, "error");
    window.open(res.data.signedUrl, "_blank", "noopener");
  }

  async function deleteCertificate(id) {
    var c = state.certificates.find(function (x) { return x.id === id; });
    if (!c) return;
    if (!confirm("Delete this certificate file and its record?")) return;
    await db.storage.from(App.CERTIFICATE_BUCKET).remove([c.file_path]);
    var res = await db.from("certificates").delete().eq("id", id);
    if (res.error) return App.toast(res.error.message, "error");
    await loadAll();
    App.toast("Certificate deleted.", "success");
  }

  /* ======================= Data + events ======================= */
  async function loadAll() {
    await loadCourses();
    await Promise.all([loadAccounts(), loadCertificates()]);
    App.setNotifications([
      { title: state.courses.length + " courses", text: "Courses created so far." },
      { title: state.accounts.length + " accounts", text: "Students, coordinators and instructors." },
      { title: state.certificates.length + " certificates", text: "Certificate files issued so far." }
    ]);
  }

  function bindEvents() {
    $("addCourseBtn").addEventListener("click", function () {
      setError($("courseError"), "");
      $("courseForm").reset();
      document.querySelectorAll("#courseDays input:checked").forEach(function (i) { i.checked = false; });
      App.openModal("courseModal");
    });
    $("courseForm").addEventListener("submit", onSubmitCourse);

    $("addAccountBtn").addEventListener("click", function () {
      setError($("accountError"), "");
      $("accountForm").reset();
      $("accAvatarPreview").hidden = true;
      App.openModal("accountModal");
    });
    $("accountForm").addEventListener("submit", onSubmitAccount);
    $("accAvatar").addEventListener("change", function () {
      var file = this.files[0];
      var preview = $("accAvatarPreview");
      if (!file) { preview.hidden = true; return; }
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    });
    $("editAccountForm").addEventListener("submit", onSubmitEditAccount);
    $("editAvatar").addEventListener("change", function () {
      var file = this.files[0];
      var preview = $("editAvatarPreview");
      if (!file) return;
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    });

    $("accountsList").addEventListener("click", function (e) {
      var editBtn = e.target.closest("[data-edit]");
      if (editBtn) return openEditAccount(editBtn.dataset.edit);
      var delBtn = e.target.closest("[data-del]");
      if (delBtn) return deleteAccount(delBtn.dataset.del);
    });

    $("coursesGrid").addEventListener("click", async function (e) {
      var btn = e.target.closest("[data-del-course]");
      if (!btn) return;
      var course = state.courses.find(function (c) { return c.id === btn.dataset.delCourse; });
      if (!course) return;
      if (!confirm('Delete course "' + course.name + '"? Accounts in this course stay, but lose the course link.')) return;
      var res = await db.from("courses").delete().eq("id", course.id);
      if (res.error) return App.toast(res.error.message, "error");
      await loadAll();
      App.toast("Course deleted.", "success");
    });

    $("addCertBtn").addEventListener("click", function () {
      setError($("certError"), "");
      $("certForm").reset();
      $("certStudent").disabled = true;
      $("certStudent").innerHTML = '<option value="">Select a student…</option>';
      $("certStudentHint").textContent = "Pick a course first.";
      App.openModal("certModal");
    });
    $("certCourse").addEventListener("change", loadCertStudents);
    $("certForm").addEventListener("submit", onSubmitCertificate);
    $("certsList").addEventListener("click", function (e) {
      var openBtn = e.target.closest("[data-open-cert]");
      if (openBtn) return openCertificate(openBtn.dataset.openCert);
      var delBtn = e.target.closest("[data-del-cert]");
      if (delBtn) return deleteCertificate(delBtn.dataset.delCert);
    });
  }

  async function init() {
    var auth = await App.requireAuth("admin");
    if (!auth) return;
    state.profile = auth.profile;
    App.renderTopbar(auth.profile);
    buildDayChips();
    bindNav();
    bindEvents();
    await loadAll();
  }

  init();
})();
