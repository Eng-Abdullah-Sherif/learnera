/* ============================================================================
   LearnEra - coordinator dashboard
   A coordinator manages one or more courses (linked through coordinator_courses).
   Sections: Attendance, Course files, Announcements.
   Row Level Security limits every read and write to the coordinator's courses.
   ========================================================================== */
(function () {
  "use strict";

  var db = App.db;
  var $ = function (id) { return document.getElementById(id); };

  var profile = null;
  var state = {
    courses: [],
    students: [],
    attendance: {},   /* studentId -> "present" | "absent" */
    files: [],
    announcements: []
  };

  function emptyBlock(text) { return '<div class="empty">' + App.esc(text) + "</div>"; }
  function sanitizeName(name) { return String(name).replace(/[^a-zA-Z0-9._-]/g, "-").slice(-60) || "file"; }
  function setError(el, message) {
    if (!message) { el.hidden = true; el.textContent = ""; return; }
    el.textContent = message;
    el.hidden = false;
  }
  function busy(btn, isBusy, label) {
    btn.disabled = isBusy;
    btn.innerHTML = isBusy ? '<span class="spinner"></span> ' + App.esc(label) : App.esc(label);
  }
  function courseOptions(selectedId) {
    return state.courses.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === selectedId ? " selected" : "") + ">" + App.esc(c.name) + "</option>";
    }).join("");
  }
  function keepValue(select, html) {
    var previous = select.value;
    select.innerHTML = html;
    if (previous) select.value = previous;
    if (!select.value) select.selectedIndex = 0;
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
  async function loadMyCourses() {
    var res = await db.from("coordinator_courses")
      .select("course_id, courses:course_id(id, name, description, location, course_dates)")
      .order("created_at", { ascending: true });
    if (res.error) { App.toast(res.error.message, "error"); return; }
    state.courses = (res.data || []).map(function (r) { return r.courses; }).filter(Boolean);

    var options = state.courses.length ? courseOptions() : '<option value="">No courses assigned</option>';
    ["attCourse", "filesCourse", "annCourse", "fileCourse", "annFormCourse"].forEach(function (id) {
      keepValue($(id), options);
    });

    var hasCourses = state.courses.length > 0;
    $("attCourse").disabled = !hasCourses;
    $("filesCourse").disabled = !hasCourses;
    $("annCourse").disabled = !hasCourses;
    $("addFileBtn").disabled = !hasCourses;
    $("addAnnBtn").disabled = !hasCourses;
    $("attSaveBtn").disabled = !hasCourses;
    $("attHint").textContent = hasCourses ? "" : "An administrator has not linked any course to you yet.";
    if (hasCourses && !$("attDate").value) $("attDate").value = App.todayISO();
  }

  /* ======================= Attendance ======================= */
  function studentRow(s) {
    var choice = state.attendance[s.id] || null;
    var name = s.full_name || s.email || "Student";
    return '<div class="row">' +
      App.avatarMarkup(s.avatar_url, name, "avatar-md", s.avatar_position) +
      '<div class="row-main row-grow">' +
        '<span class="title">' + App.esc(name) + "</span>" +
        '<span class="sub">ID: ' + App.esc(s.member_id || "—") + "</span>" +
      "</div>" +
      '<div class="seg" data-student="' + s.id + '">' +
        '<button type="button" class="seg-btn seg-present' + (choice === "present" ? " active" : "") + '" data-mark="present">Present</button>' +
        '<button type="button" class="seg-btn seg-absent' + (choice === "absent" ? " active" : "") + '" data-mark="absent">Absent</button>' +
      "</div></div>";
  }

  function renderAttendance() {
    var list = $("attList");
    if (!state.students.length) {
      list.innerHTML = emptyBlock("No students are enrolled in this course yet.");
      return;
    }
    list.innerHTML = state.students.map(studentRow).join("");
  }

  async function loadAttendance() {
    var list = $("attList");
    var courseId = $("attCourse").value;
    var date = $("attDate").value;
    state.students = [];
    state.attendance = {};
    if (!courseId) { list.innerHTML = emptyBlock("Choose a course to see its students."); return; }
    if (!date) { list.innerHTML = emptyBlock("Choose the session date."); return; }

    list.innerHTML = emptyBlock("Loading…");

    var students = await db.from("profiles")
      .select("id, full_name, email, member_id, avatar_url, avatar_position")
      .eq("role", "student")
      .eq("course_id", courseId)
      .order("full_name", { ascending: true });
    if (students.error) { list.innerHTML = emptyBlock(students.error.message); return; }
    state.students = students.data || [];

    var existing = await db.from("attendance")
      .select("student_id, status")
      .eq("course_id", courseId)
      .eq("session_date", date);
    if (existing.error) { list.innerHTML = emptyBlock(existing.error.message); return; }
    (existing.data || []).forEach(function (r) { state.attendance[r.student_id] = r.status; });

    renderAttendance();
  }

  function markAttendance(studentId, mark) {
    if (state.attendance[studentId] === mark) delete state.attendance[studentId];
    else state.attendance[studentId] = mark;
    var group = $("attList").querySelector('[data-student="' + studentId + '"]');
    if (!group) return;
    group.querySelectorAll(".seg-btn").forEach(function (b) {
      b.classList.toggle("active", state.attendance[studentId] === b.dataset.mark);
    });
  }

  async function saveAttendance() {
    var courseId = $("attCourse").value;
    var date = $("attDate").value;
    if (!courseId || !date) return App.toast("Choose a course and a date first.", "error");

    var btn = $("attSaveBtn");
    busy(btn, true, "Saving…");
    try {
      var del = await db.from("attendance").delete().eq("course_id", courseId).eq("session_date", date);
      if (del.error) throw new Error(del.error.message);

      var rows = state.students
        .filter(function (s) { return state.attendance[s.id]; })
        .map(function (s) {
          return { student_id: s.id, course_id: courseId, session_date: date, status: state.attendance[s.id] };
        });
      if (rows.length) {
        var ins = await db.from("attendance").insert(rows);
        if (ins.error) throw new Error(ins.error.message);
      }
      App.toast("Attendance saved.", "success");
      await loadAttendance();
    } catch (err) {
      App.toast(err.message, "error");
    } finally {
      busy(btn, false, "Save attendance");
    }
  }

  /* ======================= Course files ======================= */
  async function loadCourseFiles() {
    var list = $("filesList");
    var courseId = $("filesCourse").value;
    if (!courseId) {
      state.files = [];
      $("navCountFiles").textContent = 0;
      list.innerHTML = emptyBlock("Choose a course to see its files.");
      return;
    }
    var res = await db.from("course_files")
      .select("id, title, file_path, uploaded_at")
      .eq("course_id", courseId)
      .order("uploaded_at", { ascending: false });
    if (res.error) { list.innerHTML = emptyBlock(res.error.message); return; }
    state.files = res.data || [];
    $("navCountFiles").textContent = state.files.length;
    if (!state.files.length) { list.innerHTML = emptyBlock('No files yet. Use "Upload file" to share one.'); return; }

    list.innerHTML = state.files.map(function (f) {
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
      await loadCourseFiles();
      App.toast("File uploaded.", "success");
    } catch (err) {
      setError(errBox, err.message);
    } finally {
      busy(btn, false, "Upload file");
    }
  }

  async function deleteCourseFile(id) {
    var f = state.files.find(function (x) { return x.id === id; });
    if (!f) return;
    if (!confirm('Delete "' + f.title + '"?')) return;
    await db.storage.from(App.COURSE_FILE_BUCKET).remove([f.file_path]);
    var res = await db.from("course_files").delete().eq("id", id);
    if (res.error) return App.toast(res.error.message, "error");
    await loadCourseFiles();
    App.toast("File deleted.", "success");
  }

  /* ======================= Announcements ======================= */
  async function loadAnnouncements() {
    var list = $("annList");
    var courseId = $("annCourse").value;
    if (!courseId) {
      state.announcements = [];
      $("navCountAnn").textContent = 0;
      list.innerHTML = emptyBlock("Choose a course to see its announcements.");
      return;
    }
    var res = await db.from("announcements")
      .select("id, title, body, created_at")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false });
    if (res.error) { list.innerHTML = emptyBlock(res.error.message); return; }
    state.announcements = res.data || [];
    $("navCountAnn").textContent = state.announcements.length;
    if (!state.announcements.length) { list.innerHTML = emptyBlock('No announcements yet. Use "New announcement" to post one.'); return; }

    list.innerHTML = state.announcements.map(function (a) {
      return '<div class="row" style="flex-direction:column;align-items:stretch;gap:8px">' +
        '<div class="row">' +
          '<div class="row-main row-grow">' +
            '<span class="title">' + App.esc(a.title) + "</span>" +
            '<span class="sub">Posted ' + App.fmtDate(a.created_at) + "</span>" +
          "</div>" +
          '<div class="row-actions">' +
            '<button type="button" class="btn btn-sm btn-danger" data-del-ann="' + a.id + '">Delete</button>' +
          "</div>" +
        "</div>" +
        (a.body ? '<p class="muted" style="font-size:.88rem">' + App.esc(a.body) + "</p>" : "") +
      "</div>";
    }).join("");
  }

  async function onSubmitAnnouncement(e) {
    e.preventDefault();
    var errBox = $("annError");
    setError(errBox, "");
    var courseId = $("annFormCourse").value;
    var title = $("annTitle").value.trim();
    if (!courseId) return setError(errBox, "Choose a course.");
    if (!title) return setError(errBox, "Enter a title.");

    var btn = $("annSubmit");
    busy(btn, true, "Posting…");
    try {
      var ins = await db.from("announcements").insert({
        course_id: courseId,
        title: title,
        body: $("annBody").value.trim() || null,
        author_id: profile.id
      });
      if (ins.error) throw new Error(ins.error.message);

      e.target.reset();
      $("annCourse").value = courseId;
      App.closeModal("annModal");
      await loadAnnouncements();
      App.toast("Announcement posted.", "success");
    } catch (err) {
      setError(errBox, err.message);
    } finally {
      busy(btn, false, "Post announcement");
    }
  }

  async function deleteAnnouncement(id) {
    var a = state.announcements.find(function (x) { return x.id === id; });
    if (!a) return;
    if (!confirm('Delete "' + a.title + '"?')) return;
    var res = await db.from("announcements").delete().eq("id", id);
    if (res.error) return App.toast(res.error.message, "error");
    await loadAnnouncements();
    App.toast("Announcement deleted.", "success");
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

  /* ======================= Events + boot ======================= */
  function bindEvents() {
    $("attCourse").addEventListener("change", loadAttendance);
    $("attDate").addEventListener("change", loadAttendance);
    $("attSaveBtn").addEventListener("click", saveAttendance);
    $("attList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-mark]");
      if (!btn) return;
      var group = btn.closest("[data-student]");
      if (group) markAttendance(group.dataset.student, btn.dataset.mark);
    });

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

    $("annCourse").addEventListener("change", loadAnnouncements);
    $("addAnnBtn").addEventListener("click", function () {
      setError($("annError"), "");
      $("annForm").reset();
      if ($("annCourse").value) $("annFormCourse").value = $("annCourse").value;
      App.openModal("annModal");
    });
    $("annForm").addEventListener("submit", onSubmitAnnouncement);
    $("annList").addEventListener("click", function (e) {
      var del = e.target.closest("[data-del-ann]");
      if (del) return deleteAnnouncement(del.dataset.delAnn);
    });
  }

  async function init() {
    var auth = await App.requireAuth("coordinator");
    if (!auth) return;
    profile = auth.profile;
    App.renderTopbar(profile);
    bindNav();
    bindEvents();
    await loadMyCourses();
    await Promise.all([loadAttendance(), loadCourseFiles(), loadAnnouncements()]);

    App.setNotifications([
      { title: state.courses.length + " courses", text: "Courses you coordinate." },
      { title: state.students.length + " students", text: "Students in the selected course." },
      { title: state.announcements.length + " announcements", text: "Posted for the selected course." }
    ]);
  }

  init();
})();
