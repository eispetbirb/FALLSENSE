const LOGIN_BACKEND_URL = window.BACKEND_URL || "http://localhost:5000";

function setMessage(msg) {
  const el = document.getElementById("loginMessage");

  if (!msg) {
    el.classList.add("d-none");
    return;
  }

  el.textContent = msg;
  el.classList.remove("d-none");
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const res = await fetch(`${LOGIN_BACKEND_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.message || "Login failed");

    // SAVE JWT
    localStorage.setItem("auth_token", data.access_token);
    localStorage.setItem("user_role", data.role);

    // redirect to dashboard
    window.location.href = "index.html";
  } catch (err) {
    setMessage(err.message);
  }
});
