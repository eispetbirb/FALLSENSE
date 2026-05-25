const CAREGIVER_BACKEND_URL = window.BACKEND_URL || "http://localhost:5000";
const CAREGIVER_SESSION_PREFIX = "caregiverSession:";

function readSessionSnapshot() {
  if (
    typeof window.name !== "string" ||
    !window.name.startsWith(CAREGIVER_SESSION_PREFIX)
  ) {
    return null;
  }

  try {
    return JSON.parse(
      decodeURIComponent(window.name.slice(CAREGIVER_SESSION_PREFIX.length)),
    );
  } catch (error) {
    console.warn("Unable to restore caregiver session snapshot", error);
    return null;
  }
}

function writeSessionSnapshot() {
  const snapshot = {
    auth_token: localStorage.getItem("auth_token"),
    user_role: localStorage.getItem("user_role"),
  };

  if (!snapshot.auth_token || !snapshot.user_role) {
    return;
  }

  window.name = `${CAREGIVER_SESSION_PREFIX}${encodeURIComponent(JSON.stringify(snapshot))}`;
}

function clearSessionSnapshot() {
  if (
    typeof window.name === "string" &&
    window.name.startsWith(CAREGIVER_SESSION_PREFIX)
  ) {
    window.name = "";
  }
}

function hydrateSessionFromSnapshot() {
  const snapshot = readSessionSnapshot();
  if (!snapshot?.auth_token || !snapshot?.user_role) {
    return false;
  }

  localStorage.setItem("auth_token", snapshot.auth_token);
  localStorage.setItem("user_role", snapshot.user_role);
  return true;
}

function getAuthToken() {
  const token = localStorage.getItem("auth_token");
  if (token) {
    return token;
  }

  hydrateSessionFromSnapshot();
  return localStorage.getItem("auth_token");
}

function getUserRole() {
  const role = localStorage.getItem("user_role");
  if (role) {
    return role;
  }

  hydrateSessionFromSnapshot();
  return localStorage.getItem("user_role");
}

function logout() {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("user_role");
  clearSessionSnapshot();
  window.location.href = "login.html";
}

function requireCaregiverSession() {
  const token = getAuthToken();
  const role = getUserRole();

  if (!token || role !== "caregiver") {
    logout();
    return false;
  }

  return true;
}

function buildHeaders(extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${CAREGIVER_BACKEND_URL}${path}`, {
    ...options,
    headers: buildHeaders(options.headers || {}),
  });

  if (response.status === 401 || response.status === 422) {
    console.warn(
      `Auth request failed for ${path} with status ${response.status}`,
    );
    return null;
  }

  return response;
}

async function apiJson(path, options = {}) {
  const response = await apiFetch(path, options);
  if (!response) return null;

  if (response.status === 204) {
    return {};
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return response;
  }

  const payload = await response.json();
  return response.ok ? payload : Promise.reject(payload);
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function severityBadgeClass(severity) {
  const normalized = String(severity || "medium").toLowerCase();
  if (normalized === "critical") return "bg-danger";
  if (normalized === "high") return "bg-warning text-dark";
  if (normalized === "medium") return "bg-info text-dark";
  return "bg-secondary";
}

function statusBadgeClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (
    ["resolved", "taken", "normal", "active", "online"].includes(normalized)
  ) {
    return "bg-success";
  }
  if (["acknowledged", "pending", "warning"].includes(normalized)) {
    return "bg-warning text-dark";
  }
  if (["critical", "missed", "offline", "down", "error"].includes(normalized)) {
    return "bg-danger";
  }
  return "bg-secondary";
}

function ensureToastContainer() {
  let container = document.getElementById("toastContainer");

  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    document.body.appendChild(container);
  }

  return container;
}

const TOAST_VARIANT_MAP = {
  error: "danger",
  danger: "danger",
  success: "success",
  warning: "warning",
  info: "info",
};

function showToast(message, variant = "info") {
  const container = ensureToastContainer();
  const toastElement = document.createElement("div");
  const mappedVariant = TOAST_VARIANT_MAP[variant] || variant || "info";
  toastElement.className = `dashboard-toast ${mappedVariant}`;
  toastElement.setAttribute("role", "alert");
  toastElement.setAttribute("aria-live", "assertive");
  toastElement.setAttribute("aria-atomic", "true");
  toastElement.textContent = message;
  container.appendChild(toastElement);

  window.setTimeout(() => toastElement.remove(), 3200);
}

function setLoadingState(element, isLoading, label = "Loading...") {
  if (!element) return;
  element.disabled = isLoading;
  if (!element.dataset.originalLabel) {
    element.dataset.originalLabel = element.textContent.trim();
  }
  element.textContent = isLoading ? label : element.dataset.originalLabel;
}

function bindLogoutButtons() {
  document.querySelectorAll("[data-action='logout']").forEach((button) => {
    button.addEventListener("click", logout);
  });
}

window.CaregiverAPI = {
  apiFetch,
  apiJson,
  formatDateTime,
  severityBadgeClass,
  statusBadgeClass,
  showToast,
  setLoadingState,
  requireCaregiverSession,
  logout,
  bindLogoutButtons,
  persistSession: writeSessionSnapshot,
  restoreSession: hydrateSessionFromSnapshot,
};
