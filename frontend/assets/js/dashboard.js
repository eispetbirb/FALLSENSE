// =========================
// BACKEND CONFIG (SAFE SINGLE SOURCE)
// =========================
const DASHBOARD_BACKEND_URL = window.BACKEND_URL || "http://localhost:5000";

// =========================
// AUTH HELPERS
// =========================
function getAuthToken() {
  return localStorage.getItem("auth_token");
}

function logout() {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("user_role");
  showLogin();
}

// 🔥 STEP 2: Protect dashboard
function requireAuth() {
  const token = getAuthToken();

  if (!token) {
    showLogin();
    return false;
  }

  return true;
}

// =========================
// FETCH HELPERS
// =========================
function getFetchOptions(method = "GET") {
  const token = getAuthToken();

  const headers = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return {
    method,
    headers,
  };
}

async function safeFetch(url, options) {
  const res = await fetch(url, options);

  if (res.status === 401 || res.status === 422) {
    logout();
    return null;
  }

  return res;
}

// =========================
// UI CONTROLS
// =========================
function showDashboard() {
  document.getElementById("loginSection")?.classList.add("d-none");
  document.getElementById("dashboardSection")?.classList.remove("d-none");
}

function showLogin() {
  document.getElementById("loginSection")?.classList.remove("d-none");
  document.getElementById("dashboardSection")?.classList.add("d-none");
}

