const caregiverState = {
  patients: [],
  alerts: [],
  medications: [],
  camera: null,
  fallIncidents: [],
};

let pendingQuickAction = null;
let pendingPatientEdit = null;

function openOverlayModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
}

function closeOverlayModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
}

function bindOverlayModals() {
  document.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeOverlayModal(button.dataset.modalClose);
    });
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeOverlayModal(overlay.id);
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".modal-overlay.open").forEach((overlay) => {
      closeOverlayModal(overlay.id);
    });
  });
}

function bindNavModal() {
  const navModal = document.getElementById("navModal");
  const navMenuOpen = document.getElementById("navMenuOpen");
  const navModalClose = document.getElementById("navModalClose");

  if (!navModal || !navMenuOpen) return;

  const openNavModal = () => {
    openOverlayModal("navModal");
    navMenuOpen.setAttribute("aria-expanded", "true");
  };

  const closeNavModal = () => {
    closeOverlayModal("navModal");
    navMenuOpen.setAttribute("aria-expanded", "false");
    navMenuOpen.focus();
  };

  navMenuOpen.addEventListener("click", openNavModal);
  navModalClose?.addEventListener("click", closeNavModal);
  navModal.querySelectorAll(".nav-links a").forEach((link) => {
    link.addEventListener("click", closeNavModal);
  });
}

function patientInitials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function patientCardVariant(patient) {
  if (patient.fall_detected || patient.emergency_status) return "alert";
  if (!patient.online) return "warning";
  const activity = String(patient.activity_state || "").toLowerCase();
  if (["warning", "inactive", "idle"].includes(activity)) return "warning";
  return "stable";
}

function patientStatusLabel(patient) {
  if (patient.fall_detected) return "Fall Detected";
  if (patient.emergency_status) return "SOS Active";
  if (!patient.online) return "Offline";
  return patient.activity_state || "Stable";
}

function patientActionButtons(patient) {
  return `
    <div class="patient-actions">
      <button
        type="button"
        class="btn-chip primary"
        data-patient-action="edit"
        data-patient-id="${patient.patient_id}"
      >
        Edit
      </button>
      <button
        type="button"
        class="btn-chip warn"
        data-patient-action="remove"
        data-patient-id="${patient.patient_id}"
      >
        Remove
      </button>
    </div>
  `;
}

function findPatientById(patientId) {
  return caregiverState.patients.find(
    (patient) => patient.patient_id === patientId || patient.id === patientId,
  );
}

function removePatientStatus(payload) {
  const patientId = payload?.patient_id || payload?.id;
  if (!patientId) return;

  const nextPatients = caregiverState.patients.filter(
    (patient) => patient.patient_id !== patientId && patient.id !== patientId,
  );

  renderPatientStatuses(nextPatients);
}

function alertSeverityClass(severity) {
  const normalized = String(severity || "medium").toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high" || normalized === "medium") return "warning";
  return "info";
}

function medicationDotColor(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "taken") return "var(--green)";
  if (normalized === "missed") return "var(--red)";
  return "var(--amber)";
}

function updateAddPatientButtons() {
  const atLimit = caregiverState.patients.length >= 3;
  const label = atLimit ? "Patient limit reached" : "Add patient";

  ["addPatientButton", "addPatientBtn2"].forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;
    button.disabled = atLimit;
    if (button.id === "addPatientButton") {
      button.textContent = atLimit ? "Patient limit reached" : "+ Add Patient";
    } else {
      button.textContent = label;
    }
  });
}

function isFallIncident(incident) {
  const incidentType = String(
    incident?.incident_type || incident?.label || "",
  ).toLowerCase();
  return (
    incidentType.includes("fall") ||
    incidentType === "falling" ||
    incidentType === "fall_detected"
  );
}

function filterFallIncidentsForPatients(incidents, patients) {
  const patientIds = new Set(
    (patients || []).map((patient) => patient.patient_id).filter(Boolean),
  );
  const fallIncidents = (incidents || []).filter(isFallIncident);
  if (!patientIds.size) return fallIncidents;
  return fallIncidents.filter((incident) => patientIds.has(incident.patient_id));
}

async function refreshFallIncidentStats() {
  const payload = await window.CaregiverAPI.apiJson("/api/reports/incidents");
  if (!payload) return;

  caregiverState.fallIncidents = filterFallIncidentsForPatients(
    payload.items || [],
    caregiverState.patients,
  );
  updateDashboardStats();
}

