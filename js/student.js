/* ============================================================================
   LearnEra - student dashboard
   Shows the signed-in user's profile, course details, the course files and the
   assignments sent by the instructor (with solution upload).
   All reads are limited by Row Level Security to the data the user may see.
   ========================================================================== */
(function () {
  "use strict";

  var db = App.db;
  var $ = function (id) { return document.getElementById(id); };

  var profile = null;
  var course = null;
  var isStudent = false;
  var pendingAssignmentId = null;

  var ICON_ANNOUNCE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 0 1-5.8-1.6"/></svg>';

  function emptyBlock(text) { return '<div class="empty">' + App.esc(text) + "</div>"; }
  function sanitizeName(name) {
    return String(name).replace(/[^a-zA-Z0-9._-]/g, "-").slice(-60) || "file";
  }
  function sortedDates(dates) {
    return (dates || []).slice().sort();
  }
  function fmtScore(v) {
    var n = Number(v);
    if (isNaN(n)) return "0";
    return (Math.round(n * 100) / 100).toString();
  }

  /* ======================= Hero ======================= */
  function renderHero(row, courseData) {
    var name = row.full_name || row.email || "Member";
    var tags = '<span class="badge badge-muted">ID: ' + App.esc(row.member_id || "—") + "</span>";

    var coursePanel = courseData
      ? '<button type="button" class="hero-course" id="heroCourseBtn">' +
          '<span class="badge badge-violet">' + App.esc(courseData.name) + "</span>" +
          '<span class="badge ' + (courseData.location === "online" ? "badge-cyan" : "badge-indigo") + '">' +
            (courseData.location === "online" ? "Online" : "Offline") + "</span>" +
          '<span class="badge badge-muted">' + App.esc(App.datesLabel(courseData.course_dates, 4)) + "</span>" +
          '<span class="hero-course-hint">View full details</span>' +
        "</button>"
      : '<div class="hero-course"><span class="badge badge-muted">No course assigned</span></div>';

    $("hero").innerHTML =
      '<div class="hero-main">' +
        App.avatarMarkup(row.avatar_url, name, "avatar-xl", row.avatar_position) +
        "<div>" +
          "<h1>" + App.esc(name) + "</h1>" +
          '<p class="sub">' + App.esc(App.roleLabel(row.role)) + " · " + App.esc(row.email || "") + "</p>" +
          '<div class="tags">' + tags + "</div>" +
        "</div>" +
      "</div>" +
      coursePanel;

    if ($("heroCourseBtn")) $("heroCourseBtn").addEventListener("click", openCourseDetail);
  }

  async function openCourseDetail() {
    if (!course) return;
    $("courseDetailTitle").textContent = course.name;
    var body = $("courseDetailBody");
    body.innerHTML = '<div class="empty">Loading…</div>';

    var attendance = {};
    if (profile) {
      var res = await db.from("attendance")
        .select("session_date, status")
        .eq("student_id", profile.id)
        .eq("course_id", course.id);
      if (res.error) App.toast(res.error.message, "error");
      (res.data || []).forEach(function (r) { attendance[r.session_date] = r.status; });
    }

    var dates = sortedDates(course.course_dates);
    var today = App.todayISO();
    var nextMarked = false;
    var presentCount = 0;
    var absentCount = 0;
    dates.forEach(function (d) {
      if (attendance[d] === "present") presentCount++;
      else if (attendance[d] === "absent") absentCount++;
    });

    var timeline = dates.length
      ? '<div class="tl">' + dates.map(function (d) {
          var status = attendance[d] || null;
          var isNext = !nextMarked && d >= today;
          if (isNext) nextMarked = true;
          var cls = "tl-item " +
            (status === "present" ? "is-present" : status === "absent" ? "is-absent" : "is-none") +
            (isNext ? " is-next" : "");
          var label = status === "present" ? "Present" : status === "absent" ? "Absent" : "No record";
          return '<div class="' + cls + '">' +
            '<span class="tl-dot"></span>' +
            '<span class="tl-body">' +
              '<span class="tl-date">' + App.esc(App.dateLabel(d)) + "</span>" +
              '<span class="tl-status">' + App.esc(label) + "</span>" +
            "</span>" +
            (isNext ? '<span class="badge badge-violet tl-next">Next</span>' : "") +
          "</div>";
        }).join("") + "</div>"
      : '<p class="muted">No dates set for this course.</p>';

    body.innerHTML =
      '<div class="detail-grid">' +
        '<div class="detail-info">' +
          '<h3 class="detail-name">' + App.esc(course.name) + "</h3>" +
          '<p class="muted">' + (course.description ? App.esc(course.description) : "No description.") + "</p>" +
          '<div class="tags">' +
            '<span class="badge ' + (course.location === "online" ? "badge-cyan" : "badge-indigo") + '">' +
              (course.location === "online" ? "Online" : "Offline") + "</span>" +
            '<span class="badge badge-green">Present: ' + presentCount + "</span>" +
            '<span class="badge badge-rose">Absent: ' + absentCount + "</span>" +
          "</div>" +
        "</div>" +
        '<div class="detail-timeline">' +
          '<h4 class="detail-tl-title">Schedule</h4>' + timeline +
        "</div>" +
      "</div>";
    App.openModal("courseDetailModal");
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
    var rows = res.data || [];
    if (!rows.length) { body.innerHTML = emptyBlock("No files have been shared yet."); return; }

    body.innerHTML = '<div class="list">' + rows.map(function (f) {
      return '<div class="row">' +
        '<div class="row-main row-grow">' +
          '<span class="title">' + App.esc(f.title) + "</span>" +
          '<span class="sub">Added ' + App.fmtDate(f.uploaded_at) + "</span>" +
        "</div>" +
        '<div class="row-actions">' +
          '<button type="button" class="btn btn-sm" data-download-file="' + App.esc(f.file_path) + '">Download</button>' +
        "</div></div>";
    }).join("") + "</div>";

    body.querySelectorAll("[data-download-file]").forEach(function (btn) {
      btn.addEventListener("click", function () { download(App.COURSE_FILE_BUCKET, btn.dataset.downloadFile, btn); });
    });
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
    var rows = res.data || [];
    if (!rows.length) { body.innerHTML = emptyBlock("No assignments yet."); return; }

    var byId = {};
    if (isStudent) {
      var subs = await db.from("assignment_submissions")
        .select("assignment_id, file_path, submitted_at, grade, feedback")
        .eq("student_id", profile.id);
      if (subs.error) App.toast(subs.error.message, "error");
      (subs.data || []).forEach(function (s) { byId[s.assignment_id] = s; });
    }

    body.innerHTML = '<div class="list">' + rows.map(function (a) {
      var sub = byId[a.id];
      var hasGrade = !!(sub && sub.grade !== null && sub.grade !== undefined);
      var actions = "";
      if (a.file_path) {
        actions += '<button type="button" class="btn btn-sm" data-download-file="' + App.esc(a.file_path) + '">Attachment</button>';
      }
      if (isStudent) {
        actions += '<button type="button" class="btn btn-sm btn-primary" data-submit="' + a.id + '">' +
          (sub ? "Replace solution" : "Submit solution") + "</button>";
      }
      var status = isStudent
        ? (sub
            ? '<span class="badge badge-green">Submitted ' + App.fmtDate(sub.submitted_at) + "</span>" +
              (hasGrade ? '<span class="badge badge-violet">Grade ' + App.esc(fmtScore(sub.grade)) + "</span>" : "")
            : '<span class="badge badge-rose">Not submitted</span>')
        : "";
      var feedback = hasGrade && sub.feedback
        ? '<p class="grade-feedback"><strong>Feedback:</strong> ' + App.esc(sub.feedback) + "</p>"
        : "";
      return '<div class="row" style="flex-direction:column;align-items:stretch;gap:10px">' +
        '<div class="row">' +
          '<div class="row-main row-grow">' +
            '<span class="title">' + App.esc(a.title) + "</span>" +
            '<span class="sub">' + (a.due_date ? "Due " + App.fmtDate(a.due_date) : "No due date") + "</span>" +
          "</div>" +
          status +
          '<div class="row-actions">' + actions + "</div>" +
        "</div>" +
        (a.description ? '<p class="muted" style="font-size:.86rem">' + App.esc(a.description) + "</p>" : "") +
        feedback +
      "</div>";
    }).join("") + "</div>";

    body.querySelectorAll("[data-download-file]").forEach(function (btn) {
      btn.addEventListener("click", function () { download(App.COURSE_FILE_BUCKET, btn.dataset.downloadFile, btn); });
    });
    body.querySelectorAll("[data-submit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        pendingAssignmentId = btn.dataset.submit;
        $("solutionInput").click();
      });
    });

    return rows.length;
  }

  async function onSolutionChosen() {
    var input = $("solutionInput");
    var file = input.files[0];
    input.value = "";
    var assignmentId = pendingAssignmentId;
    pendingAssignmentId = null;
    if (!file || !assignmentId) return;
    if (file.size > 20 * 1024 * 1024) return App.toast("Solution file must be smaller than 20 MB.", "error");

    try {
      var prev = await db.from("assignment_submissions")
        .select("file_path").eq("assignment_id", assignmentId).eq("student_id", profile.id).maybeSingle();
      if (prev.data && prev.data.file_path) {
        await db.storage.from(App.SUBMISSION_BUCKET).remove([prev.data.file_path]);
      }

      var path = assignmentId + "/" + profile.id + "/" + Date.now() + "-" + sanitizeName(file.name);
      var up = await db.storage.from(App.SUBMISSION_BUCKET).upload(path, file, { cacheControl: "3600" });
      if (up.error) throw new Error("Upload failed: " + up.error.message);

      var save = await db.from("assignment_submissions").upsert({
        assignment_id: assignmentId,
        student_id: profile.id,
        file_path: path,
        submitted_at: new Date().toISOString()
      }, { onConflict: "assignment_id,student_id" });
      if (save.error) throw new Error("Could not save your submission: " + save.error.message);

      App.toast("Solution submitted.", "success");
      await loadAssignments();
    } catch (err) {
      App.toast(err.message, "error");
    }
  }

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

  /* ======================= Boot ======================= */
  async function init() {
    var auth = await App.requireAuth();
    if (!auth) return;
    profile = auth.profile;
    App.renderTopbar(profile);

    var res = await db.from("profiles")
      .select("*, courses:course_id(id, name, description, location, course_dates)")
      .eq("id", profile.id)
      .maybeSingle();

    if (res.error) App.toast(res.error.message, "error");
    var row = res.data || profile;
    course = row.courses || null;
    isStudent = row.role === "student";
    renderHero(row, course);

    $("solutionInput").addEventListener("change", onSolutionChosen);

    await loadFiles();
    await loadAssignments();

    var notes = [];
    if (course) {
      var ann = await db.from("announcements")
        .select("title, body, created_at")
        .eq("course_id", course.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (ann.error) App.toast(ann.error.message, "error");
      (ann.data || []).forEach(function (a) {
        notes.push({ title: a.title, text: a.body || App.fmtDate(a.created_at), icon: ICON_ANNOUNCE });
      });
      notes.push({ title: course.name, text: App.datesLabel(course.course_dates, 3) });
    } else {
      notes.push({ title: "No course", text: "Ask an administrator to add you to a course." });
    }
    App.setNotifications(notes);
  }

  init();
})();
