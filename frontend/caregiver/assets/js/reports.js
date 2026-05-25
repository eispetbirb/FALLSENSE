const reportsState = {
  page: 1,
  pageSize: 10,
  total: 0,
};

function typeBadgeClass(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("fall")) return "fall";
  if (normalized.includes("sos") || normalized.includes("emergency")) {
    return "sos";
  }
  if (normalized.includes("security")) return "security";
  if (normalized.includes("inactiv")) return "inactivity";
  return "default";
}

function severityBadgeClass(severity) {
  const normalized = String(severity || "medium").toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "medium";
}

function statusBadgeClass(resolved) {
  return resolved ? "resolved" : "pending";
}

function updateIncidentSummaryStats(items, total) {
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  };

  const fallCount = items.filter((item) =>
    String(item.incident_type || "").toLowerCase().includes("fall"),
  ).length;
  const pendingCount = items.filter((item) => !item.resolved).length;
  const resolvedCount = items.filter((item) => item.resolved).length;

  setText("incidentSummaryCount", total);
  setText("fallCount", fallCount);
  setText("pendingCount", pendingCount);
  setText("resolvedCount", resolvedCount);
}

function renderIncidentReports(payload) {
  const items = payload?.items || [];
  const total = payload?.count ?? payload?.total ?? items.length;
  reportsState.total = total;

  updateIncidentSummaryStats(items, total);

  const tableBody = document.getElementById("incidentReportsBody");
  if (!tableBody) return;

  if (!items.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="reports-empty">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div class="empty-text">No incident reports found</div>
            <div class="empty-sub">Adjust your filters and try again.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = items
    .map((item) => {
      const typeClass = typeBadgeClass(item.incident_type);
      const typeLabel = String(item.incident_type || "Incident");
      const severity = String(item.severity || "medium").toLowerCase();
      const statusClass = statusBadgeClass(item.resolved);
      const statusLabel = item.resolved ? "Resolved" : "Open";
      const patientId = item.patient_id || "—";

      return `
        <tr>
          <td><span class="type-badge ${typeClass}">${typeLabel}</span></td>
          <td>
            <div class="patient-cell">
              <div class="patient-avatar-sm">•</div>
              <div>
                <div class="patient-name-sm">Patient ${patientId}</div>
                <div class="patient-room-sm">ID ${patientId}</div>
              </div>
            </div>
          </td>
          <td>
            <span class="sev-badge ${severityBadgeClass(severity)}">
              <span class="sev-badge-dot"></span>${item.severity || "medium"}
            </span>
          </td>
          <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td><span class="occurred-text">${window.CaregiverAPI.formatDateTime(item.occurred_at)}</span></td>
          <td><span class="summary-text" title="${(item.summary || "").replace(/"/g, "&quot;")}">${item.summary || "—"}</span></td>
        </tr>
      `;
    })
    .join("");
}

async function refreshIncidents() {
  const startDate = document.getElementById("incidentStartDate")?.value || "";
  const endDate = document.getElementById("incidentEndDate")?.value || "";
  const severity =
    document.getElementById("incidentSeverityFilter")?.value || "";
  const type = document.getElementById("incidentTypeFilter")?.value || "";

  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  if (severity) params.set("severity", severity);
  if (type) params.set("type", type);

  const payload = await window.CaregiverAPI.apiJson(
    `/api/reports/incidents${params.toString() ? `?${params.toString()}` : ""}`,
  );
  if (payload) renderIncidentReports(payload);
}

async function exportIncidentCsv() {
  const response = await window.CaregiverAPI.apiFetch(
    "/api/reports/incidents?format=csv",
  );
  if (!response) return;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "incident-reports.csv";
  link.click();
  URL.revokeObjectURL(url);
  window.CaregiverAPI.showToast("CSV export downloaded", "success");
}

async function downloadIncidentStructure() {
  const payload = await window.CaregiverAPI.apiJson(
    "/api/reports/incidents?format=pdf-structure",
  );
  if (!payload) return;

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "incident-reports-structure.json";
  link.click();
  URL.revokeObjectURL(url);
  window.CaregiverAPI.showToast("PDF structure downloaded", "success");
}

function bindReportsNav() {
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

function bindReportsPageEvents() {
  document
    .getElementById("incidentFilterForm")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await refreshIncidents();
    });

  document
    .getElementById("incidentCsvButton")
    ?.addEventListener("click", exportIncidentCsv);
  document
    .getElementById("incidentPdfStructureButton")
    ?.addEventListener("click", downloadIncidentStructure);
}

window.renderIncidentReports = renderIncidentReports;
window.refreshIncidents = refreshIncidents;
window.downloadIncidentStructure = downloadIncidentStructure;

window.addEventListener("DOMContentLoaded", async () => {
  if (!window.CaregiverAPI.requireCaregiverSession()) return;
  window.CaregiverAPI.bindLogoutButtons();
  bindReportsNav();
  bindReportsPageEvents();
  await refreshIncidents();
  window.initCaregiverSocket?.();
});