function updateDashboardStats() {
  const patients = caregiverState.patients;
  const alerts = caregiverState.alerts;
  const medications = caregiverState.medications;

  const openAlerts = alerts.filter(
    (alert) => String(alert.status || "").toLowerCase() !== "resolved",
  );
  const pendingMeds = medications.filter(
    (med) => String(med.status || "").toLowerCase() === "pending",
  );
  const takenMeds = medications.filter(
    (med) => String(med.status || "").toLowerCase() === "taken",
  );
  const fallIncidents = caregiverState.fallIncidents || [];
  const falls = fallIncidents.length;
  const openFalls = fallIncidents.filter((incident) => !incident.resolved).length;

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  };

  setText("heroStatPatients", patients.length);
  setText("heroStatAlerts", openAlerts.length);
  setText("heroStatMeds", pendingMeds.length);
  setText("statPatients", patients.length);
  setText("statAlerts", openAlerts.length);
  setText("statMeds", pendingMeds.length);
  setText("statFalls", falls);

  setText(
    "statPatientsTrend",
    patients.length >= 3 ? "Limit reached" : `Max ${3 - patients.length} more`,
  );
  setText(
    "statAlertsTrend",
    openAlerts.length ? `${openAlerts.length} open` : "All clear",
  );
  setText(
    "statMedsTrend",
    medications.length ? `${takenMeds.length} given` : "No schedules",
  );
  setText("statFallsTrend", falls ? (openFalls ? `${openFalls} open` : "All reviewed") : "No records");
}

function renderPatientStatuses(patients = []) {
  caregiverState.patients = patients;
  const container = document.getElementById("patientStatusGrid");
  if (!container) return;

  if (!patients.length) {
    container.innerHTML = `
      <div class="dashboard-empty">No patient monitoring data yet.</div>
    `;
    updateAddPatientButtons();
    updateDashboardStats();
    return;
  }

  container.innerHTML = patients
    .map((patient) => {
      const variant = patientCardVariant(patient);
      const statusClass = variant;
      const statusLabel = patientStatusLabel(patient);

      return `
        <article class="patient-card ${variant}">
          <div class="patient-header">
            <div class="patient-avatar">${patientInitials(patient.patient_name)}</div>
            <div>
              <div class="patient-name">${patient.patient_name}</div>
              <div class="patient-room">${patient.room_label || "Unassigned room"}</div>
            </div>
          </div>
          <div class="patient-status ${statusClass}">
            <span class="patient-status-dot"></span>${statusLabel}
          </div>
          <div class="patient-vitals">
            <div class="vital-item">
              <div class="vital-label">Connection</div>
              <div class="vital-value">${patient.online ? "Online" : "Offline"}</div>
            </div>
            <div class="vital-item">
              <div class="vital-label">Fall</div>
              <div class="vital-value">${patient.fall_detected ? "Detected" : "Clear"}</div>
            </div>
            <div class="vital-item">
              <div class="vital-label">Camera</div>
              <div class="vital-value">${patient.camera_status || "unknown"}</div>
            </div>
            <div class="vital-item">
              <div class="vital-label">Last activity</div>
              <div class="vital-value">${window.CaregiverAPI.formatDateTime(patient.last_activity_at)}</div>
            </div>
          </div>
          ${patientActionButtons(patient)}
        </article>
      `;
    })
    .join("");

  updateAddPatientButtons();
  updateDashboardStats();
}

function bindAddPatientModal() {
  const openButtons = [
    document.getElementById("addPatientButton"),
    document.getElementById("addPatientBtn2"),
  ];
  const form = document.getElementById("addPatientForm");
  const submitButton = document.getElementById("addPatientSubmitButton");
  const nameInput = document.getElementById("patientNameInput");
  const roomInput = document.getElementById("patientRoomInput");

  const openModal = () => {
    if (caregiverState.patients.length >= 3) {
      window.CaregiverAPI.showToast(
        "You can only add up to 3 patients",
        "warning",
      );
      return;
    }
    openOverlayModal("addPatientModal");
  };

  openButtons.forEach((button) => {
    button?.addEventListener("click", openModal);
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const patient_name = nameInput?.value?.trim() || "";
    const room_label = roomInput?.value?.trim() || "";

    if (!patient_name) {
      window.CaregiverAPI.showToast("Patient name is required", "error");
      return;
    }

    try {
      window.CaregiverAPI.setLoadingState(
        submitButton,
        true,
        "Saving patient...",
      );
      const created = await window.CaregiverAPI.apiJson("/api/patients", {
        method: "POST",
        body: JSON.stringify({ patient_name, room_label }),
      });

      if (created) {
        window.CaregiverAPI.showToast("Patient added", "success");
        form.reset();
        closeOverlayModal("addPatientModal");
        await refreshDashboard();
      }
    } catch (error) {
      window.CaregiverAPI.showToast(
        error?.message || "Unable to add patient",
        "error",
      );
    } finally {
      window.CaregiverAPI.setLoadingState(submitButton, false, "Save patient");
    }
  });
}

