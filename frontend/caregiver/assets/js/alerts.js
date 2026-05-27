const alertsPageState = {
  alerts: [],
  filter: "all",
};

const DISMISSED_KEY = "dismissed_alerts_v1";

function loadDismissedAlerts() {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY) || "[]";
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr);
  } catch (err) {
    // ignore
  }
  return new Set();
}

function saveDismissedAlerts(set) {
  try {
    const arr = Array.from(set);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr));
  } catch (err) {
    // ignore
  }
}

const dismissedAlerts = loadDismissedAlerts();

function isDismissedAlert(id) {
  return dismissedAlerts.has(id);
}

function dismissAlert(id) {
  dismissedAlerts.add(id);
  saveDismissedAlerts(dismissedAlerts);
}

function alertCardClass(alert) {
  const status = String(alert.status || "").toLowerCase();
  if (status === "resolved") return "resolved";

  const severity = String(alert.severity || "medium").toLowerCase();
  if (severity === "critical") return "critical";
  if (severity === "high" || severity === "medium") return "warning";
  return "info";
}

function severityPillClass(severity) {
  const normalized = String(severity || "medium").toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "medium";
}

function typePillClass(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("fall")) return "fall";
  if (normalized.includes("sos") || normalized.includes("emergency")) {
    return "sos";
  }
  if (normalized.includes("security") || normalized.includes("camera")) {
    return "security";
  }
  if (
    normalized.includes("inactiv") ||
    normalized.includes("med") ||
    normalized.includes("missed")
  ) {
    return "inactivity";
  }
  if (normalized.includes("movement")) return "movement";
  return "default";
}

function matchesFilter(alert, filter) {
  const status = String(alert.status || "").toLowerCase();
  const severity = String(alert.severity || "medium").toLowerCase();

  if (filter === "all") return true;
  if (filter === "resolved") return status === "resolved";
  if (status === "resolved") return false;
  if (filter === "critical") return severity === "critical";
  if (filter === "warning") {
    return severity === "high" || severity === "medium";
  }
  if (filter === "info") return severity === "low";
  return true;
}

function countAlertsByFilter(alerts) {
  return {
    all: alerts.length,
    critical: alerts.filter((a) => matchesFilter(a, "critical")).length,
    warning: alerts.filter((a) => matchesFilter(a, "warning")).length,
    info: alerts.filter((a) => matchesFilter(a, "info")).length,
  };
}

function updateAlertsHeroStats(alerts) {
  const counts = countAlertsByFilter(alerts);
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };

  setText("alertsStatTotal", counts.all);
  setText("alertsStatCritical", counts.critical);
  setText("countAll", counts.all);
  setText("countCritical", counts.critical);
  setText("countWarning", counts.warning);
  setText("countInfo", counts.info);
}

function renderAlertsPage(alerts = alertsPageState.alerts) {
  const container = document.getElementById("alertsFeed");
  if (!container) return;

  updateAlertsHeroStats(alerts);

  const visible = alerts.filter(
    (alert) =>
      !isDismissedAlert(alert.id) &&
      matchesFilter(alert, alertsPageState.filter),
  );

  if (!visible.length) {
    container.innerHTML = `
      <div class="alerts-empty">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
        </div>
        <div class="empty-text">No alerts in this view</div>
        <div class="empty-sub">Try another filter or refresh the feed.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = visible
    .map((alert, index) => {
      const cardClass = alertCardClass(alert);
      const severity = String(alert.severity || "medium").toLowerCase();
      const status = String(alert.status || "new").toLowerCase();
      const typeClass = typePillClass(alert.type);
      const typeLabel = String(alert.type || "Alert");
      const isResolved = status === "resolved";
      const patientLabel = alert.patient_id
        ? `Patient ${alert.patient_id}`
        : "Unassigned";

      const actionsHtml = isResolved
        ? ""
        : `
          <div class="alert-actions">
            <button type="button" class="act-btn clear" data-alert-action="clear" data-alert-id="${alert.id}">Clear</button>
          </div>
        `;

      return `
        <article class="alert-card ${cardClass}" style="animation-delay:${index * 0.05}s">
          <div class="alert-icon-wrap">
            <svg viewBox="0 0 24 24">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div class="alert-body">
            <div class="alert-top">
              <div class="alert-title">${alert.type || "Alert"}</div>
              <div class="alert-meta">
                <span class="alert-time">${window.CaregiverAPI.formatDateTime(alert.created_at)}</span>
              </div>
            </div>
            <div class="alert-desc">${alert.message || "Alert received"}</div>
            <div class="alert-footer">
              <span class="type-pill ${typeClass}">${typeLabel}</span>
              <span class="sev-pill ${severityPillClass(severity)}">
                <span class="sev-pill-dot"></span>${alert.severity || "medium"}
              </span>
              <span class="patient-chip">
                <span class="patient-chip-dot">•</span>${patientLabel}
              </span>
              ${actionsHtml}
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function prependAlertsPageAlert(alert) {
  if (isDismissedAlert(alert.id)) return;
  alertsPageState.alerts = [
    alert,
    ...alertsPageState.alerts.filter((item) => item.id !== alert.id),
  ];
  renderAlertsPage(alertsPageState.alerts);
}

function removeAlertFromState(alertId) {
  alertsPageState.alerts = alertsPageState.alerts.filter(
    (a) => a.id !== alertId,
  );
  renderAlertsPage(alertsPageState.alerts);
}

async function refreshAlertsPage() {
  const alerts = await window.CaregiverAPI.apiJson("/api/alerts");
  if (alerts) {
    alertsPageState.alerts = alerts;
    renderAlertsPage(alerts);
  }
}

function bindAlertsFilterTabs() {
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      alertsPageState.filter = tab.dataset.filter || "all";
      document.querySelectorAll(".filter-tab").forEach((item) => {
        item.classList.toggle("active", item === tab);
      });
      renderAlertsPage(alertsPageState.alerts);
    });
  });
}

