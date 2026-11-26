/* ============================================================================
   LearnEra - instructor dashboard
   Lets an instructor share files, create assignments and review the solutions
   the students submitted. An instructor can be linked to several courses and
   switches between them from the header card.
   Row Level Security limits every read and write to the instructor's courses.
   ========================================================================== */
(function () {
  "use strict";

  var db = App.db;
  var $ = function (id) { return document.getElementById(id); };

  var profile = null;
  var courses = [];
  var course = null;
  var state = { files: [], assignments: [], counts: {}, students: [] };

  function emptyBlock(text) { return '<div class="empty">' + App.esc(text) + "</div>"; }
  function sanitizeName(name) { return String(name).replace(/[^a-zA-Z0-9._-]/g, "-").slice(-60) || "file"; }
  function fmtScore(v) {
    var n = Number(v);
    if (isNaN(n)) return "0";
    return (Math.round(n * 100) / 100).toString();
  }
  function setError(el, message) {
    if (!message) { el.hidden = true; el.textContent = ""; return; }
    el.textContent = message;
    el.hidden = false;
  }
  function busy(btn, isBusy, label) {
    btn.disabled = isBusy;
    btn.innerHTML = isBusy ? '<span class="spinner"></span> ' + App.esc(label) : App.esc(label);
  }

  /* ======================= Course header ======================= */
  function renderCourse() {
    var card = $("courseCard");
    if (!course) {
      card.innerHTML = emptyBlock("You are not assigned to a course yet. Ask an administrator to link your account to a course.");
      $("addFileBtn").disabled = true;
      $("addAssignmentBtn").disabled = true;
      return;
    }
    $("addFileBtn").disabled = false;
    $("addAssignmentBtn").disabled = false;

    var online = course.location === "online";
    var switcher = "";
    if (courses.length > 1) {
      switcher = '<div class="field" style="margin:0">' +
        '<label for="courseSwitch">Course</label>' +
        '<select class="select" id="courseSwitch" style="width:auto;min-width:190px">' +
          courses.map(function (c) {
            return '<option value="' + App.esc(c.id) + '"' + (c.id === course.id ? " selected" : "") + ">" +
              App.esc(c.name) + "</option>";
          }).join("") +
        "</select></div>";
    }

    card.innerHTML = '<div class="section-head" style="margin-bottom:0;flex-wrap:wrap;gap:12px">' +
      "<div><h2>" + App.esc(course.name) + "</h2>" +
        '<p class="sub">' + (course.description ? App.esc(course.description) : "No description.") + "</p></div>" +
      '<div class="row-actions">' + switcher +
        '<div class="tags" style="justify-content:flex-end">' +
          '<span class="badge ' + (online ? "badge-cyan" : "badge-indigo") + '">' + (online ? "Online" : "Offline") + "</span>" +
          '<span class="badge badge-muted">' + App.esc(App.datesLabel(course.course_dates, 4)) + "</span>" +
        "</div></div></div>";

    var sw = $("courseSwitch");
    if (sw) sw.addEventListener("change", function () { selectCourse(sw.value); });
  }

  async function selectCourse(id) {
    var next = courses.find(function (c) { return c.id === id; });
    if (!next || next.id === course.id) return;
    course = next;
    renderCourse();
    await reload();
  }

  /* ======================= Course files ======================= */
  async function loadFiles() {
    var body = $("filesBody");
    if (!course) { body.innerHTML = emptyBlock("No course assigned yet."); return; }
    var res = await db.from("course_files")
      .select("id, title, file_path, uploaded_at")
      .eq("course_id", course.id)
      .order("uploaded_at", { ascending: false });
    if (res.error) { body.innerHTML = emptyBlock(res.error.message); return; }
    state.files = res.data || [];
    if (!state.files.length) { body.innerHTML = emptyBlock('No files yet. Use "Upload file" to share one.'); return; }

    body.innerHTML = '<div class="list">' + state.files.map(function (f) {
      return '<div class="row">' +
        '<div class="row-main row-grow">' +
          '<span class="title">' + App.esc(f.title) + "</span>" +
          '<span class="sub">Uploaded ' + App.fmtDate(f.uploaded_at) + "</span>" +
        "</div>" +
        '<div class="row-actions">' +
          '<button type="button" class="btn btn-sm" data-download-file="' + App.esc(f.file_path) + '">Download</button>' +
          '<button type="button" class="btn btn-sm btn-danger" data-del-file="' + f.id + '">Delete</button>' +
        "</div></div>";
    }).join("") + "</div>";
  }

  async function onSubmitFile(e) {
    e.preventDefault();
    var errBox = $("fileError");
    setError(errBox, "");
    var title = $("fileTitle").value.trim();
    var file = $("fileFile").files[0];
    if (!title) return setError(errBox, "Enter a title.");
    if (!file) return setError(errBox, "Choose a file.");
    if (file.size > 25 * 1024 * 1024) return setError(errBox, "File must be smaller than 25 MB.");

    var btn = $("fileSubmit");
    busy(btn, true, "Uploading…");
    try {
      var path = course.id + "/" + Date.now() + "-" + sanitizeName(file.name);
      var up = await db.storage.from(App.COURSE_FILE_BUCKET).upload(path, file, { cacheControl: "3600" });
      if (up.error) throw new Error("Upload failed: " + up.error.message);
      var ins = await db.from("course_files").insert({ course_id: course.id, title: title, file_path: path });
      if (ins.error) throw new Error("File uploaded, but saving the record failed: " + ins.error.message);

      e.target.reset();
      App.closeModal("fileModal");
      await loadFiles();
      App.toast("File uploaded.", "success");
    } catch (err) {
      setError(errBox, err.message);
    } finally {
      busy(btn, false, "Upload file");
    }
  }

  async function deleteFile(id) {
    var f = state.files.find(function (x) { return x.id === id; });
    if (!f) return;
    if (!confirm('Delete "' + f.title + '"?')) return;
    await db.storage.from(App.COURSE_FILE_BUCKET).remove([f.file_path]);
    var res = await db.from("course_files").delete().eq("id", id);
    if (res.error) return App.toast(res.error.message, "error");
    await loadFiles();
    App.toast("File deleted.", "success");
  }

  /* ======================= Assignments ======================= */
  async function loadAssignments() {
    var body = $("assignmentsBody");
    if (!course) { body.innerHTML = emptyBlock("No course assigned yet."); return; }
    var res = await db.from("assignments")
      .select("id, title, description, file_path, due_date, created_at")
      .eq("course_id", course.id)
      .order("created_at", { ascending: false });
    if (res.error) { body.innerHTML = emptyBlock(res.error.message); return; }
    state.assignments = res.data || [];

    state.counts = {};
    if (state.assignments.length) {
      var ids = state.assignments.map(function (a) { return a.id; });
      var subs = await db.from("assignment_submissions").select("assignment_id").in("assignment_id", ids);
      if (subs.error) App.toast(subs.error.message, "error");
      (subs.data || []).forEach(function (s) {
        state.counts[s.assignment_id] = (state.counts[s.assignment_id] || 0) + 1;
      });
    }

    if (!state.assignments.length) { body.innerHTML = emptyBlock('No assignments yet. Use "Add assignment" to create one.'); return; }

    body.innerHTML = '<div class="list">' + state.assignments.map(function (a) {
      var count = state.counts[a.id] || 0;
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
    }).join("") + "</div>";
  }

  async function onSubmitAssignment(e) {
    e.preventDefault();
    var errBox = $("assignmentError");
    setError(errBox, "");
    var title = $("assignmentTitle").value.trim();
    var file = $("assignmentFile").files[0];
    if (!title) return setError(errBox, "Enter a title.");
    if (file && file.size > 25 * 1024 * 1024) return setError(errBox, "Attachment must be smaller than 25 MB.");

    var btn = $("assignmentSubmit");
    busy(btn, true, "Saving…");
    try {
      var filePath = null;
      if (file) {
        var path = course.id + "/assignments/" + Date.now() + "-" + sanitizeName(file.name);
        var up = await db.storage.from(App.COURSE_FILE_BUCKET).upload(path, file, { cacheControl: "3600" });
        if (up.error) throw new Error("Upload failed: " + up.error.message);
        filePath = path;
      }
      var ins = await db.from("assignments").insert({
        course_id: course.id,
        title: title,
        description: $("assignmentDescription").value.trim() || null,
        due_date: $("assignmentDue").value || null,
        file_path: filePath
      });
      if (ins.error) throw new Error(ins.error.message);

      e.target.reset();
      App.closeModal("assignmentModal");
      await loadAssignments();
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
      .select("id, file_path, submitted_at, student_id, grade, feedback, students:student_id(full_name, email, member_id, avatar_url, avatar_position)")
      .eq("assignment_id", assignmentId)
      .order("submitted_at", { ascending: false });
    if (res.error) { body.innerHTML = emptyBlock(res.error.message); return; }

    var rows = res.data || [];
    if (!rows.length) { body.innerHTML = emptyBlock("No student has submitted a solution yet."); return; }

    body.innerHTML = '<div class="list">' + rows.map(function (s) {
      var stu = s.students || {};
      var name = stu.full_name || "Unknown student";
      var meta = stu.member_id ? " · ID: " + App.esc(stu.member_id) : "";
      var graded = s.grade !== null && s.grade !== undefined;
      return '<div class="grade-item" data-sub-id="' + s.id + '">' +
        '<div class="row">' +
          App.avatarMarkup(stu.avatar_url, name, "avatar-md", stu.avatar_position) +
          '<div class="row-main row-grow">' +
            '<span class="title">' + App.esc(name) + "</span>" +
            '<span class="sub">Submitted ' + App.fmtDate(s.submitted_at) + meta + "</span>" +
          "</div>" +
          '<div class="row-actions">' +
            '<span class="badge ' + (graded ? "badge-green" : "badge-muted") + '" data-grade-badge>' +
              (graded ? "Grade " + App.esc(fmtScore(s.grade)) : "Not graded") + "</span>" +
            '<button type="button" class="btn btn-sm" data-download-submission="' + App.esc(s.file_path) + '">Download</button>' +
          "</div>" +
        "</div>" +
        '<div class="grade-grid">' +
          '<div class="field">' +
            '<label>Grade</label>' +
            '<input class="input" type="number" min="0" step="0.5" data-grade-input ' +
              'value="' + (graded ? App.esc(fmtScore(s.grade)) : "") + '" placeholder="e.g. 7.5">' +
          "</div>" +
          '<div class="field">' +
            '<label>Feedback</label>' +
            '<input class="input" maxlength="400" data-feedback-input placeholder="Comment for the student" ' +
              'value="' + App.esc(s.feedback || "") + '">' +
          "</div>" +
          '<button type="button" class="btn btn-primary" data-save-grade>Save</button>' +
        "</div>" +
      "</div>";
    }).join("") + "</div>";
    App.openModal("submissionsModal");
  }

  async function saveGrade(btn) {
    var item = btn.closest("[data-sub-id]");
    if (!item) return;
    var subId = item.getAttribute("data-sub-id");
    var raw = item.querySelector("[data-grade-input]").value.trim();
    var feedback = item.querySelector("[data-feedback-input]").value.trim();
    var grade = raw === "" ? null : Number(raw);
    if (raw !== "" && (isNaN(grade) || grade < 0)) return App.toast("Enter a valid grade.", "error");

    busy(btn, true, "Saving…");
    var res = await db.rpc("grade_submission", { target_id: subId, new_grade: grade, new_feedback: feedback });
    busy(btn, false, "Save");
    if (res.error) return App.toast(res.error.message, "error");

    var badge = item.querySelector("[data-grade-badge]");
    if (badge) {
      badge.className = "badge " + (grade === null ? "badge-muted" : "badge-green");
      badge.textContent = grade === null ? "Not graded" : "Grade " + fmtScore(grade);
    }
    App.toast("Grade saved.", "success");
    loadStudents();
  }

  /* ======================= Course roster ======================= */
  async function loadStudents() {
    var body = $("studentsBody");
    var countTag = $("studentsCount");
    if (!course) {
      body.innerHTML = emptyBlock("No course assigned yet.");
      if (countTag) countTag.textContent = "0 students";
      return;
    }
    body.innerHTML = emptyBlock("Loading…");

    var roster = await db.from("profiles")
      .select("id, full_name, email, member_id, avatar_url, avatar_position")
      .eq("course_id", course.id)
      .eq("role", "student")
      .order("full_name", { ascending: true });
    if (roster.error) { body.innerHTML = emptyBlock(roster.error.message); return; }

    var students = roster.data || [];
    state.students = students;
    if (countTag) countTag.textContent = students.length + (students.length === 1 ? " student" : " students");
    if (!students.length) { body.innerHTML = emptyBlock("No students are enrolled in your course yet."); return; }

    var att = await db.from("attendance").select("student_id, status").eq("course_id", course.id);
    if (att.error) App.toast(att.error.message, "error");
    var present = {}, absent = {};
    (att.data || []).forEach(function (r) {
      if (r.status === "present") present[r.student_id] = (present[r.student_id] || 0) + 1;
      else if (r.status === "absent") absent[r.student_id] = (absent[r.student_id] || 0) + 1;
    });

    var totals = {}, gradedCount = {};
    var ids = state.assignments.map(function (a) { return a.id; });
    if (ids.length) {
      var subs = await db.from("assignment_submissions").select("student_id, grade").in("assignment_id", ids);
      if (subs.error) App.toast(subs.error.message, "error");
      (subs.data || []).forEach(function (s) {
        if (s.grade === null || s.grade === undefined) return;
        totals[s.student_id] = (totals[s.student_id] || 0) + Number(s.grade);
        gradedCount[s.student_id] = (gradedCount[s.student_id] || 0) + 1;
      });
    }

    var totalDates = (course.course_dates || []).length;

    body.innerHTML = '<div class="list">' + students.map(function (s) {
      var p = present[s.id] || 0;
      var a = absent[s.id] || 0;
      var denom = totalDates > 0 ? totalDates : (p + a);
      var pct = denom > 0 ? Math.round((p / denom) * 100) : 0;
      if (pct > 100) pct = 100;
      var graded = gradedCount[s.id] || 0;
      return '<div class="roster-item">' +
        '<div class="row">' +
          App.avatarMarkup(s.avatar_url, s.full_name, "avatar-md", s.avatar_position) +
          '<div class="row-main row-grow">' +
            '<span class="title">' + App.esc(s.full_name) + "</span>" +
            '<span class="sub">ID: ' + App.esc(s.member_id || "—") + " · " + App.esc(s.email || "") + "</span>" +
          "</div>" +
          '<div class="row-actions roster-badges">' +
            '<span class="badge badge-green">Present ' + p + "</span>" +
            '<span class="badge badge-rose">Absent ' + a + "</span>" +
            '<span class="badge badge-violet">Total ' + fmtScore(totals[s.id] || 0) + "</span>" +
            '<span class="badge badge-muted">' + graded + " graded</span>" +
          "</div>" +
        "</div>" +
        '<div class="roster-bar">' +
          '<div class="progress"><span style="width:' + pct + '%"></span></div>' +
          '<span class="roster-pct">' + pct + "% completed</span>" +
        "</div>" +
      "</div>";
    }).join("") + "</div>";
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
    $("addFileBtn").addEventListener("click", function () {
      setError($("fileError"), "");
      $("fileForm").reset();
      App.openModal("fileModal");
    });
    $("fileForm").addEventListener("submit", onSubmitFile);
    $("filesBody").addEventListener("click", function (e) {
      var dl = e.target.closest("[data-download-file]");
      if (dl) return download(App.COURSE_FILE_BUCKET, dl.dataset.downloadFile, dl);
      var del = e.target.closest("[data-del-file]");
      if (del) return deleteFile(del.dataset.delFile);
    });

    $("addAssignmentBtn").addEventListener("click", function () {
      setError($("assignmentError"), "");
      $("assignmentForm").reset();
      App.openModal("assignmentModal");
    });
    $("assignmentForm").addEventListener("submit", onSubmitAssignment);
    $("assignmentsBody").addEventListener("click", function (e) {
      var dl = e.target.closest("[data-download-file]");
      if (dl) return download(App.COURSE_FILE_BUCKET, dl.dataset.downloadFile, dl);
      var subs = e.target.closest("[data-subs]");
      if (subs) return openSubmissions(subs.dataset.subs);
      var del = e.target.closest("[data-del-assignment]");
      if (del) return deleteAssignment(del.dataset.delAssignment);
    });
    $("submissionsBody").addEventListener("click", function (e) {
      var save = e.target.closest("[data-save-grade]");
      if (save) return saveGrade(save);
      var dl = e.target.closest("[data-download-submission]");
      if (dl) return download(App.SUBMISSION_BUCKET, dl.dataset.downloadSubmission, dl);
    });
  }

  async function reload() {
    await Promise.all([loadFiles(), loadAssignments()]);
    await loadStudents();
    refreshNotifications();
  }

  function refreshNotifications() {
    App.setNotifications([
      course
        ? { title: course.name, text: App.datesLabel(course.course_dates, 3) }
        : { title: "No course", text: "Ask an administrator to assign you a course." },
      { title: state.files.length + " files", text: "Materials shared with your course." },
      { title: state.assignments.length + " assignments", text: "Homework sent to your course." },
      { title: state.students.length + " students", text: "Enrolled in your course." }
    ]);
  }

  async function init() {
    var auth = await App.requireAuth("instructor");
    if (!auth) return;
    profile = auth.profile;
    App.renderTopbar(profile);

    var res = await db.from("profiles")
      .select("*, courses:course_id(id, name, description, location, course_dates)")
      .eq("id", profile.id)
      .maybeSingle();
    if (res.error) App.toast(res.error.message, "error");
    var row = res.data || profile;

    // Courses the administrator linked to this instructor (several allowed).
    var links = await db.from("coordinator_courses")
      .select("course_id, courses:course_id(id, name, description, location, course_dates)")
      .eq("member_id", profile.member_id);
    if (links.error) App.toast(links.error.message, "error");

    var byId = {};
    (links.data || []).forEach(function (l) {
      if (l.courses && l.courses.id) byId[l.courses.id] = l.courses;
    });
    if (row.courses && row.courses.id && !byId[row.courses.id]) byId[row.courses.id] = row.courses;
    courses = Object.keys(byId).map(function (k) { return byId[k]; });
    courses.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    course = courses[0] || null;

    renderCourse();
    bindEvents();
    await reload();
  }

  init();
})();
