// =========================
// BACKEND (SAFE GLOBAL REUSE)
// =========================
const SOCKET_BACKEND_URL = window.BACKEND_URL || "http://localhost:5000";

// =========================
// SOCKET STATE
// =========================
let socket = null;

// =========================
// TOKEN
// =========================
function getToken() {
  return localStorage.getItem("auth_token");
}

// =========================
// INIT SOCKET
// =========================
function initSocket() {
  const token = getToken();

  if (!token) {
    console.warn("Socket disabled: no auth token");
    return;
  }

  // prevent duplicate connections
  if (socket && socket.connected) {
    return;
  }

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  socket = io(SOCKET_BACKEND_URL, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 5,
    auth: { token },
  });

  // =========================
  // CONNECTION EVENTS
  // =========================
  socket.on("connect", () => {
    console.log("✅ Socket connected");
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected");
  });

  socket.on("connect_error", (err) => {
    console.error("Socket error:", err.message);

    localStorage.removeItem("auth_token");
    localStorage.removeItem("user_role");

    if (typeof showLogin === "function") {
      showLogin();
    } else {
      window.location.href = "login.html";
    }
  });

  // =========================
  // REALTIME EVENTS
  // =========================
  socket.on("new_activity", (data) => {
    console.log("📜 Activity:", data);
    if (typeof addActivity === "function") addActivity(data);
  });

  socket.on("user_activity", (data) => {
    console.log("👤 User Activity:", data);
    if (typeof addActivity === "function") addActivity(data);
  });

  socket.on("security_event", (data) => {
    console.log("⚠️ Security Event:", data);

    if (data?.type === "critical") {
      alert("CRITICAL SECURITY EVENT: " + data.message);
    }
  });
}

// =========================
// SAFE INIT
// =========================
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(initSocket, 100);
});