function bindAlertsPageEvents() {
  document.addEventListener("click", async (event) => {
    const alertButton = event.target.closest("[data-alert-action]");
    if (!alertButton) return;

    const feed = document.getElementById("alertsFeed");
    if (!feed || !feed.contains(alertButton)) return;

    const alertId = alertButton.dataset.alertId;
    const action = alertButton.dataset.alertAction;
    const endpoint =
      action === "clear"
        ? "clear"
        : action === "acknowledge"
          ? "acknowledge"
          : "resolve";

    // For 'clear' we only remove the alert from the UI (client-side dismiss)
    // and persist the dismissal in localStorage so socket pushes or refreshes
    // won't re-add it. Do NOT call the backend endpoint (it isn't supported).
    if (endpoint === "clear") {
      dismissAlert(alertId);
      removeAlertFromState(alertId);
      window.CaregiverAPI.showToast("Alert cleared", "info");
      return;
    }

    const result = await window.CaregiverAPI.apiJson(
      `/api/alerts/${alertId}/${endpoint}`,
      { method: "PUT" },
    );

    if (result) {
      const verb = endpoint === "resolve" ? "resolved" : "acknowledged";
      const toastType = endpoint === "resolve" ? "success" : "warning";
      window.CaregiverAPI.showToast(`Alert ${verb}`, toastType);
      await refreshAlertsPage();
    }
  });

  document
    .getElementById("alertsRefreshButton")
    ?.addEventListener("click", refreshAlertsPage);
}

function bindAlertsNav() {
  const navModal = document.getElementById("navModal");
  const navMenuOpen = document.getElementById("navMenuOpen");
  const navModalClose = document.getElementById("navModalClose");

  if (!navModal || !navMenuOpen) return;

  const openNavModal = () => {
    navModal.classList.add("open");
    navMenuOpen.setAttribute("aria-expanded", "true");
  };

  const closeNavModal = () => {
    navModal.classList.remove("open");
    navMenuOpen.setAttribute("aria-expanded", "false");
    navMenuOpen.focus();
  };

  navMenuOpen.addEventListener("click", openNavModal);
  navModalClose?.addEventListener("click", closeNavModal);
  navModal.addEventListener("click", (event) => {
    if (event.target === navModal) closeNavModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && navModal.classList.contains("open")) {
      closeNavModal();
    }
  });
  navModal.querySelectorAll(".nav-links a").forEach((link) => {
    link.addEventListener("click", closeNavModal);
  });
}

window.renderAlerts = function renderAlertsForAlertsPage(alerts = []) {
  alertsPageState.alerts = alerts;
  renderAlertsPage(alerts);
};

window.prependAlert = prependAlertsPageAlert;
window.refreshAlertsPage = refreshAlertsPage;

window.addEventListener("DOMContentLoaded", async () => {
  if (!window.CaregiverAPI.requireCaregiverSession()) return;
  window.CaregiverAPI.bindLogoutButtons();
  bindAlertsNav();
  bindAlertsFilterTabs();
  bindAlertsPageEvents();
  await refreshAlertsPage();
  window.initCaregiverSocket?.();
});
