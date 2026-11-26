/* ============================================================================
   LearnEra - shared application layer
   - creates the two Supabase clients
   - authentication guard
   - shared UI chrome (animated background + top bar)
   - small helpers used by every page
   ========================================================================== */
(function () {
  "use strict";

  var cfg = window.LEARNERA_CONFIG || {};
  var sdk = window.supabase;

  var CONFIG_READY =
    !!sdk &&
    typeof cfg.SUPABASE_URL === "string" &&
    cfg.SUPABASE_URL.indexOf("YOUR-PROJECT") === -1 &&
    typeof cfg.SUPABASE_ANON_KEY === "string" &&
    cfg.SUPABASE_ANON_KEY.indexOf("PASTE_YOUR") === -1;

  var AVATAR_BUCKET = cfg.AVATAR_BUCKET || "avatars";
  var CERTIFICATE_BUCKET = cfg.CERTIFICATE_BUCKET || "certificates";
  var COURSE_FILE_BUCKET = cfg.COURSE_FILE_BUCKET || "course-files";
  var SUBMISSION_BUCKET = cfg.SUBMISSION_BUCKET || "submissions";

  var currentProfile = null;   /* signed-in profile, kept for the Settings dialog */
  var menusBound = false;

  /* --- Clients ------------------------------------------------------------ */
  var db = null;
  /* Secondary client used ONLY to create accounts. persistSession:false keeps
     the admin's own session untouched (the admin stays logged in). */
  var adminAuth = null;

  if (CONFIG_READY) {
    db = sdk.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    adminAuth = sdk.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "learnera-account-setup"
      }
    });
  }

  /* --- Constants ---------------------------------------------------------- */
  var ROLES = ["student", "coordinator", "instructor"];
  var ROLE_LABELS = {
    admin: "Administrator",
    student: "Student",
    coordinator: "Coordinator",
    instructor: "Instructor"
  };

  /* --- Helpers ------------------------------------------------------------ */
  function esc(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function initials(text) {
    var parts = String(text || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || "Member";
  }

  function fmtDate(value) {
    if (!value) return "-";
    var d = new Date(value);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function dateLabel(value) {
    if (!value) return "";
    var d = new Date(String(value) + "T00:00:00");
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  }

  function datesLabel(dates, max) {
    if (!dates || !dates.length) return "No dates set";
    var sorted = dates.slice().sort();
    if (max && sorted.length > max) {
      return sorted.slice(0, max).map(dateLabel).join(", ") + " +" + (sorted.length - max) + " more";
    }
    return sorted.map(dateLabel).join(", ");
  }

  function todayISO() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function avatarMarkup(url, name, sizeClass, position) {
    var cls = "avatar " + (sizeClass || "avatar-md");
    var style = position ? ' style="object-position:' + esc(position) + '"' : "";
    if (url) {
      return '<img class="' + cls + '" src="' + esc(url) + '" alt="' + esc(name || "Profile picture") + '"' + style + ">";
    }
    return '<span class="' + cls + " avatar-fallback\">" + esc(initials(name)) + "</span>";
  }

  /* --- Draggable avatar frame --------------------------------------------- */
  /* Turns a round <img> into a picture the user repositions by dragging it,
     instead of two sliders. The visible object-position is read back as
     "X% Y%" so it can be stored in profiles.avatar_position. */
  function draggableAvatar(img) {
    var pos = { x: 50, y: 50 };
    var dragging = false;
    var startX = 0, startY = 0, originX = 50, originY = 50;

    function clamp(v) { return Math.max(0, Math.min(100, v)); }
    function apply() { img.style.objectPosition = pos.x + "% " + pos.y + "%"; }

    function onDown(e) {
      if (!img.getAttribute("src")) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      originX = pos.x; originY = pos.y;
      img.classList.add("is-dragging");
      if (img.setPointerCapture) { try { img.setPointerCapture(e.pointerId); } catch (_) {} }
    }
    function onMove(e) {
      if (!dragging) return;
      e.preventDefault();
      var rect = img.getBoundingClientRect();
      if (rect.width) pos.x = clamp(originX - ((e.clientX - startX) / rect.width) * 100);
      if (rect.height) pos.y = clamp(originY - ((e.clientY - startY) / rect.height) * 100);
      apply();
    }
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      img.classList.remove("is-dragging");
      if (img.releasePointerCapture && e.pointerId != null) {
        try { img.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    }

    img.addEventListener("pointerdown", onDown);
    img.addEventListener("pointermove", onMove);
    img.addEventListener("pointerup", onUp);
    img.addEventListener("pointercancel", onUp);

    return {
      get: function () { return pos.x.toFixed(1) + "% " + pos.y.toFixed(1) + "%"; },
      set: function (value) {
        var parts = String(value || "50% 50%").trim().split(/\s+/);
        var x = parseFloat(parts[0]);
        var y = parseFloat(parts[1]);
        pos.x = isNaN(x) ? 50 : clamp(x);
        pos.y = isNaN(y) ? 50 : clamp(y);
        apply();
      },
      setImage: function (src) { img.src = src || ""; apply(); }
    };
  }

  function homeFor(role) {
    if (role === "admin") return "admin.html";
    if (role === "instructor") return "instructor.html";
    if (role === "coordinator") return "coordinator.html";
    return "student.html";
  }

  function currentPage() {
    var name = location.pathname.split("/").pop();
    return name || "index.html";
  }

  /* --- Toast -------------------------------------------------------------- */
  function toast(message, kind) {
    var host = document.getElementById("toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      host.className = "toast-host";
      document.body.appendChild(host);
    }
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " toast-" + kind : "");
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("show"); });
    setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.remove(); }, 250);
    }, kind === "error" ? 5200 : 3200);
  }

  /* --- Modals ------------------------------------------------------------- */
  function openModal(id) {
    var m = document.getElementById(id);
    if (!m) return;
    m.classList.add("open");
    m.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    var first = m.querySelector("input,select,textarea,button");
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  function closeModal(id) {
    var m = document.getElementById(id);
    if (!m) return;
    m.classList.remove("open");
    m.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".modal.open")) document.body.classList.remove("modal-open");
  }

  function bindModalDismiss() {
    document.addEventListener("click", function (e) {
      var closer = e.target.closest("[data-close]");
      if (closer) {
        var modal = closer.closest(".modal");
        if (modal) closeModal(modal.id);
        return;
      }
      if (e.target.classList && e.target.classList.contains("modal")) {
        closeModal(e.target.id);
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var open = document.querySelector(".modal.open");
      if (open) closeModal(open.id);
    });
  }

  /* --- Background chrome -------------------------------------------------- */
  function mountBackground() {
    if (document.getElementById("app-bg")) return;
    var bg = document.createElement("div");
    bg.id = "app-bg";
    bg.className = "app-bg";
    bg.setAttribute("aria-hidden", "true");
    bg.innerHTML =
      '<div class="parallax" data-depth="1.4"><span class="orb orb-violet"></span></div>' +
      '<div class="parallax" data-depth="2.2"><span class="orb orb-indigo"></span></div>' +
      '<div class="parallax" data-depth="0.8"><span class="orb orb-cyan"></span></div>' +
      '<div class="stars" id="star-field"></div>';
    document.body.insertBefore(bg, document.body.firstChild);

    var field = bg.querySelector("#star-field");
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var total = reduced ? 24 : 60;
    var html = "";
    for (var i = 0; i < total; i++) {
      var top = (Math.random() * 100).toFixed(2);
      var left = (Math.random() * 100).toFixed(2);
      var size = (Math.random() * 2 + 1).toFixed(2);
      var delay = (Math.random() * 6).toFixed(2);
      html += '<span class="star" style="top:' + top + "%;left:" + left + "%;width:" + size +
        "px;height:" + size + "px;animation-delay:" + delay + 's"></span>';
    }
    field.innerHTML = html;

    if (reduced) return;
    var layers = Array.prototype.slice.call(bg.querySelectorAll(".parallax"));
    window.addEventListener("mousemove", function (e) {
      var x = (e.clientX / window.innerWidth - 0.5) * 2;
      var y = (e.clientY / window.innerHeight - 0.5) * 2;
      layers.forEach(function (layer) {
        var depth = parseFloat(layer.getAttribute("data-depth")) || 1;
        layer.style.setProperty("--tx", (x * 18 * depth).toFixed(1) + "px");
        layer.style.setProperty("--ty", (y * 18 * depth).toFixed(1) + "px");
      });
    });
  }

  /* --- Top bar ------------------------------------------------------------ */
  var ICON_BELL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  var ICON_CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  var ICON_GRID = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
  var ICON_OUT = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>';
  var ICON_CERT = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M8.2 12.3 7 22l5-3 5 3-1.2-9.7"/></svg>';
  var ICON_SETTINGS = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>';
  var LOGO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.4 2.7 3 6 3s6-1.6 6-3v-5"/></svg>';

  function closeMenus() {
    document.querySelectorAll(".menu.open").forEach(function (m) {
      m.classList.remove("open");
      var btn = m.parentElement.querySelector("[aria-expanded]");
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }

  function toggleMenu(menu, btn) {
    var isOpen = menu.classList.contains("open");
    closeMenus();
    if (!isOpen) {
      menu.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
    }
  }

  function renderTopbar(profile) {
    var host = document.getElementById("app-topbar");
    if (!host || !profile) return;
    currentProfile = profile;
    var name = profile.full_name || profile.email || "Member";
    var home = homeFor(profile.role);
    var homeLabel = profile.role === "admin" ? "Admin dashboard"
      : profile.role === "instructor" ? "Instructor dashboard"
      : profile.role === "coordinator" ? "Coordinator dashboard" : "My dashboard";

    host.innerHTML =
      '<header class="topbar"><div class="topbar-inner">' +
        '<div class="topbar-left">' +
          '<div class="menu-anchor">' +
            '<button type="button" class="profile-btn" id="profileBtn" aria-haspopup="true" aria-expanded="false">' +
              avatarMarkup(profile.avatar_url, name, "avatar-md", profile.avatar_position) +
              '<span class="who"><span class="who-name">' + esc(name) + "</span>" +
              '<span class="who-role">' + esc(roleLabel(profile.role)) + "</span></span>" +
              '<span class="chev">' + ICON_CHEVRON + "</span>" +
            "</button>" +
            '<div class="menu" id="profileMenu">' +
              '<a class="menu-item" href="' + home + '">' + ICON_GRID +
                "<span>" + homeLabel + "</span></a>" +
              (profile.role === "student"
                ? '<a class="menu-item" href="certificates.html">' + ICON_CERT + "<span>My certificates</span></a>"
                : "") +
              '<button type="button" class="menu-item" id="settingsBtn">' + ICON_SETTINGS +
                "<span>Settings</span></button>" +
              '<button type="button" class="menu-item menu-item-danger" id="logoutBtn">' + ICON_OUT +
                "<span>Sign out</span></button>" +
            "</div>" +
          "</div>" +
          '<div class="menu-anchor">' +
            '<button type="button" class="icon-btn" id="notifBtn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">' +
              ICON_BELL + '<span class="notif-dot" id="notifDot" hidden></span>' +
            "</button>" +
            '<div class="menu menu-wide" id="notifMenu">' +
              '<div class="menu-head">Notifications</div>' +
              '<div class="notif-list" id="notifList"><p class="notif-empty">You are all caught up.</p></div>' +
            "</div>" +
          "</div>" +
        "</div>" +
        '<a class="topbar-brand" href="' + home + '">' +
          '<span class="brand-mark">' + LOGO + "</span>" +
          '<span class="brand-name">LearnEra</span>' +
        "</a>" +
      "</div></header>";

    var profileBtn = host.querySelector("#profileBtn");
    var profileMenu = host.querySelector("#profileMenu");
    var notifBtn = host.querySelector("#notifBtn");
    var notifMenu = host.querySelector("#notifMenu");

    profileBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleMenu(profileMenu, profileBtn);
    });
    notifBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleMenu(notifMenu, notifBtn);
    });
    if (!menusBound) {
      document.addEventListener("click", closeMenus);
      menusBound = true;
    }

    host.querySelector("#settingsBtn").addEventListener("click", function () {
      closeMenus();
      openSettings();
    });

    host.querySelector("#logoutBtn").addEventListener("click", function () {
      db.auth.signOut().then(function () { location.replace("index.html"); });
    });
  }

  /* --- Settings dialog (password + picture) ------------------------------- */
  function sanitizeFilename(name) {
    return String(name).replace(/[^a-zA-Z0-9._-]/g, "-").slice(-60) || "avatar";
  }

  var settingsDragger = null;

  function setSettingsMessage(error, success) {
    var e = document.getElementById("setError");
    var s = document.getElementById("setSuccess");
    if (e) { e.hidden = !error; e.textContent = error || ""; }
    if (s) { s.hidden = !success; s.textContent = success || ""; }
  }

  function mountSettingsModal() {
    if (document.getElementById("settingsModal")) return;
    var el = document.createElement("div");
    el.className = "modal";
    el.id = "settingsModal";
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "settingsTitle");
    el.innerHTML =
      '<div class="modal-card modal-lg">' +
        '<div class="modal-head">' +
          '<h2 id="settingsTitle">Settings</h2>' +
          '<button type="button" class="icon-btn" data-close="settingsModal" aria-label="Close">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
          "</button>" +
        "</div>" +
        '<div class="modal-body">' +
          '<p class="form-error" id="setError" hidden></p>' +
          '<p class="form-success" id="setSuccess" hidden></p>' +
          '<h3 class="settings-sub">Profile picture</h3>' +
          '<div class="field">' +
            '<div class="pos-control">' +
              '<img class="avatar-preview avatar-preview-lg avatar-drag" id="setPreview" alt="">' +
              '<span class="hint">Choose a picture, then drag it inside the circle to frame it.</span>' +
            "</div>" +
            '<input type="file" id="setAvatarFile" accept="image/png,image/jpeg,image/webp,image/gif">' +
            '<span class="hint">PNG or JPG, up to 3 MB. Leave empty to keep the current picture.</span>' +
          "</div>" +
          '<button type="button" class="btn btn-primary" id="setPictureBtn">Save picture</button>' +
          '<h3 class="settings-sub">Password</h3>' +
          '<div class="field-row">' +
            '<div class="field"><label for="setPass1">New password</label>' +
              '<input class="input" type="password" id="setPass1" minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></div>' +
            '<div class="field"><label for="setPass2">Confirm password</label>' +
              '<input class="input" type="password" id="setPass2" minlength="6" autocomplete="new-password" placeholder="Repeat it"></div>' +
          "</div>" +
          '<button type="button" class="btn btn-primary" id="setPassBtn">Change password</button>' +
        "</div>" +
        '<div class="modal-foot"><button type="button" class="btn" data-close="settingsModal">Close</button></div>' +
      "</div>";
    document.body.appendChild(el);

    var $s = function (id) { return document.getElementById(id); };
    settingsDragger = draggableAvatar($s("setPreview"));
    $s("setAvatarFile").addEventListener("change", function () {
      var file = this.files[0];
      if (!file) {
        settingsDragger.setImage(currentProfile ? currentProfile.avatar_url || "" : "");
        return;
      }
      settingsDragger.setImage(URL.createObjectURL(file));
    });
    $s("setPictureBtn").addEventListener("click", savePicture);
    $s("setPassBtn").addEventListener("click", savePassword);
  }

  function openSettings() {
    mountSettingsModal();
    if (!currentProfile) return;
    setSettingsMessage("", "");
    document.getElementById("setPass1").value = "";
    document.getElementById("setPass2").value = "";
    document.getElementById("setAvatarFile").value = "";

    settingsDragger.setImage(currentProfile.avatar_url || "");
    settingsDragger.set(currentProfile.avatar_position);
    openModal("settingsModal");
  }

  function savePicture() {
    if (!currentProfile) return;
    var file = document.getElementById("setAvatarFile").files[0];
    var position = settingsDragger.get();
    var btn = document.getElementById("setPictureBtn");
    setSettingsMessage("", "");
    if (file && file.size > 3 * 1024 * 1024) return setSettingsMessage("Profile picture must be smaller than 3 MB.", "");

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    var uploaded = null;
    var upload = Promise.resolve(null);
    if (file) {
      var path = currentProfile.id + "/" + Date.now() + "-" + sanitizeFilename(file.name);
      upload = db.storage.from(AVATAR_BUCKET).upload(path, file, { cacheControl: "3600" }).then(function (up) {
        if (up.error) throw new Error("Picture upload failed: " + up.error.message);
        return db.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
      });
    }

    upload
      .then(function (url) {
        uploaded = url;
        return db.rpc("update_my_avatar", { new_avatar_url: url || "", new_avatar_position: position });
      })
      .then(function (res) {
        if (res && res.error) throw new Error(res.error.message);
        if (uploaded) currentProfile.avatar_url = uploaded;
        currentProfile.avatar_position = position;
        renderTopbar(currentProfile);
        setSettingsMessage("", "Picture updated.");
      })
      .catch(function (err) { setSettingsMessage(err.message, ""); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Save picture";
      });
  }

  function savePassword() {
    var p1 = document.getElementById("setPass1").value;
    var p2 = document.getElementById("setPass2").value;
    var btn = document.getElementById("setPassBtn");
    setSettingsMessage("", "");
    if (p1.length < 6) return setSettingsMessage("Password must be at least 6 characters long.", "");
    if (p1 !== p2) return setSettingsMessage("The two passwords do not match.", "");

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    db.auth.updateUser({ password: p1 })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        document.getElementById("setPass1").value = "";
        document.getElementById("setPass2").value = "";
        setSettingsMessage("", "Password changed.");
      })
      .catch(function (err) { setSettingsMessage(err.message, ""); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Change password";
      });
  }

  function setNotifications(items) {
    var list = document.getElementById("notifList");
    var dot = document.getElementById("notifDot");
    if (!list) return;
    if (!items || !items.length) {
      list.innerHTML = '<p class="notif-empty">You are all caught up.</p>';
      if (dot) dot.hidden = true;
      return;
    }
    list.innerHTML = items.map(function (item) {
      return '<div class="notif-item">' +
        '<span class="notif-icon">' + (item.icon || ICON_BELL) + "</span>" +
        '<span class="notif-body"><strong>' + esc(item.title) + "</strong>" +
        "<span>" + esc(item.text) + "</span></span></div>";
    }).join("");
    if (dot) dot.hidden = false;
  }

  /* --- Config warning ----------------------------------------------------- */
  function configWarning(host) {
    var box = document.createElement("div");
    box.className = "notice notice-warn";
    box.innerHTML = "<strong>Supabase is not configured.</strong> Open <code>js/config.js</code> and set " +
      "<code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code>, then run the SQL in " +
      "<code>supabase/schema.sql</code>. Setup steps are in <code>README.md</code>.";
    (host || document.body).appendChild(box);
  }

  /* --- Auth guard --------------------------------------------------------- */
  /* Returns { session, user, profile } or null (after redirecting). */
  function requireAuth(requiredRole) {
    if (!CONFIG_READY) {
      configWarning(document.body);
      return Promise.resolve(null);
    }
    return db.auth.getSession().then(function (res) {
      var session = res.data ? res.data.session : null;
      if (!session) {
        location.replace("index.html");
        return null;
      }
      return db.from("profiles").select("*").eq("id", session.user.id).maybeSingle().then(function (q) {
        var profile = q.data;
        if (q.error || !profile) {
          toast("Your account has no profile record. Ask an administrator to fix it.", "error");
          return db.auth.signOut().then(function () {
            location.replace("index.html");
            return null;
          });
        }
        var home = homeFor(profile.role);
        var here = currentPage();
        if (requiredRole && profile.role !== requiredRole && home !== here) {
          location.replace(home);
          return null;
        }
        return { session: session, user: session.user, profile: profile };
      });
    });
  }

  /* --- Public API --------------------------------------------------------- */
  window.App = {
    configReady: CONFIG_READY,
    db: db,
    adminAuth: adminAuth,
    AVATAR_BUCKET: AVATAR_BUCKET,
    CERTIFICATE_BUCKET: CERTIFICATE_BUCKET,
    COURSE_FILE_BUCKET: COURSE_FILE_BUCKET,
    SUBMISSION_BUCKET: SUBMISSION_BUCKET,
    ROLES: ROLES,
    esc: esc,
    initials: initials,
    roleLabel: roleLabel,
    fmtDate: fmtDate,
    dateLabel: dateLabel,
    datesLabel: datesLabel,
    todayISO: todayISO,
    avatarMarkup: avatarMarkup,
    draggableAvatar: draggableAvatar,
    homeFor: homeFor,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    mountBackground: mountBackground,
    renderTopbar: renderTopbar,
    setNotifications: setNotifications,
    openSettings: openSettings,
    requireAuth: requireAuth,
    configWarning: configWarning
  };

  mountBackground();
  bindModalDismiss();
})();
