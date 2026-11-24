/* ============================================================================
   LearnEra - login page
   ========================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("loginForm");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var errorBox = document.getElementById("loginError");
  var submitBtn = document.getElementById("submitBtn");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  /* Load the profile of the signed-in user and send them to their home page. */
  function routeUser() {
    return App.db.auth.getSession().then(function (res) {
      var session = res.data ? res.data.session : null;
      if (!session) return false;
      return App.db.from("profiles").select("role").eq("id", session.user.id).maybeSingle().then(function (q) {
        if (q.error || !q.data) return false;
        location.replace(App.homeFor(q.data.role));
        return true;
      });
    });
  }

  if (!App.configReady) {
    App.configWarning(document.querySelector(".login-shell"));
    submitBtn.disabled = true;
    return;
  }

  /* Already signed in? Skip the form. */
  routeUser();

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearError();

    var email = emailInput.value.trim();
    var password = passwordInput.value;

    if (!email || !password) {
      showError("Please enter both your email and password.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Signing in…';

    App.db.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      if (res.error) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign in";
        var msg = res.error.message || "Sign in failed.";
        if (/invalid login credentials/i.test(msg)) {
          msg = "Wrong email or password.";
        } else if (/email not confirmed/i.test(msg)) {
          msg = "This email is not confirmed yet. An administrator must confirm it in Supabase.";
        }
        showError(msg);
        return;
      }
      routeUser().then(function (routed) {
        if (!routed) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Sign in";
          showError("Signed in, but no profile was found for this account. Ask an administrator to check your account.");
        }
      });
    });
  });
})();