// =========================
// SAFE DOM SETTER
// =========================
function safeSet(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

let adminSummaryRefreshTimer = null;

function scheduleSummaryRefresh(delay = 250) {
  if (adminSummaryRefreshTimer) {
    clearTimeout(adminSummaryRefreshTimer);
  }

  adminSummaryRefreshTimer = window.setTimeout(() => {
    loadSummary().catch(() => {});
  }, delay);
}

// =========================
// LOGIN
// =========================
async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value;

  try {
    const res = await fetch(`${DASHBOARD_BACKEND_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.message || "Login failed");

    localStorage.setItem("auth_token", data.access_token);
    localStorage.setItem("user_role", data.role || "");
    localStorage.setItem("user_id", data.user_id || "");

    showDashboard();
    setTimeout(initApp, 50);
  } catch (err) {
    const msg = document.getElementById("loginMessage");
    if (msg) msg.textContent = err.message;
  }
}

// =========================
// DEMO ADMIN
// =========================
async function handleCreateDemoAdmin() {
  const email =
    document.getElementById("email")?.value.trim() || "admin@example.com";
  const password = document.getElementById("password")?.value || "Admin@12345";
  const fullname = email.split("@")[0];

  try {
    const registerResponse = await fetch(
      `${DASHBOARD_BACKEND_URL}/api/auth/register`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullname,
          email,
          password,
          role: "admin",
        }),
      },
    );

    if (!registerResponse.ok) {
      const registerData = await registerResponse.json();
      if (registerData.message !== "Email already exists") {
        throw new Error(registerData.message || "Unable to create demo admin");
      }
    }

    const loginRes = await fetch(`${DASHBOARD_BACKEND_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await loginRes.json();

    if (!loginRes.ok) throw new Error(data.message);

    localStorage.setItem("auth_token", data.access_token);
    localStorage.setItem("user_role", data.role || "admin");
    localStorage.setItem("user_id", data.user_id || "");

    showDashboard();
    setTimeout(initApp, 50);
  } catch (err) {
    const msg = document.getElementById("loginMessage");
    if (msg) msg.textContent = err.message;
  }
}

// =========================
// CHARTS
// =========================
let securityChart;

let activityTypeCounts = {
  login_success: 0,
  failed_login: 0,
  login_blocked_locked_account: 0,
  login_failed_user_not_found: 0,
  other: 0,
};

let activeEditingUserId = null;

const MODULE_LABELS = {
  user_management: "User management",
  security_monitoring: "Security monitoring",
  audit_reporting: "Audit reporting",
  anomaly_detection: "Anomaly detection",
};

function getActivitiesContainer() {
  return document.getElementById("activities");
}

function parseBackendTimestamp(value) {
  if (!value) return null;

  if (value instanceof Date) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  const normalized = raw.replace(" ", "T");
  const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTime(value) {
  const date = parseBackendTimestamp(value) || new Date();

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

function prependRecord(container, html) {
  if (!container) return;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  container.prepend(wrapper.firstElementChild);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const ICON_EDIT =
  '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const ICON_LOCK =
  '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';
const ICON_DELETE =
  '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';

function formatRoleLabel(role) {
  const value = String(role || "").toLowerCase();
  if (!value) return "Caregiver";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function activityFeedDot(activity) {
  const status = String(activity?.status || "success").toLowerCase();
  if (status !== "success" && status !== "processed") return "red";

  const action = String(activity?.action || "").toLowerCase();
  if (action.includes("failed") || action.includes("blocked")) return "amber";
  if (action.includes("login")) return "teal";
  return "green";
}

function syncAdminStatCards() {
  const pairs = [
    ["sc-users", "totalUsers", "total_users"],
    ["sc-alerts", "totalAlerts", "total_alerts"],
    ["sc-failed", "failedLogins", "failed_logins"],
    ["sc-locked", "lockedUsers", "locked_users"],
  ];

  pairs.forEach(([targetId, camelKey, snakeKey]) => {
    const target = document.getElementById(targetId);
    if (!target) return;

    const value =
      window.adminSummaryCache?.[camelKey] ??
      window.adminSummaryCache?.[snakeKey] ??
      0;
    target.textContent = String(value);
  });
}

function applyAdminSummary(summary = {}) {
  window.adminSummaryCache = summary;
  syncAdminStatCards();
}

function normalizeSeverity(value) {
  const severity = String(value || "medium").toLowerCase();

  if (severity in alertSeverityCounts) {
    return severity;
  }

  return "medium";
}

function normalizeActivityType(value) {
  const action = String(value || "other").toLowerCase();

  if (action in activityTypeCounts) {
    return action;
  }

  return "other";
}

function bumpCount(countMap, key) {
  countMap[key] = (countMap[key] || 0) + 1;
}

function syncDoughnutChart(chart, labels, values) {
  if (!chart) return;

  chart.data.labels = labels;
  chart.data.datasets[0].data = values;
  chart.update();
}

function refreshSecuritySummaryCards(delta = {}) {
  window.adminSummaryCache = {
    ...(window.adminSummaryCache || {}),
    ...delta,
  };

  syncAdminStatCards();
}

function renderUserTable(users = []) {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;

  tbody.innerHTML = users
    .map(
      (user) => `
      <tr>
        <td><strong>${escapeHtml(user.fullname)}</strong></td>
        <td>${escapeHtml(user.email)}</td>
        <td><span class="role-pill ${escapeHtml(user.role)}">${formatRoleLabel(user.role)}</span></td>
        <td>
          <div class="status-dot-wrap">
            <div class="status-dot ${user.is_locked ? "locked" : "active"}"></div>
            ${user.is_locked ? "Locked" : "Active"}
          </div>
        </td>
        <td style="color:var(--muted); font-size:12px;">${escapeHtml(user.last_login || "-")}</td>
        <td>
          <div class="action-btns">
            <button type="button" class="icon-btn" title="Edit" data-action="edit-user" data-user-id="${escapeHtml(user.id)}">${ICON_EDIT}</button>
            <button type="button" class="icon-btn" title="${user.is_locked ? "Unlock" : "Lock"}" data-action="toggle-lock" data-user-id="${escapeHtml(user.id)}" data-is-locked="${user.is_locked}">${ICON_LOCK}</button>
            <button type="button" class="icon-btn danger" title="Delete" data-action="delete-user" data-user-id="${escapeHtml(user.id)}">${ICON_DELETE}</button>
          </div>
        </td>
      </tr>
    `,
    )
    .join("");
}

function renderSystemConfig(config = {}) {
  const threshold = document.getElementById("failedLoginThreshold");
  const sensitivity = document.getElementById("alertSensitivity");
  const moduleToggles = document.getElementById("moduleToggles");

  if (threshold) threshold.value = config.failed_login_threshold ?? 3;
  if (sensitivity) sensitivity.value = config.alert_sensitivity || "medium";

  if (moduleToggles) {
    const enabledModules = config.enabled_modules || {};
    moduleToggles.innerHTML = Object.entries(MODULE_LABELS)
      .map(
        ([key, label]) => `
          <label class="module-toggle">
            <input type="checkbox" data-module-key="${key}" ${enabledModules[key] !== false ? "checked" : ""} />
            ${escapeHtml(label)}
          </label>
        `,
      )
      .join("");
  }
}

function renderAuditReport(report = {}) {
  const tbody = document.getElementById("auditReportBody");
  const logCount = document.getElementById("auditLogCount");
  const eventCount = document.getElementById("auditEventCount");

  if (logCount) logCount.innerText = String(report.total_logs ?? 0);
  if (eventCount)
    eventCount.innerText = String(report.total_security_events ?? 0);

  if (!tbody) return;

  const rows = [];
  for (const log of report.recent_logs || []) {
    const statusClass =
      String(log.status || "").toLowerCase() === "failed" ? "high" : "low";
    rows.push(`
      <tr>
        <td><span class="sev-pill medium">Activity</span></td>
        <td style="font-size:12px; color:var(--muted);">${escapeHtml(log.action)}</td>
        <td><span class="sev-pill ${statusClass}">${escapeHtml(log.status)}</span></td>
        <td style="font-size:12px; color:var(--muted);">-</td>
        <td style="font-size:12px; color:var(--muted);">${escapeHtml(formatTime(log.created_at))}</td>
      </tr>
    `);
  }

  for (const event of report.recent_events || []) {
    const severity = normalizeSeverity(event.severity);
    rows.push(`
      <tr>
        <td><span class="sev-pill ${severity}">${escapeHtml(event.event_type)}</span></td>
        <td style="font-size:12px; color:var(--muted);">${escapeHtml(event.event_type)}</td>
        <td><span class="sev-pill ${severity}">${escapeHtml(event.severity)}</span></td>
        <td style="font-size:12px; color:var(--amber);">${escapeHtml(event.risk_score)}</td>
        <td style="font-size:12px; color:var(--muted);">${escapeHtml(formatTime(event.created_at))}</td>
      </tr>
    `);
  }

  tbody.innerHTML =
    rows.join("") ||
    `
    <tr>
      <td colspan="5" style="text-align:center; color:var(--muted); font-size:13px;">No audit data available</td>
    </tr>
  `;
}

// =========================
// MEDICATION SCHEDULES (DB VIEW)
// =========================
function formatCompactTime(value) {
  if (!value) return "-";
  const parsed = parseBackendTimestamp(value);
  return parsed ? formatTime(parsed) : String(value);
}

function renderMedicationSchedules(items = []) {
  const tbody = document.getElementById("medicationSchedulesBody");
  if (!tbody) return;

  tbody.innerHTML =
    items
      .map((row) => {
        const status = String(row.status || "pending").toLowerCase();
        const badgeClass =
          status === "taken" ? "low" : status === "missed" ? "high" : "medium";
        const updated =
          row.updated_at || row.taken_at || row.missed_at || row.schedule_time;

        return `
          <tr>
            <td><strong>${escapeHtml(row.medicine_name || "-")}</strong></td>
            <td style="color:var(--muted); font-size:12px;">${escapeHtml(row.dosage || "-")}</td>
            <td style="font-size:12px; color:var(--muted);">${escapeHtml(row.patient_id || "-")}</td>
            <td style="font-size:12px; color:var(--muted);">${escapeHtml(row.schedule_time || "-")}</td>
            <td><span class="sev-pill ${badgeClass}">${escapeHtml(status)}</span></td>
            <td style="font-size:12px; color:var(--muted);">${escapeHtml(formatCompactTime(updated))}</td>
          </tr>
        `;
      })
      .join("") ||
    `
      <tr>
        <td colspan="6" style="text-align:center; color:var(--muted); font-size:13px;">
          No medication schedules found
        </td>
      </tr>
    `;
}

function buildMedicationSchedulesQuery() {
  const patientId = document
    .getElementById("medSchedulePatientFilter")
    ?.value?.trim();
  const status = document
    .getElementById("medScheduleStatusFilter")
    ?.value?.trim();
  const limit = Number(
    document.getElementById("medScheduleLimit")?.value || 200,
  );

  const params = new URLSearchParams();
  if (patientId) params.set("patient_id", patientId);
  if (status) params.set("status", status);
  if (Number.isFinite(limit)) params.set("limit", String(limit));
  params.set("t", String(Date.now()));
  return params.toString();
}

async function loadMedicationSchedules() {
  const tbody = document.getElementById("medicationSchedulesBody");
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; color:var(--muted); font-size:13px;">
          Loading medication schedules...
        </td>
      </tr>
    `;
  }

  const query = buildMedicationSchedulesQuery();
  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/medication-schedules?${query}`,
    getFetchOptions(),
  );
  if (!res) return;
  const data = await res.json();
  renderMedicationSchedules(Array.isArray(data) ? data : []);
}

function rebuildActivityTypeCounts(activities = []) {
  activityTypeCounts = {
    login_success: 0,
    failed_login: 0,
    login_blocked_locked_account: 0,
    login_failed_user_not_found: 0,
    other: 0,
  };

  activities.forEach((activity) => {
    bumpCount(activityTypeCounts, normalizeActivityType(activity?.action));
  });

  syncDoughnutChart(
    securityChart,
    Object.keys(activityTypeCounts),
    Object.values(activityTypeCounts),
  );
}

function appendActivityRecord(activity) {
  const container = getActivitiesContainer();
  const action = activity?.action || "activity";
  const userRef = activity?.user_id ? ` — ${activity.user_id}` : "";

  prependRecord(
    container,
    `
      <div class="feed-item">
        <div class="feed-dot ${activityFeedDot(activity)}"></div>
        <div class="feed-body">
          <div class="feed-title">${escapeHtml(action)}${escapeHtml(userRef)}</div>
          <div class="feed-time">${escapeHtml(formatTime(activity?.created_at))}</div>
        </div>
      </div>
    `,
  );
}

function addActivity(activity) {
  appendActivityRecord(activity);

  const normalizedAction = normalizeActivityType(activity?.action);
  bumpCount(activityTypeCounts, normalizedAction);

  syncDoughnutChart(
    securityChart,
    Object.keys(activityTypeCounts),
    Object.values(activityTypeCounts),
  );

  if (activity?.action === "failed_login") {
    window.adminSummaryCache = window.adminSummaryCache || {};
    window.adminSummaryCache.failed_logins =
      Number(window.adminSummaryCache.failed_logins || 0) + 1;
  }

  if (activity?.action === "login_blocked_locked_account") {
    window.adminSummaryCache = window.adminSummaryCache || {};
    window.adminSummaryCache.locked_users =
      Number(window.adminSummaryCache.locked_users || 0) + 1;
  }

  syncAdminStatCards();

  if (typeof loadAuditReport === "function") {
    loadAuditReport();
  }

  scheduleSummaryRefresh();
}

function initSecurityChart() {
  const canvas = document.getElementById("securityChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  securityChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(activityTypeCounts),
      datasets: [
        {
          label: "Activities by action",
          data: Object.values(activityTypeCounts),
          backgroundColor: [
            "rgba(46,158,99,0.75)",
            "rgba(217,135,15,0.75)",
            "rgba(217,79,79,0.75)",
            "rgba(58,127,193,0.75)",
            "rgba(91,175,180,0.75)",
          ],
          borderColor: "#eaf5f6",
          borderWidth: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: "#6a9094",
            font: { family: "DM Sans", size: 12 },
            boxWidth: 12,
            padding: 14,
          },
        },
      },
    },
  });
}

// =========================
// LOAD SUMMARY
// =========================
async function loadSummary() {
  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/security-summary?t=${Date.now()}`,
    {
      ...getFetchOptions(),
      cache: "no-store",
    },
  );

  if (!res) return;

  const data = await res.json();

  applyAdminSummary(data);
}

async function loadActivities() {
  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/activity-logs`,
    getFetchOptions(),
  );

  if (!res) return;

  const activities = await res.json();
  const container = getActivitiesContainer();

  if (!container) return;

  container.innerHTML = "";

  rebuildActivityTypeCounts(activities);

  activities
    .slice(0, 25)
    .reverse()
    .forEach((activity) => appendActivityRecord(activity));
}

async function loadUsers() {
  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/users`,
    getFetchOptions(),
  );
  if (!res) return;

  const users = await res.json();
  renderUserTable(users);
}

async function saveUser(event) {
  event.preventDefault();

  const fullname = document.getElementById("userFullname")?.value.trim();
  const email = document.getElementById("userEmail")?.value.trim();
  const password = document.getElementById("userPassword")?.value;
  const role = document.getElementById("userRole")?.value || "caregiver";

  const payload = { fullname, email, role };
  if (password) payload.password = password;

  const url = activeEditingUserId
    ? `${DASHBOARD_BACKEND_URL}/api/admin/users/${activeEditingUserId}`
    : `${DASHBOARD_BACKEND_URL}/api/admin/users`;

  const method = activeEditingUserId ? "PUT" : "POST";

  const res = await safeFetch(url, {
    ...getFetchOptions(method),
    body: JSON.stringify(payload),
  });

  if (!res) return;

  const savedUser = await res.json();
  if (!res.ok) {
    throw new Error(savedUser.message || "Unable to save user");
  }

  activeEditingUserId = null;
  document.getElementById("userForm")?.reset();
  document.getElementById("userSaveButton").innerText = "Save User";
  await loadUsers();
  await loadSummary();
  await loadActivities();
}

async function deleteUser(userId) {
  if (!confirm("Delete this user?")) return;

  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/users/${userId}`,
    getFetchOptions("DELETE"),
  );
  if (!res) return;

  await loadUsers();
  await loadSummary();
  await loadActivities();
}

