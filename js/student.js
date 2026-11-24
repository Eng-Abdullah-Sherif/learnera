/* ============================================================================
   LearnEra - student dashboard
   Shows the signed-in user's profile, course, attendance, completion and
   certificate. All reads are limited by Row Level Security to the own row.
   ========================================================================== */
(function () {
  "use strict";

  var db = App.db;
  var $ = function (id) { return document.getElementById(id); };

  function emptyBlock(text) { return '<div class="empty">' + App.esc(text) + "</div>"; }

  function renderHero(profile, course) {
    var name = profile.full_name || profile.email || "Member";
    var tags = "";
    if (course) {
      tags += '<span class="badge badge-violet">' + App.esc(course.name) + "</span>";
      tags += '<span class="badge ' + (course.location === "online" ? "badge-cyan" : "badge-indigo") + '">' +
        (course.location === "online" ? "Online" : "Offline") + "</span>";
      tags += '<span class="badge badge-muted">' + App.esc(App.daysLabel(course.course_days)) + "</span>";
    } else {
      tags += '<span class="badge badge-muted">No course assigned</span>';
    }

    $("hero").innerHTML =
      App.avatarMarkup(profile.avatar_url, name, "avatar-xl") +
      "<div>" +
        "<h1>" + App.esc(name) + "</h1>" +
        '<p class="sub">' + App.esc(App.roleLabel(profile.role)) + " · " + App.esc(profile.email || "") + "</p>" +
        '<div class="tags">' + tags + "</div>" +
      "</div>";
  }

  function renderStats(present, absent, total) {
    var completion = total ? Math.round((present / total) * 100) : 0;
    $("stats").innerHTML =
      '<div class="stat stat-green"><span class="stat-label">Attendance days</span>' +
        '<span class="stat-value">' + present + "</span></div>" +
      '<div class="stat stat-rose"><span class="stat-label">Absence days</span>' +
        '<span class="stat-value">' + absent + "</span></div>" +
      '<div class="stat stat-violet"><span class="stat-label">Completion</span>' +
        '<span class="stat-value">' + completion + "<small>%</small></span></div>";
    $("progressBar").style.width = completion + "%";
    $("progressLabel").textContent = completion + "%";
    return completion;
  }

  function renderAttendance(rows) {
    var body = $("attendanceBody");
    var present = rows.filter(function (r) { return r.status === "present"; });
    var absent = rows.filter(function (r) { return r.status === "absent"; });

    if (!rows.length) {
      body.innerHTML = emptyBlock("No attendance has been recorded yet.");
      return;
    }

    function dateList(title, list, badgeClass) {
      return '<div><span class="stat-label">' + title + " (" + list.length + ")</span>" +
        '<div class="list" style="margin-top:10px">' +
        (list.length
          ? list.map(function (r) {
              return '<div class="row" style="padding:9px 13px">' +
                '<div class="row-main row-grow"><span class="title">' + App.fmtDate(r.session_date) + "</span></div>" +
                '<span class="badge ' + badgeClass + '">' + (badgeClass === "badge-green" ? "Present" : "Absent") + "</span>" +
                "</div>";
            }).join("")
          : '<p class="muted">None.</p>') +
        "</div></div>";
    }

    body.innerHTML = '<div class="grid grid-2">' +
      dateList("Present", present, "badge-green") +
      dateList("Absent", absent, "badge-rose") +
      "</div>";
  }

  function renderCertificate(cert) {
    var body = $("certBody");
    if (!cert) {
      body.innerHTML = emptyBlock("No certificate has been issued yet.");
      return;
    }
    body.innerHTML =
      '<div class="row" style="flex-direction:column;align-items:flex-start;gap:14px">' +
        "<div>" +
          '<span class="title" style="font-weight:600">Certificate file</span>' +
          '<p class="muted" style="font-size:.85rem;margin-top:4px">Issued on ' + App.fmtDate(cert.issued_at) + "</p>" +
        "</div>" +
        '<button type="button" class="btn btn-primary" id="downloadCertBtn">Download certificate</button>' +
      "</div>";

    $("downloadCertBtn").addEventListener("click", async function () {
      var btn = this;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Preparing…';
      var res = await db.storage.from(App.CERTIFICATE_BUCKET).createSignedUrl(cert.file_path, 300);
      btn.disabled = false;
      btn.textContent = "Download certificate";
      if (res.error) return App.toast("Could not open the certificate: " + res.error.message, "error");
      window.open(res.data.signedUrl, "_blank", "noopener");
    });
  }

  async function init() {
    var auth = await App.requireAuth("student");
    if (!auth) return;
    var profile = auth.profile;

    App.renderTopbar(profile);

    var res = await db.from("profiles")
      .select("*, courses:course_id(name, description, location, course_days)")
      .eq("id", profile.id)
      .maybeSingle();

    if (res.error) App.toast(res.error.message, "error");
    var row = res.data || profile;
    var course = row.courses || null;
    renderHero(row, course);

    if (row.role !== "student") {
      $("stats").innerHTML = emptyBlock("Attendance and certificates are only tracked for student accounts.");
      $("progressCard").hidden = true;
      $("attendanceCard").hidden = true;
      $("certCard").hidden = true;
      App.setNotifications([
        { title: "Signed in as " + App.roleLabel(row.role), text: course ? "Course: " + course.name : "No course assigned." }
      ]);
      return;
    }

    var attendance = await db.from("attendance")
      .select("session_date, status")
      .eq("student_id", profile.id)
      .order("session_date", { ascending: false });

    if (attendance.error) App.toast(attendance.error.message, "error");
    var rows = attendance.data || [];
    var present = rows.filter(function (r) { return r.status === "present"; }).length;
    var absent = rows.filter(function (r) { return r.status === "absent"; }).length;
    var completion = renderStats(present, absent, rows.length);
    renderAttendance(rows);

    var certRes = await db.from("certificates")
      .select("id, file_path, issued_at")
      .eq("student_id", profile.id)
      .order("issued_at", { ascending: false })
      .limit(1);
    if (certRes.error) App.toast(certRes.error.message, "error");
    var cert = (certRes.data && certRes.data[0]) || null;
    renderCertificate(cert);

    var notes = [];
    if (cert) notes.push({ title: "Certificate available", text: "Your certificate is ready to download." });
    if (course) {
      var today = App.WEEKDAYS[new Date().getDay()];
      if ((course.course_days || []).indexOf(today) !== -1) {
        notes.push({ title: "Class today", text: course.name + " · " + today });
      }
    }
    notes.push({
      title: "Completion " + completion + "%",
      text: present + " present, " + absent + " absent."
    });
    App.setNotifications(notes);
  }

  init();
})();
