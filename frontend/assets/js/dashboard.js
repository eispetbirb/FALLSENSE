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
let alertChart;
let securityChart;
let alertSeverityCounts = {
  low: 0,
  medium: 0,
  high: 0,
  critical: 0,
};

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

function getAlertsContainer() {
  return document.getElementById("alerts");
}

function getActivitiesContainer() {
  return document.getElementById("activities");
}

function formatTime(value) {
  if (!value) return new Date().toLocaleString();

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
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

function severityFeedDot(severity) {
  const value = normalizeSeverity(severity);
  if (value === "critical") return "red";
  if (value === "high") return "amber";
  if (value === "low") return "green";
  return "teal";
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
    ["totalUsers", "sc-users"],
    ["totalAlerts", "sc-alerts"],
    ["failedLogins", "sc-failed"],
    ["lockedUsers", "sc-locked"],
  ];

  pairs.forEach(([sourceId, targetId]) => {
    const source = document.getElementById(sourceId);
    const target = document.getElementById(targetId);
    if (source && target) target.textContent = source.textContent;
  });
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
  const totalAlertsEl = document.getElementById("totalAlerts");
  const failedLoginsEl = document.getElementById("failedLogins");
  const lockedUsersEl = document.getElementById("lockedUsers");

  if (typeof delta.total_alerts === "number" && totalAlertsEl) {
    totalAlertsEl.innerText = String(delta.total_alerts);
  }

  if (typeof delta.failed_logins === "number" && failedLoginsEl) {
    failedLoginsEl.innerText = String(delta.failed_logins);
  }

  if (typeof delta.locked_users === "number" && lockedUsersEl) {
    lockedUsersEl.innerText = String(delta.locked_users);
  }

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
            <button type="button" class="icon-btn" title="${user.is_locked ? "Unlock" : "Lock"}" data-action="toggle-lock" data-user-id="${escapeHtml(user.id)}">${ICON_LOCK}</button>
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
        <td style="font-size:12px; color:var(--muted);">${escapeHtml(log.created_at)}</td>
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
        <td style="font-size:12px; color:var(--muted);">${escapeHtml(event.created_at)}</td>
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

function rebuildAlertSeverityCounts(alerts = []) {
  alertSeverityCounts = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  alerts.forEach((alert) => {
    bumpCount(alertSeverityCounts, normalizeSeverity(alert?.severity));
  });

  syncDoughnutChart(
    alertChart,
    ["Low", "Medium", "High", "Critical"],
    [
      alertSeverityCounts.low,
      alertSeverityCounts.medium,
      alertSeverityCounts.high,
      alertSeverityCounts.critical,
    ],
  );
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

function appendAlertRecord(alert) {
  const container = getAlertsContainer();
  const severity = normalizeSeverity(alert?.severity);
  const title = `${alert?.type || "Alert"} — ${alert?.message || "New alert received"}`;

  prependRecord(
    container,
    `
      <div class="feed-item">
        <div class="feed-dot ${severityFeedDot(severity)}"></div>
        <div class="feed-body">
          <div class="feed-title">${escapeHtml(title)} <span class="sev-pill ${severity}">${severity}</span></div>
          <div class="feed-time">${escapeHtml(formatTime(alert?.created_at))}</div>
        </div>
      </div>
    `,
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

function addAlert(alert) {
  appendAlertRecord(alert);

  const totalAlertsEl = document.getElementById("totalAlerts");
  if (totalAlertsEl) {
    totalAlertsEl.innerText = String(Number(totalAlertsEl.innerText || 0) + 1);
  }
  syncAdminStatCards();

  const severity = normalizeSeverity(alert?.severity);
  bumpCount(alertSeverityCounts, severity);

  syncDoughnutChart(
    alertChart,
    ["Low", "Medium", "High", "Critical"],
    [
      alertSeverityCounts.low,
      alertSeverityCounts.medium,
      alertSeverityCounts.high,
      alertSeverityCounts.critical,
    ],
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
    const failedLoginsEl = document.getElementById("failedLogins");
    if (failedLoginsEl) {
      failedLoginsEl.innerText = String(
        Number(failedLoginsEl.innerText || 0) + 1,
      );
    }
  }

  if (activity?.action === "login_blocked_locked_account") {
    const lockedUsersEl = document.getElementById("lockedUsers");
    if (lockedUsersEl) {
      lockedUsersEl.innerText = String(
        Number(lockedUsersEl.innerText || 0) + 1,
      );
    }
  }

  syncAdminStatCards();

  if (typeof loadAuditReport === "function") {
    loadAuditReport();
  }
}

function initAlertChart() {
  const canvas = document.getElementById("alertChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  alertChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Low", "Medium", "High", "Critical"],
      datasets: [
        {
          label: "Alerts by severity",
          data: [
            alertSeverityCounts.low,
            alertSeverityCounts.medium,
            alertSeverityCounts.high,
            alertSeverityCounts.critical,
          ],
          backgroundColor: [
            "rgba(46,158,99,0.75)",
            "rgba(91,175,180,0.75)",
            "rgba(217,135,15,0.75)",
            "rgba(217,79,79,0.75)",
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
    `${DASHBOARD_BACKEND_URL}/api/admin/security-summary`,
    getFetchOptions(),
  );

  if (!res) return;

  const data = await res.json();

  safeSet("totalUsers", data.total_users);
  safeSet("totalAlerts", data.total_alerts);
  safeSet("failedLogins", data.failed_logins);
  safeSet("lockedUsers", data.locked_users);

  refreshSecuritySummaryCards(data);
  syncAdminStatCards();
}

async function loadAlerts() {
  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/alerts`,
    getFetchOptions(),
  );

  if (!res) return;

  const alerts = await res.json();
  const container = getAlertsContainer();

  if (!container) return;

  container.innerHTML = "";

  rebuildAlertSeverityCounts(alerts);

  alerts.slice(0, 25).forEach((alert) => appendAlertRecord(alert));
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

  activities.slice(0, 25).forEach((activity) => appendActivityRecord(activity));
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
}

async function deleteUser(userId) {
  if (!confirm("Delete this user?")) return;

  const res = await safeFetch(
    `${DASHBOARD_BACKEND_URL}/api/admin/users/${userId}`,
    getFetchOptions("DELETE"),
  );
  if (!res) return;

  await loadUsers();
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

function exportAuditCsv() {
  window.open(
    `${DASHBOARD_BACKEND_URL}/api/admin/audit-reports/export/csv`,
    "_blank",
  );
}

function exportAuditPdf() {
  window.open(
    `${DASHBOARD_BACKEND_URL}/api/admin/audit-reports/export/pdf`,
    "_blank",
  );
}

// =========================
// INIT APP (STEP 2 ENTRY)
// =========================
function initApp() {
  if (!requireAuth()) return;

  showDashboard();
  loadSummary();
  loadAlerts();
  loadActivities();
  loadUsers();
  loadSystemConfig();
  loadAuditReport();
  initAlertChart();
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
        const res = await safeFetch(
          `${DASHBOARD_BACKEND_URL}/api/admin/users`,
          getFetchOptions(),
        );
        if (!res) return;
        const users = await res.json();
        const user = users.find((item) => item.id === userId);
        if (user) await toggleUserLock(userId, user.is_locked);
      }
    });

  document
    .getElementById("createDemoAdminButton")
    ?.addEventListener("click", handleCreateDemoAdmin);

  initApp();
});