async function toggleUserLock(userId, isLocked) {
  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/users/${userId}`,
    {
      ...getFetchOptions("PUT"),
      body: JSON.stringify({ is_locked: !isLocked }),
    },
  );
  if (!res) return;
  await loadUsers();
  await loadSummary();
  await loadActivities();
}

async function editUser(userId) {
  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/users`,
    getFetchOptions(),
  );
  if (!res) return;

  const users = await res.json();
  const user = users.find((item) => item.id === userId);
  if (!user) return;

  activeEditingUserId = userId;
  document.getElementById("userId").value = userId;
  document.getElementById("userFullname").value = user.fullname;
  document.getElementById("userEmail").value = user.email;
  document.getElementById("userRole").value = user.role;
  document.getElementById("userPassword").value = "";
  document.getElementById("userSaveButton").innerText = "Update User";
}

async function loadSystemConfig() {
  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/system-config`,
    getFetchOptions(),
  );
  if (!res) return;
  const config = await res.json();
  renderSystemConfig(config);
}

async function saveSystemConfig(event) {
  event.preventDefault();

  const failed_login_threshold = Number(
    document.getElementById("failedLoginThreshold")?.value || 3,
  );
  const alert_sensitivity =
    document.getElementById("alertSensitivity")?.value || "medium";
  const enabled_modules = {};

  document.querySelectorAll("[data-module-key]").forEach((input) => {
    enabled_modules[input.dataset.moduleKey] = input.checked;
  });

  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/system-config`,
    {
      ...getFetchOptions("PUT"),
      body: JSON.stringify({
        failed_login_threshold,
        alert_sensitivity,
        enabled_modules,
      }),
    },
  );

  if (!res) return;
  await res.json();
  await loadSystemConfig();
  await loadActivities();
}