function openPatientEditModal(patient) {
  const modal = document.getElementById("editPatientModal");
  const idInput = document.getElementById("patientEditId");
  const nameInput = document.getElementById("patientEditNameInput");
  const roomInput = document.getElementById("patientEditRoomInput");
  const title = document.getElementById("patientEditModalTitle");

  if (!modal || !idInput || !nameInput || !roomInput) {
    return;
  }

  pendingPatientEdit = patient;
  idInput.value = patient.patient_id || patient.id || "";
  nameInput.value = patient.patient_name || "";
  roomInput.value = patient.room_label || "";

  if (title) {
    title.textContent = `Edit ${patient.patient_name || "Patient"}`;
  }

  openOverlayModal("editPatientModal");
}

function bindEditPatientModal() {
  const form = document.getElementById("editPatientForm");
  const submitButton = document.getElementById("editPatientSubmitButton");
  const removeButton = document.getElementById("editPatientRemoveButton");
  const idInput = document.getElementById("patientEditId");
  const nameInput = document.getElementById("patientEditNameInput");
  const roomInput = document.getElementById("patientEditRoomInput");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const patientId = idInput?.value?.trim();
    const patient_name = nameInput?.value?.trim() || "";
    const room_label = roomInput?.value?.trim() || "";

    if (!patientId || !patient_name) {
      window.CaregiverAPI.showToast("Patient name is required", "error");
      return;
    }

    try {
      window.CaregiverAPI.setLoadingState(
        submitButton,
        true,
        "Saving changes...",
      );
      const updated = await window.CaregiverAPI.apiJson(
        `/api/patients/${patientId}`,
        {
          method: "PUT",
          body: JSON.stringify({ patient_name, room_label }),
        },
      );

      if (updated) {
        window.CaregiverAPI.showToast("Patient updated", "success");
        closeOverlayModal("editPatientModal");
        await refreshDashboard();
      }
    } catch (error) {
      window.CaregiverAPI.showToast(
        error?.message || "Unable to update patient",
        "error",
      );
    } finally {
      window.CaregiverAPI.setLoadingState(submitButton, false, "Save changes");
    }
  });

  removeButton?.addEventListener("click", () => {
    const patientId = idInput?.value?.trim();
    const patientName = nameInput?.value?.trim() || "this patient";

    if (!patientId) return;

    closeOverlayModal("editPatientModal");
    openQuickActionModal(
      `Remove ${patientName}? This will also clear linked schedules, camera status, and incident records.`,
      async () => {
        try {
          await window.CaregiverAPI.apiJson(`/api/patients/${patientId}`, {
            method: "DELETE",
          });
          window.CaregiverAPI.showToast("Patient removed", "warning");
          await refreshDashboard();
        } catch (error) {
          window.CaregiverAPI.showToast(
            error?.message || "Unable to remove patient",
            "error",
          );
        }
      },
    );
  });
}

function prependAlert(alert) {
  caregiverState.alerts = [
    alert,
    ...caregiverState.alerts.filter((item) => item.id !== alert.id),
  ];
  renderAlerts(caregiverState.alerts);
}

function renderAlerts(alerts = []) {
  caregiverState.alerts = alerts;
  const container = document.getElementById("alertsFeed");
  if (!container) return;

  if (!alerts.length) {
    container.innerHTML = `<div class="dashboard-empty">No alerts available.</div>`;
    updateDashboardStats();
    return;
  }

  container.innerHTML = alerts
    .map((alert) => {
      const severityClass = alertSeverityClass(alert.severity);
      const severity = String(alert.severity || "medium").toLowerCase();
      const status = String(alert.status || "new").toLowerCase();

      return `
        <article class="alert-item ${severityClass}">
          <div class="alert-item-top">
            <div class="alert-icon">
              <svg viewBox="0 0 24 24">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div class="alert-body">
              <div class="alert-title">${alert.type || "Alert"}</div>
              <div class="alert-desc">${alert.message || "Alert received"}</div>
              <div class="alert-time">${window.CaregiverAPI.formatDateTime(alert.created_at)}</div>
              <div class="alert-meta">
                <span class="alert-badge severity-${severity}">${alert.severity || "medium"}</span>
                <span class="alert-badge status-${status}">${alert.status || "new"}</span>
              </div>
            </div>
          </div>
          <div class="alert-actions">
            <button type="button" class="btn-chip" data-alert-action="acknowledge" data-alert-id="${alert.id}">Acknowledge</button>
            <button type="button" class="btn-chip primary" data-alert-action="resolve" data-alert-id="${alert.id}">Resolve</button>
          </div>
        </article>
      `;
    })
    .join("");

  updateDashboardStats();
}

