/* ============================================================================
   LearnEra - my certificates
   Lists the certificate files that were issued to the signed-in user.
   Row Level Security only returns the caller's own certificate records.
   ========================================================================== */
(function () {
  "use strict";

  var db = App.db;
  var $ = function (id) { return document.getElementById(id); };
  var profile = null;

  function emptyBlock(text) { return '<div class="empty">' + App.esc(text) + "</div>"; }

  async function load() {
    var body = $("certsBody");
    var res = await db.from("certificates")
      .select("id, file_path, issued_at, courses:course_id(name)")
      .eq("student_id", profile.id)
      .order("issued_at", { ascending: false });

    if (res.error) { body.innerHTML = emptyBlock(res.error.message); return; }
    var rows = res.data || [];
    if (!rows.length) { body.innerHTML = emptyBlock("No certificate has been issued yet."); return; }

    body.innerHTML = '<div class="list">' + rows.map(function (c) {
      return '<div class="row">' +
        '<div class="row-main row-grow">' +
          '<span class="title">' + App.esc(c.courses ? c.courses.name : "Course") + "</span>" +
          '<span class="sub">Issued ' + App.fmtDate(c.issued_at) + "</span>" +
        "</div>" +
        '<div class="row-actions">' +
          '<button type="button" class="btn btn-sm" data-open-cert="' + c.id + '">Open certificate</button>' +
        "</div></div>";
    }).join("") + "</div>";
  }

  async function openCertificate(id) {
    var body = $("certsBody");
    var res = await db.from("certificates").select("file_path").eq("id", id).maybeSingle();
    if (res.error || !res.data) return App.toast("Could not find the certificate.", "error");
    var url = await db.storage.from(App.CERTIFICATE_BUCKET).createSignedUrl(res.data.file_path, 300);
    if (url.error) return App.toast("Could not open the file: " + url.error.message, "error");
    window.open(url.data.signedUrl, "_blank", "noopener");
  }

  async function init() {
    var auth = await App.requireAuth();
    if (!auth) return;
    profile = auth.profile;
    App.renderTopbar(profile);
    await load();

    $("certsBody").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-open-cert]");
      if (btn) openCertificate(btn.dataset.openCert);
    });

    App.setNotifications([
      { title: "My certificates", text: "Open this page any time from the profile menu." }
    ]);
  }

  init();
})();