async function loadAuditReport() {
  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/audit-reports`,
    getFetchOptions(),
  );
  if (!res) return;
  const report = await res.json();
  renderAuditReport(report);
}

function getDownloadFilename(response, fallbackName) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(
    /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i,
  );
  const rawName = match?.[1] || match?.[2];

  if (!rawName) return fallbackName;

  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

async function downloadAuditReport(path, fallbackName) {
  const res = await safeFetch(`${DASHBOARD_BACKEND_URL}${path}`, {
    ...getFetchOptions(),
    cache: "no-store",
  });

  if (!res) return;

  const blob = await res.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = getDownloadFilename(res, fallbackName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(downloadUrl);
}

function exportAuditCsv() {
  downloadAuditReport(
    "/api/admin/audit-reports/export/csv",
    "audit-report.csv",
  ).catch((error) => {
    alert(error.message || "Unable to download CSV report");
  });
}

function exportAuditPdf() {
  downloadAuditReport(
    "/api/admin/audit-reports/export/pdf",
    "audit-report.pdf",
  ).catch((error) => {
    alert(error.message || "Unable to download PDF report");
  });
}

// =========================
// INIT APP (STEP 2 ENTRY)
// =========================
function initApp() {
  if (!requireAuth()) return;

  showDashboard();
  loadSummary();
  loadActivities();
  loadUsers();
  loadSystemConfig();
  loadAuditReport();
  loadMedicationSchedules();
  initSecurityChart();
}

// =========================
// INIT
// =========================
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
  document
    .getElementById("userForm")
    ?.addEventListener("submit", async (event) => {
      try {
        await saveUser(event);
      } catch (error) {
        alert(error.message);
      }
    });
  document
    .getElementById("systemConfigForm")
    ?.addEventListener("submit", async (event) => {
      try {
        await saveSystemConfig(event);
      } catch (error) {
        alert(error.message);
      }
    });
  document
    .getElementById("exportAuditCsvButton")
    ?.addEventListener("click", exportAuditCsv);
  document
    .getElementById("exportAuditPdfButton")
    ?.addEventListener("click", exportAuditPdf);

  document
    .getElementById("usersTableBody")
    ?.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const userId = button.dataset.userId;
      const action = button.dataset.action;

      if (action === "edit-user") await editUser(userId);
      if (action === "delete-user") await deleteUser(userId);
      if (action === "toggle-lock") {
        const currentAdminId = localStorage.getItem("user_id");
        if (currentAdminId && currentAdminId === userId) {
          alert(
            "You cannot lock or unlock your own account from the admin dashboard.",
          );
          return;
        }

        const buttonEl = event.target.closest(
          "button[data-action='toggle-lock']",
        );
        const isLockedAttr = buttonEl?.dataset?.isLocked;
        const isLocked = isLockedAttr === "true" || isLockedAttr === "1";

        const confirmation = confirm(
          isLocked ? "Unlock this account?" : "Lock this account?",
        );
        if (!confirmation) return;

        await toggleUserLock(userId, isLocked);
      }
    });

  document
    .getElementById("createDemoAdminButton")
    ?.addEventListener("click", handleCreateDemoAdmin);

  initApp();
});