function renderMedications(medications = []) {
  caregiverState.medications = medications;
  const container = document.getElementById("medicationList");
  if (!container) return;

  if (!medications.length) {
    container.innerHTML = `<div class="dashboard-empty">No medication schedules found.</div>`;
    updateDashboardStats();
    return;
  }

  container.innerHTML = medications
    .map((medication) => {
      const status = String(medication.status || "pending").toLowerCase();
      const dotColor = medicationDotColor(status);

      return `
        <div class="med-item">
          <div class="med-dot" style="background:${dotColor}"></div>
          <div class="med-info">
            <div class="med-name">${medication.medicine_name}</div>
            <div class="med-time">${medication.dosage} | ${medication.schedule_time}</div>
            <div class="med-time">Patient ${medication.patient_id}</div>
            <div class="med-actions">
              <button type="button" class="btn-chip primary" data-medication-action="taken" data-medication-id="${medication.id}">Mark taken</button>
              <button type="button" class="btn-chip warn" data-medication-action="missed" data-medication-id="${medication.id}">Mark missed</button>
            </div>
          </div>
          <div class="med-status" style="color:${dotColor}">${medication.status}</div>
        </div>
      `;
    })
    .join("");

  updateDashboardStats();
}

function cameraPillClass(health = "") {
  const normalized = String(health || "offline").toLowerCase();
  if (["online", "active", "normal"].includes(normalized)) return "green";
  if (["warning", "pending", "reconnecting"].includes(normalized))
    return "amber";
  return "red";
}

function renderCameraStatus(camera = {}) {
  caregiverState.camera = camera;
  const status = document.getElementById("cameraHealthStatus");
  const indicator = document.getElementById("cameraIndicator");
  const streamLabel = document.getElementById("cameraStreamLabel");
  const reconnect = document.getElementById("cameraReconnectCount");
  const stream = document.getElementById("cameraFrame");

  const health = camera.camera_health || "offline";
  const normalized = String(health).toLowerCase();
  const isOnline = ["online", "active", "normal"].includes(normalized);
  const pillClass = cameraPillClass(health);

  if (status) {
    status.textContent = health;
    status.className = `pill ${pillClass}`;
  }

  if (indicator) {
    indicator.classList.toggle("online", isOnline);
  }

  if (streamLabel) {
    streamLabel.textContent = isOnline ? "Connected" : "Disconnected";
  }

  if (stream && camera.stream_url) {
    stream.src = camera.stream_url;
  }

  if (reconnect) {
    reconnect.textContent = String(camera.reconnect_count ?? 0);
  }
}

async function refreshMedications() {
  const medications = await window.CaregiverAPI.apiJson("/api/medications");
  if (medications) renderMedications(medications);
}

async function refreshDashboard() {
  const [patients, alerts, medications, camera] = await Promise.all([
    window.CaregiverAPI.apiJson("/api/patients/status"),
    window.CaregiverAPI.apiJson("/api/alerts"),
    window.CaregiverAPI.apiJson("/api/medications"),
    window.CaregiverAPI.apiJson("/api/monitoring/camera-status"),
  ]);

  if (patients) renderPatientStatuses(patients);
  if (alerts) renderAlerts(alerts);
  if (medications) renderMedications(medications);
  if (camera) renderCameraStatus(camera);
  await refreshFallIncidentStats();
}

async function performQuickAction(action) {
  if (action === "refresh") {
    await refreshDashboard();
    window.CaregiverAPI.showToast("Monitoring state refreshed", "success");
    return;
  }

  if (action === "monitor") {
    openQuickActionModal("Start emergency monitoring?", async () => {
      window.CaregiverAPI.showToast(
        "Emergency monitoring mode started",
        "warning",
      );
    });
    return;
  }

  if (action === "call") {
    openQuickActionModal("Open the patient call placeholder?", async () => {
      window.CaregiverAPI.showToast(
        "Call patient action is a placeholder for telephony integration",
        "info",
      );
    });
  }
}

