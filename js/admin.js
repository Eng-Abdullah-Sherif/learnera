/* ============================================================================
   LearnEra - admin dashboard
   Sections: Courses, Accounts, Course files, Assignments, Certificates
   ========================================================================== */
(function () {
  "use strict";

  var db = App.db;
  var state = {
    profile: null,
    courses: [],
    accounts: [],
    coordCounts: {},
    certificates: [],
    courseFiles: [],
    assignments: [],
    assignmentCounts: {}
  };
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

  /* --- avatar position (prefix = "acc" | "edit") -------------------------- */
  /* The picture is repositioned by dragging it inside the round preview, via
     the shared App.draggableAvatar() controller (no sliders). */
  var draggers = {};
  function dragger(prefix) {
    if (!draggers[prefix]) draggers[prefix] = App.draggableAvatar($(prefix + "AvatarPreview"));
    return draggers[prefix];
  }
  function readPosition(prefix) { return dragger(prefix).get(); }
  function setPosition(prefix, value) { dragger(prefix).set(value); }

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
  var courseDates = [];

  function renderCourseDates() {
    var host = $("courseDates");
    if (!courseDates.length) {
      host.innerHTML = '<span class="muted">No dates added yet.</span>';
      return;
    }
    host.innerHTML = courseDates.map(function (d) {
      return '<span class="chip chip-removable">' + App.esc(App.dateLabel(d)) +
        '<button type="button" class="chip-x" data-remove-date="' + App.esc(d) +
        '" aria-label="Remove ' + App.esc(d) + '">&times;</button></span>';
    }).join("");
  }

  function addCourseDate() {
    var input = $("courseDateInput");
    var value = input.value;
    if (!value) return setError($("courseError"), "Pick a date before adding it.");
    setError($("courseError"), "");
    if (courseDates.indexOf(value) === -1) courseDates.push(value);
    courseDates.sort();
    input.value = "";
    renderCourseDates();
  }

  function removeCourseDate(value) {
    courseDates = courseDates.filter(function (d) { return d !== value; });
    renderCourseDates();
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
          '<span class="badge badge-muted">' + App.esc(App.datesLabel(c.course_dates, 4)) + "</span>" +
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

    keepValue($("filesCourse"), state.courses.length ? options : '<option value="">No courses yet</option>');
    keepValue($("assignmentsCourse"), state.courses.length ? options : '<option value="">No courses yet</option>');
    keepValue($("fileCourse"), '<option value="">Select a course…</option>' + options);
    keepValue($("assignmentCourse"), '<option value="">Select a course…</option>' + options);

    renderCourseChips($("accCoordCourses"), []);
    renderCourseChips($("editCoordCourses"), []);
  }

  /* Rebuilds a select while keeping the previously selected value when possible. */
  function keepValue(select, html) {
    var previous = select.value;
    select.innerHTML = html;
    if (previous) select.value = previous;
    if (!select.value) select.selectedIndex = 0;
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
      course_dates: courseDates
    });
    busy(btn, false, "Save course");

    if (res.error) return setError(errBox, res.error.message);
    e.target.reset();
    App.closeModal("courseModal");
    App.toast("Course added.", "success");
    await loadAll();
  }

  /* ======================= Accounts ======================= */
  function friendlyIdError(message) {
    if (/member_id/i.test(message) && /unique|duplicate/i.test(message)) {
      return "This ID is already used by another account.";
    }
    return message;
  }

  async function loadAccounts() {
    var res = await db.from("profiles")
      .select("id, full_name, email, member_id, role, course_id, avatar_url, avatar_position, created_at, courses:course_id(name)")
      .order("created_at", { ascending: true });
    if (res.error) { App.toast(res.error.message, "error"); return; }
    state.accounts = res.data || [];

    state.coordCounts = {};
    var links = await db.from("coordinator_courses").select("member_id");
    if (links.error) App.toast(links.error.message, "error");
    (links.data || []).forEach(function (l) {
      state.coordCounts[l.member_id] = (state.coordCounts[l.member_id] || 0) + 1;
    });
    renderAccounts();
  }

  function courseSummary(a) {
    if (a.role === "coordinator" || a.role === "instructor") {
      var n = state.coordCounts[a.member_id] || 0;
      if (n === 0) return a.courses ? a.courses.name : "No course";
      return n === 1 ? "1 course" : n + " courses";
    }
    return a.courses ? a.courses.name : "No course";
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
        App.avatarMarkup(a.avatar_url, a.full_name, "avatar-md", a.avatar_position) +
        '<div class="row-main row-grow">' +
          '<span class="title">' + App.esc(a.full_name) + "</span>" +
          '<span class="sub">' + App.esc(a.email) + "</span>" +
        "</div>" +
        '<span class="badge badge-muted">ID: ' + App.esc(a.member_id || "—") + "</span>" +
        '<span class="badge ' + (ROLE_BADGE[a.role] || "badge-muted") + '">' + App.esc(App.roleLabel(a.role)) + "</span>" +
        '<span class="badge badge-muted">' + App.esc(courseSummary(a)) + "</span>" +
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

  /* --- Staff course chips ------------------------------------------------- */
  /* Instructors and coordinators pick their courses from the chips at the
     bottom; the single-course dropdown is only used for students (and admin). */
  function isStaffRole(role) { return role === "coordinator" || role === "instructor"; }
  function renderCourseChips(container, selected) {
    var sel = selected || [];
    if (!state.courses.length) { container.innerHTML = '<span class="muted">No courses yet.</span>'; return; }
    container.innerHTML = state.courses.map(function (c) {
      return '<label class="chip"><input type="checkbox" value="' + c.id + '"' +
        (sel.indexOf(c.id) !== -1 ? " checked" : "") + ">" + App.esc(c.name) + "</label>";
    }).join("");
  }
  function readCourseChips(container) {
    return Array.prototype.slice.call(container.querySelectorAll("input:checked")).map(function (i) { return i.value; });
  }
  function toggleCoordWrap(roleSelect, wrap, courseWrap) {
    var staff = isStaffRole(roleSelect.value);
    wrap.hidden = !staff;
    if (courseWrap) courseWrap.hidden = staff;
  }

  function openEditAccount(id) {
    var a = state.accounts.find(function (x) { return x.id === id; });
    if (!a) return;
    $("editId").value = a.id;
    $("editName").value = a.full_name || "";
    $("editMemberId").value = a.member_id || "";
    $("editEmail").value = a.email || "";
    $("editRole").value = a.role;
    $("editCourse").innerHTML = courseOptions(a.course_id);
    $("editAvatar").value = "";
    renderCourseChips($("editCoordCourses"), a.course_id ? [a.course_id] : []);
    toggleCoordWrap($("editRole"), $("editCoordWrap"), $("editCourseWrap"));
    var preview = $("editAvatarPreview");
    if (a.avatar_url) { dragger("edit").setImage(a.avatar_url); preview.hidden = false; }
    else { dragger("edit").setImage(""); preview.hidden = true; }
    setPosition("edit", a.avatar_position);
    setError($("editAccountError"), "");
    App.openModal("editAccountModal");

    db.from("coordinator_courses").select("course_id").eq("member_id", a.member_id).then(function (res) {
      if (res.error) { App.toast(res.error.message, "error"); return; }
      var ids = (res.data || []).map(function (r) { return r.course_id; });
      if (a.course_id && ids.indexOf(a.course_id) === -1) ids.push(a.course_id);
      renderCourseChips($("editCoordCourses"), ids);
    });
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
    var memberId = $("accMemberId").value.trim();
    var email = $("accEmail").value.trim().toLowerCase();
    var password = $("accPassword").value;
    var role = $("accRole").value;
    var staff = isStaffRole(role);
    var courseIds = staff ? readCourseChips($("accCoordCourses")) : [];
    var courseId = staff ? (courseIds[0] || null) : ($("accCourse").value || null);

    if (!name) return setError(errBox, "Full name is required.");
    if (!memberId) return setError(errBox, "ID is required.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError(errBox, "Please enter a valid email address.");
    if (password.length < 6) return setError(errBox, "Password must be at least 6 characters long.");

    var btn = $("accountSubmit");
    busy(btn, true, "Creating…");
    try {
      var dup = await db.from("profiles").select("id").eq("member_id", memberId).maybeSingle();
      if (dup.error) throw new Error(dup.error.message);
      if (dup.data) throw new Error('The ID "' + memberId + '" is already used by another account.');

      var avatarUrl = await uploadAvatar($("accAvatar").files[0], "user");
      var avatarPosition = readPosition("acc");

      /* The account is created with the SECONDARY client (persistSession:false)
         so the admin's own session is never replaced. */
      var signUp = await App.adminAuth.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { full_name: name, member_id: memberId, role: role, course_id: courseId, avatar_url: avatarUrl, avatar_position: avatarPosition }
        }
      });
      if (signUp.error) throw new Error(friendlyIdError(signUp.error.message));
      if (signUp.data.user && signUp.data.user.identities && signUp.data.user.identities.length === 0) {
        throw new Error("An account with this email already exists.");
      }

      var userId = signUp.data.user ? signUp.data.user.id : null;
      if (userId) {
        var save = await db.from("profiles").upsert({
          id: userId,
          full_name: name,
          email: email,
          member_id: memberId,
          role: role,
          course_id: courseId,
          avatar_url: avatarUrl,
          avatar_position: avatarPosition
        }, { onConflict: "id" });
        if (save.error) throw new Error("Account created, but saving the profile failed: " + friendlyIdError(save.error.message));
      }

      if (staff && courseIds.length) {
        var linkIns = await db.from("coordinator_courses").insert(courseIds.map(function (cid) {
          return { member_id: memberId, course_id: cid };
        }));
        if (linkIns.error) throw new Error("Account created, but linking its courses failed: " + linkIns.error.message);
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
    var memberId = $("editMemberId").value.trim();
    if (!name) return setError(errBox, "Full name is required.");
    if (!memberId) return setError(errBox, "ID is required.");

    var btn = $("editAccountSubmit");
    busy(btn, true, "Saving…");
    try {
      var dup = await db.from("profiles").select("id").eq("member_id", memberId).neq("id", id).maybeSingle();
      if (dup.error) throw new Error(dup.error.message);
      if (dup.data) throw new Error('The ID "' + memberId + '" is already used by another account.');

      var old = state.accounts.find(function (x) { return x.id === id; });
      var oldMemberId = old ? old.member_id : memberId;
      var role = $("editRole").value;
      var staff = isStaffRole(role);
      var courseIds = staff ? readCourseChips($("editCoordCourses")) : [];

      var avatarUrl = await uploadAvatar($("editAvatar").files[0], "user");
      var patch = {
        full_name: name,
        member_id: memberId,
        role: role,
        course_id: staff ? (courseIds[0] || null) : ($("editCourse").value || null),
        avatar_position: readPosition("edit")
      };
      if (avatarUrl) patch.avatar_url = avatarUrl;

      /* Remove the old course links first: the primary key (member_id) may be
         changing, and the foreign key would otherwise block the update. */
      var delLinks = await db.from("coordinator_courses").delete().eq("member_id", oldMemberId);
      if (delLinks.error) throw new Error(delLinks.error.message);

      var res = await db.from("profiles").update(patch).eq("id", id);
      if (res.error) throw new Error(friendlyIdError(res.error.message));

      if (staff && courseIds.length) {
        var linkIns = await db.from("coordinator_courses").insert(courseIds.map(function (cid) {
          return { member_id: memberId, course_id: cid };
        }));
        if (linkIns.error) throw new Error(linkIns.error.message);
      }

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

  /* ======================= Course files ======================= */
  async function loadCourseFiles() {
    var list = $("filesList");
    var courseId = $("filesCourse").value;
    if (!courseId) {
      state.courseFiles = [];
      $("navCountFiles").textContent = 0;
      list.innerHTML = emptyBlock("Choose a course to see its files.");
      return;
    }
    var res = await db.from("course_files")
      .select("id, title, file_path, uploaded_at")
      .eq("course_id", courseId)
      .order("uploaded_at", { ascending: false });
    if (res.error) { list.innerHTML = emptyBlock(res.error.message); return; }
    state.courseFiles = res.data || [];
    $("navCountFiles").textContent = state.courseFiles.length;
    renderCourseFiles();
  }

  function renderCourseFiles() {
    var list = $("filesList");
    if (!state.courseFiles.length) {
      list.innerHTML = emptyBlock('No files yet. Use "Upload file" to share one.');
      return;
    }
    list.innerHTML = state.courseFiles.map(function (f) {
      return '<div class="row">' +
        '<div class="row-main row-grow">' +
          '<span class="title">' + App.esc(f.title) + "</span>" +
          '<span class="sub">Uploaded ' + App.fmtDate(f.uploaded_at) + "</span>" +
        "</div>" +
        '<div class="row-actions">' +
          '<button type="button" class="btn btn-sm" data-download-file="' + App.esc(f.file_path) + '">Download</button>' +
          '<button type="button" class="btn btn-sm btn-danger" data-del-file="' + f.id + '">Delete</button>' +
        "</div></div>";
    }).join("");
  }

  async function onSubmitFile(e) {
    e.preventDefault();
    var errBox = $("fileError");
    setError(errBox, "");
    var courseId = $("fileCourse").value;
    var title = $("fileTitle").value.trim();
    var file = $("fileFile").files[0];
    if (!courseId) return setError(errBox, "Choose a course.");
    if (!title) return setError(errBox, "Enter a title.");
    if (!file) return setError(errBox, "Choose a file.");
    if (file.size > 25 * 1024 * 1024) return setError(errBox, "File must be smaller than 25 MB.");

    var btn = $("fileSubmit");
    busy(btn, true, "Uploading…");
    try {
      var path = courseId + "/" + Date.now() + "-" + sanitizeName(file.name);
      var up = await db.storage.from(App.COURSE_FILE_BUCKET).upload(path, file, { cacheControl: "3600" });
      if (up.error) throw new Error("Upload failed: " + up.error.message);
      var ins = await db.from("course_files").insert({ course_id: courseId, title: title, file_path: path });
      if (ins.error) throw new Error("File uploaded, but saving the record failed: " + ins.error.message);

      e.target.reset();
      $("filesCourse").value = courseId;
      App.closeModal("fileModal");
      await loadAll();
      App.toast("File uploaded.", "success");
    } catch (err) {
      setError(errBox, err.message);
    } finally {
      busy(btn, false, "Upload file");
    }
  }

  async function deleteCourseFile(id) {
    var f = state.courseFiles.find(function (x) { return x.id === id; });
    if (!f) return;
    if (!confirm('Delete "' + f.title + '"?')) return;
    await db.storage.from(App.COURSE_FILE_BUCKET).remove([f.file_path]);
    var res = await db.from("course_files").delete().eq("id", id);
    if (res.error) return App.toast(res.error.message, "error");
    await loadCourseFiles();
    App.toast("File deleted.", "success");
  }

  /* ======================= Assignments ======================= */
  async function loadAssignments() {
    var list = $("assignmentsList");
    var courseId = $("assignmentsCourse").value;
    if (!courseId) {
      state.assignments = [];
      state.assignmentCounts = {};
      $("navCountAssignments").textContent = 0;
      list.innerHTML = emptyBlock("Choose a course to see its assignments.");
      return;
    }
    var res = await db.from("assignments")
      .select("id, title, description, file_path, due_date, created_at")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false });
    if (res.error) { list.innerHTML = emptyBlock(res.error.message); return; }
    state.assignments = res.data || [];

    state.assignmentCounts = {};
    if (state.assignments.length) {
      var ids = state.assignments.map(function (a) { return a.id; });
      var subs = await db.from("assignment_submissions").select("assignment_id").in("assignment_id", ids);
      if (subs.error) App.toast(subs.error.message, "error");
      (subs.data || []).forEach(function (s) {
        state.assignmentCounts[s.assignment_id] = (state.assignmentCounts[s.assignment_id] || 0) + 1;
      });
    }
    $("navCountAssignments").textContent = state.assignments.length;
    renderAssignments();
  }

  function renderAssignments() {
    var list = $("assignmentsList");
    if (!state.assignments.length) {
      list.innerHTML = emptyBlock('No assignments yet. Use "Add assignment" to create one.');
      return;
    }
    list.innerHTML = state.assignments.map(function (a) {
      var count = state.assignmentCounts[a.id] || 0;
      var actions = "";
      if (a.file_path) {
        actions += '<button type="button" class="btn btn-sm" data-download-file="' + App.esc(a.file_path) + '">Attachment</button>';
      }
      actions += '<button type="button" class="btn btn-sm" data-subs="' + a.id + '">Submissions (' + count + ")</button>";
      actions += '<button type="button" class="btn btn-sm btn-danger" data-del-assignment="' + a.id + '">Delete</button>';
      return '<div class="row" style="flex-direction:column;align-items:stretch;gap:10px">' +
        '<div class="row">' +
          '<div class="row-main row-grow">' +
            '<span class="title">' + App.esc(a.title) + "</span>" +
            '<span class="sub">' + (a.due_date ? "Due " + App.fmtDate(a.due_date) : "No due date") + "</span>" +
          "</div>" +
          '<div class="row-actions">' + actions + "</div>" +
        "</div>" +
        (a.description ? '<p class="muted" style="font-size:.86rem">' + App.esc(a.description) + "</p>" : "") +
      "</div>";
    }).join("");
  }

  async function onSubmitAssignment(e) {
    e.preventDefault();
    var errBox = $("assignmentError");
    setError(errBox, "");
    var courseId = $("assignmentCourse").value;
    var title = $("assignmentTitle").value.trim();
    var file = $("assignmentFile").files[0];
    if (!courseId) return setError(errBox, "Choose a course.");
    if (!title) return setError(errBox, "Enter a title.");
    if (file && file.size > 25 * 1024 * 1024) return setError(errBox, "Attachment must be smaller than 25 MB.");

    var btn = $("assignmentSubmit");
    busy(btn, true, "Saving…");
    try {
      var filePath = null;
      if (file) {
        var path = courseId + "/assignments/" + Date.now() + "-" + sanitizeName(file.name);
        var up = await db.storage.from(App.COURSE_FILE_BUCKET).upload(path, file, { cacheControl: "3600" });
        if (up.error) throw new Error("Upload failed: " + up.error.message);
        filePath = path;
      }
      var ins = await db.from("assignments").insert({
        course_id: courseId,
        title: title,
        description: $("assignmentDescription").value.trim() || null,
        due_date: $("assignmentDue").value || null,
        file_path: filePath
      });
      if (ins.error) throw new Error(ins.error.message);

      e.target.reset();
      $("assignmentsCourse").value = courseId;
      App.closeModal("assignmentModal");
      await loadAll();
      App.toast("Assignment created.", "success");
    } catch (err) {
      setError(errBox, err.message);
    } finally {
      busy(btn, false, "Create assignment");
    }
  }

  async function deleteAssignment(id) {
    var a = state.assignments.find(function (x) { return x.id === id; });
    if (!a) return;
    if (!confirm('Delete assignment "' + a.title + '"? Student submissions for it are removed too.')) return;
    if (a.file_path) await db.storage.from(App.COURSE_FILE_BUCKET).remove([a.file_path]);
    var res = await db.from("assignments").delete().eq("id", id);
    if (res.error) return App.toast(res.error.message, "error");
    await loadAssignments();
    App.toast("Assignment deleted.", "success");
  }

  async function openSubmissions(assignmentId) {
    var a = state.assignments.find(function (x) { return x.id === assignmentId; });
    $("submissionsTitle").textContent = a ? "Submissions — " + a.title : "Submissions";
    var body = $("submissionsBody");
    body.innerHTML = emptyBlock("Loading…");

    var res = await db.from("assignment_submissions")
      .select("id, file_path, submitted_at, student_id, students:student_id(full_name, email)")
      .eq("assignment_id", assignmentId)
      .order("submitted_at", { ascending: false });
    if (res.error) { body.innerHTML = emptyBlock(res.error.message); return; }

    var rows = res.data || [];
    if (!rows.length) { body.innerHTML = emptyBlock("No student has submitted a solution yet."); return; }

    body.innerHTML = '<div class="list">' + rows.map(function (s) {
      var name = s.students ? s.students.full_name : "Unknown student";
      return '<div class="row">' +
        '<span class="avatar avatar-md avatar-fallback">' + App.esc(App.initials(name)) + "</span>" +
        '<div class="row-main row-grow">' +
          '<span class="title">' + App.esc(name) + "</span>" +
          '<span class="sub">Submitted ' + App.fmtDate(s.submitted_at) + "</span>" +
        "</div>" +
        '<div class="row-actions">' +
          '<button type="button" class="btn btn-sm" data-download-submission="' + App.esc(s.file_path) + '">Download</button>' +
        "</div></div>";
    }).join("") + "</div>";
    App.openModal("submissionsModal");
  }

  /* ======================= Shared file download ======================= */
  async function download(bucket, path, btn) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    var res = await db.storage.from(bucket).createSignedUrl(path, 300);
    btn.disabled = false;
    btn.textContent = label;
    if (res.error) return App.toast("Could not open the file: " + res.error.message, "error");
    window.open(res.data.signedUrl, "_blank", "noopener");
  }

  /* ======================= Data + events ======================= */
  async function loadAll() {
    await loadCourses();
    await Promise.all([loadAccounts(), loadCertificates()]);
    await Promise.all([loadCourseFiles(), loadAssignments()]);
    App.setNotifications([
      { title: state.courses.length + " courses", text: "Courses created so far." },
      { title: state.accounts.length + " accounts", text: "Students, coordinators and instructors." },
      { title: state.courseFiles.length + " course files", text: "Materials shared with a course." },
      { title: state.assignments.length + " assignments", text: "Homework sent to a course." },
      { title: state.certificates.length + " certificates", text: "Certificate files issued so far." }
    ]);
  }

  function bindEvents() {
    $("addCourseBtn").addEventListener("click", function () {
      setError($("courseError"), "");
      $("courseForm").reset();
      courseDates = [];
      renderCourseDates();
      App.openModal("courseModal");
    });
    $("courseAddDateBtn").addEventListener("click", addCourseDate);
    $("courseDateInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addCourseDate(); }
    });
    $("courseDates").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-remove-date]");
      if (btn) removeCourseDate(btn.dataset.removeDate);
    });
    $("courseForm").addEventListener("submit", onSubmitCourse);

    $("addAccountBtn").addEventListener("click", function () {
      setError($("accountError"), "");
      $("accountForm").reset();
      dragger("acc").setImage("");
      $("accAvatarPreview").hidden = true;
      setPosition("acc", "50% 50%");
      renderCourseChips($("accCoordCourses"), []);
      toggleCoordWrap($("accRole"), $("accCoordWrap"), $("accCourseWrap"));
      App.openModal("accountModal");
    });
    $("accRole").addEventListener("change", function () { toggleCoordWrap($("accRole"), $("accCoordWrap"), $("accCourseWrap")); });
    $("editRole").addEventListener("change", function () { toggleCoordWrap($("editRole"), $("editCoordWrap"), $("editCourseWrap")); });
    $("accountForm").addEventListener("submit", onSubmitAccount);
    $("accAvatar").addEventListener("change", function () {
      var file = this.files[0];
      var preview = $("accAvatarPreview");
      if (!file) { dragger("acc").setImage(""); preview.hidden = true; return; }
      dragger("acc").setImage(URL.createObjectURL(file));
      preview.hidden = false;
    });
    $("editAccountForm").addEventListener("submit", onSubmitEditAccount);
    $("editAvatar").addEventListener("change", function () {
      var file = this.files[0];
      var preview = $("editAvatarPreview");
      if (!file) return;
      dragger("edit").setImage(URL.createObjectURL(file));
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

    /* Course files */
    $("filesCourse").addEventListener("change", loadCourseFiles);
    $("addFileBtn").addEventListener("click", function () {
      setError($("fileError"), "");
      $("fileForm").reset();
      if ($("filesCourse").value) $("fileCourse").value = $("filesCourse").value;
      App.openModal("fileModal");
    });
    $("fileForm").addEventListener("submit", onSubmitFile);
    $("filesList").addEventListener("click", function (e) {
      var dl = e.target.closest("[data-download-file]");
      if (dl) return download(App.COURSE_FILE_BUCKET, dl.dataset.downloadFile, dl);
      var del = e.target.closest("[data-del-file]");
      if (del) return deleteCourseFile(del.dataset.delFile);
    });

    /* Assignments */
    $("assignmentsCourse").addEventListener("change", loadAssignments);
    $("addAssignmentBtn").addEventListener("click", function () {
      setError($("assignmentError"), "");
      $("assignmentForm").reset();
      if ($("assignmentsCourse").value) $("assignmentCourse").value = $("assignmentsCourse").value;
      App.openModal("assignmentModal");
    });
    $("assignmentForm").addEventListener("submit", onSubmitAssignment);
    $("assignmentsList").addEventListener("click", function (e) {
      var dl = e.target.closest("[data-download-file]");
      if (dl) return download(App.COURSE_FILE_BUCKET, dl.dataset.downloadFile, dl);
      var subs = e.target.closest("[data-subs]");
      if (subs) return openSubmissions(subs.dataset.subs);
      var del = e.target.closest("[data-del-assignment]");
      if (del) return deleteAssignment(del.dataset.delAssignment);
    });
    $("submissionsBody").addEventListener("click", function (e) {
      var dl = e.target.closest("[data-download-submission]");
      if (dl) return download(App.SUBMISSION_BUCKET, dl.dataset.downloadSubmission, dl);
    });
  }

  async function init() {
    var auth = await App.requireAuth("admin");
    if (!auth) return;
    state.profile = auth.profile;
    App.renderTopbar(auth.profile);
    renderCourseDates();
    bindNav();
    bindEvents();
    await loadAll();
  }

  init();
})();
