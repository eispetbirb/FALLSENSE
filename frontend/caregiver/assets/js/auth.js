function showAuthMessage(element, message, variant = "error") {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("d-none", "is-error", "is-success");
  element.classList.add(variant === "success" ? "is-success" : "is-error");
  element.hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  const api = window.CaregiverAPI;
  const loginForm = document.getElementById("caregiverLoginForm");
  const registerForm = document.getElementById("caregiverRegisterForm");
  const backendUrl = window.BACKEND_URL || "http://localhost:5000";

  const token = localStorage.getItem("auth_token");
  const role = localStorage.getItem("user_role");
  if (token && role === "caregiver" && (loginForm || registerForm)) {
    window.location.href = "index.html";
    return;
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const fullname = document.getElementById("fullname")?.value.trim();
      const email = document.getElementById("email")?.value.trim();
      const password = document.getElementById("password")?.value || "";
      const confirmPassword =
        document.getElementById("confirmPassword")?.value || "";
      const message = document.getElementById("registerMessage");
      const submitButton = registerForm.querySelector("button[type='submit']");

      if (!fullname || !email || !password) {
        showAuthMessage(message, "Please fill in all required fields.");
        return;
      }

      if (password !== confirmPassword) {
        showAuthMessage(message, "Passwords do not match.");
        return;
      }

      if (password.length < 6) {
        showAuthMessage(message, "Password must be at least 6 characters.");
        return;
      }

      try {
        api?.setLoadingState?.(submitButton, true, "Creating account...");
        const response = await fetch(`${backendUrl}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullname,
            email,
            password,
            role: "caregiver",
          }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.message || "Registration failed");
        }

        showAuthMessage(
          message,
          "Account created. Redirecting to login...",
          "success",
        );
        registerForm.reset();
        window.setTimeout(() => {
          window.location.href = "login.html";
        }, 1200);
      } catch (error) {
        showAuthMessage(message, error.message || "Registration failed");
      } finally {
        api?.setLoadingState?.(submitButton, false, "Create Account");
      }
    });
  }

  if (!loginForm) {
    api?.bindLogoutButtons?.();
    return;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email")?.value.trim();
    const password = document.getElementById("password")?.value;
    const message = document.getElementById("loginMessage");
    const submitButton = loginForm.querySelector("button[type='submit']");

    try {
      api?.setLoadingState?.(submitButton, true, "Signing in...");
      const response = await fetch(
        `${window.BACKEND_URL || "http://localhost:5000"}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
      );

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || "Login failed");
      }

      if (payload.role !== "caregiver") {
        throw new Error("Caregiver access only");
      }

      localStorage.setItem("auth_token", payload.access_token);
      localStorage.setItem("user_role", payload.role);
      api?.persistSession?.();
      window.location.href = "index.html";
    } catch (error) {
      if (message) {
        message.textContent = error.message;
        message.classList.remove("d-none");
      }
    } finally {
      api?.setLoadingState?.(submitButton, false);
    }
  });
});