function openQuickActionModal(message, callback) {
  const modalBody = document.getElementById("quickActionModalBody");
  const confirmButton = document.getElementById("quickActionConfirmButton");
  const modalElement = document.getElementById("quickActionModal");

  if (!modalBody || !confirmButton || !modalElement) {
    callback?.();
    return;
  }

  modalBody.textContent = message;
  pendingQuickAction = callback;

  confirmButton.onclick = async () => {
    const action = pendingQuickAction;
    pendingQuickAction = null;
    closeOverlayModal("quickActionModal");
    await action?.();
  };

  openOverlayModal("quickActionModal");
}

function bindDashboardEvents() {
  document.addEventListener("click", async (event) => {
    const patientButton = event.target.closest("[data-patient-action]");
    if (patientButton) {
      const patientId = patientButton.dataset.patientId;
      const action = patientButton.dataset.patientAction;
      const patient = findPatientById(patientId);

      if (!patient) {
        window.CaregiverAPI.showToast("Patient not found", "error");
        return;
      }

      if (action === "edit") {
        openPatientEditModal(patient);
        return;
      }

      if (action === "remove") {
        openQuickActionModal(
          `Remove ${patient.patient_name}? This will also clear linked schedules, camera status, and incident records.`,
          async () => {
            try {
              await window.CaregiverAPI.apiJson(`/api/patients/${patientId}`, {
                method: "DELETE",
              });
              window.CaregiverAPI.showToast("Patient removed", "warning");
              await refreshDashboard();
            } catch (error) {
              window.CaregiverAPI.showToast(
                error?.message || "Unable to remove patient",
                "error",
              );
            }
          },
        );
      }
      return;
    }

    const alertButton = event.target.closest("[data-alert-action]");
    if (alertButton) {
      const alertId = alertButton.dataset.alertId;
      const action = alertButton.dataset.alertAction;
      const endpoint = action === "acknowledge" ? "acknowledge" : "resolve";
      const result = await window.CaregiverAPI.apiJson(
        `/api/alerts/${alertId}/${endpoint}`,
        { method: "PUT" },
      );
      if (result) {
        window.CaregiverAPI.showToast(
          `Alert ${endpoint}d`,
          endpoint === "resolve" ? "success" : "warning",
        );
        await refreshDashboard();
      }
      return;
    }

    const medicationButton = event.target.closest("[data-medication-action]");
    if (medicationButton) {
      const medicationId = medicationButton.dataset.medicationId;
      const status = medicationButton.dataset.medicationAction;
      const result = await window.CaregiverAPI.apiJson(
        `/api/medications/${medicationId}/status`,
        {
          method: "PUT",
          body: JSON.stringify({ status }),
        },
      );
      if (result) {
        window.CaregiverAPI.showToast(
          `Medication marked as ${status}`,
          status === "missed" ? "warning" : "success",
        );
        await refreshDashboard();
      }
      return;
    }

    const quickAction = event.target.closest("[data-quick-action]");
    if (quickAction) {
      await performQuickAction(quickAction.dataset.quickAction);
    }
  });
}

function upsertPatientStatus(payload) {
  if (!payload) return;
  if (payload.deleted) {
    removePatientStatus(payload);
    return;
  }

  const existing = [...caregiverState.patients];
  const index = existing.findIndex(
    (patient) =>
      patient.id === payload.id || patient.patient_id === payload.patient_id,
  );

  if (index >= 0) {
    existing[index] = { ...existing[index], ...payload };
  } else {
    existing.push(payload);
  }

  renderPatientStatuses(existing);
}

window.renderPatientStatuses = renderPatientStatuses;
window.upsertPatientStatus = upsertPatientStatus;
window.removePatientStatus = removePatientStatus;
window.prependAlert = prependAlert;
window.renderAlerts = renderAlerts;
window.renderMedications = renderMedications;
window.renderCameraStatus = renderCameraStatus;
window.refreshDashboard = refreshDashboard;
window.refreshMedications = refreshMedications;
window.refreshFallIncidentStats = refreshFallIncidentStats;

window.addEventListener("DOMContentLoaded", async () => {
  if (!window.CaregiverAPI.requireCaregiverSession()) return;
  window.CaregiverAPI.bindLogoutButtons();
  bindOverlayModals();
  bindNavModal();
  bindAddPatientModal();
  bindEditPatientModal();
  bindDashboardEvents();
  await refreshDashboard();
  window.initCaregiverSocket?.();
});
