const reportsState = {
  page: 1,
  pageSize: 10,
  total: 0,
};

let lastFilteredIncidents = [];
let patientNameById = {};

async function loadPatientNameMap() {
  const statuses = await window.CaregiverAPI.apiJson("/api/patients/status");
  if (!Array.isArray(statuses)) {
    patientNameById = {};
    return;
  }

  patientNameById = statuses.reduce((acc, item) => {
    const id = String(item?.patient_id || "").trim();
    const name = String(item?.patient_name || "").trim();
    if (id) acc[id] = name || id;
    return acc;
  }, {});
}

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

function normalizeIncidentLogEntry(entry) {
  const meta = entry?.meta || {};
  const status = String(entry?.status || "").toLowerCase();
  const detections = Array.isArray(meta.detections) ? meta.detections : [];
  const topDetection = detections[0] || null;
  const topLabel = topDetection?.label ? String(topDetection.label) : "";
  const topConfidence = Number(topDetection?.confidence);
  const confidenceText = Number.isFinite(topConfidence)
    ? `${Math.round(topConfidence * 100)}%`
    : "";
  const aiDetails = topLabel
    ? `${topLabel}${confidenceText ? ` (${confidenceText})` : ""}`
    : "";
  const summaryText = [meta.summary, aiDetails].filter(Boolean).join(" | ");

  return {
    id: entry?.id,
    patient_id: meta.patient_id || "—",
    patient_name: patientNameById[meta.patient_id] || `Patient ${meta.patient_id || "—"}`,
    incident_type: entry?.label || "Incident",
    severity: entry?.severity || "medium",
    summary: summaryText || "—",
    resolved: status === "resolved",
    occurred_at: entry?.created_at,
    ai_source: meta.source || "",
    ai_trigger: meta.trigger || "",
    ai_detections: detections,
  };
}

function applyIncidentFilters(items) {
  const startDate = document.getElementById("incidentStartDate")?.value || "";
  const endDate = document.getElementById("incidentEndDate")?.value || "";
  const severityFilter =
    document.getElementById("incidentSeverityFilter")?.value || "";
  const typeFilter = document.getElementById("incidentTypeFilter")?.value || "";

  const startTime = startDate ? new Date(`${startDate}T00:00:00`) : null;
  const endTime = endDate ? new Date(`${endDate}T23:59:59.999`) : null;

  return items.filter((item) => {
    const occurredAt = item?.occurred_at ? new Date(item.occurred_at) : null;
    const normalizedSeverity = String(item?.severity || "").toLowerCase();
    const normalizedType = String(item?.incident_type || "").toLowerCase();

    if (severityFilter && normalizedSeverity !== severityFilter) return false;
    if (typeFilter && normalizedType !== typeFilter) return false;
    if (startTime && occurredAt && occurredAt < startTime) return false;
    if (endTime && occurredAt && occurredAt > endTime) return false;
    return true;
  });
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
      const patientName = item.patient_name || `Patient ${patientId}`;

      return `
        <tr>
          <td><span class="type-badge ${typeClass}">${typeLabel}</span></td>
          <td>
            <div class="patient-cell">
              <div class="patient-avatar-sm">•</div>
              <div>
                <div class="patient-name-sm">${patientName}</div>
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
  await loadPatientNameMap();
  const payload = await window.CaregiverAPI.apiJson(
    "/api/logs?type=incident&page=1&page_size=250",
  );
  if (!payload) return;

  const normalizedItems = (payload.items || []).map(normalizeIncidentLogEntry);
  const filteredItems = applyIncidentFilters(normalizedItems);
  lastFilteredIncidents = filteredItems;
  renderIncidentReports({
    items: filteredItems,
    total: filteredItems.length,
  });
}

async function exportIncidentCsv() {
  if (!lastFilteredIncidents.length) {
    window.CaregiverAPI.showToast("No AI incident logs to export", "warning");
    return;
  }

  const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const headers = [
    "id",
    "patient_id",
    "incident_type",
    "severity",
    "summary",
    "occurred_at",
    "resolved",
  ];
  const lines = [
    headers.join(","),
    ...lastFilteredIncidents.map((item) =>
      [
        item.id,
        item.patient_id,
        item.incident_type,
        item.severity,
        item.summary,
        item.occurred_at,
        item.resolved,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ai-incident-logs.csv";
  link.click();
  URL.revokeObjectURL(url);
  window.CaregiverAPI.showToast("AI incident logs CSV downloaded", "success");
}

async function downloadIncidentStructure() {
  const payload = {
    title: "AI Incident Logs",
    generated_at: new Date().toISOString(),
    columns: [
      "id",
      "patient_id",
      "incident_type",
      "severity",
      "summary",
      "occurred_at",
      "resolved",
    ],
    rows: lastFilteredIncidents,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ai-incident-logs-structure.json";
  link.click();
  URL.revokeObjectURL(url);
  window.CaregiverAPI.showToast("AI incident log structure downloaded", "success");
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
