const monitoringState = {
  patients: [],
  selectedPatientId: null,
};

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
  if (patient.fall_detected) return "Fall";
  if (patient.emergency_status) return "SOS";
  if (!patient.online) return "Offline";
  const activity = String(patient.activity_state || "Stable");
  return activity.length > 12 ? `${activity.slice(0, 12)}…` : activity;
}

function toggleStreamVisibility(streamUrl) {
  const frame = document.getElementById("cameraFrame");
  const placeholder = document.getElementById("streamPlaceholder");
  const hasStream = Boolean(streamUrl);

  if (frame) {
    frame.style.display = hasStream ? "block" : "none";
    if (hasStream) frame.src = streamUrl;
    else frame.removeAttribute("src");
  }

  if (placeholder) {
    placeholder.style.display = hasStream ? "none" : "flex";
  }
}

function updateStreamLiveBadge(status) {
  const badge = document.getElementById("streamLiveBadge");
  if (!badge) return;

  const normalized = String(status || "").toLowerCase();
  const isOnline =
    normalized === "connected" ||
    normalized === "ready" ||
    normalized.includes("online");

  badge.className = `stream-badge ${isOnline ? "online" : "offline"}`;
  badge.innerHTML = `<span class="stream-badge-dot"></span>${isOnline ? "Live" : "Offline"}`;
}

function streamStatusBadgeClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "connected" || normalized === "ready") return "online";
  if (normalized.includes("error") || normalized.includes("offline")) {
    return "offline";
  }
  return "waiting";
}

function renderMonitoringPatientStatuses(patients = []) {
  const container = document.getElementById("patientStatusGrid");
  if (!container) return;

  if (!patients.length) {
    container.innerHTML = `
      <div class="monitoring-empty">No patient monitoring data yet.</div>
    `;
    return;
  }

  container.innerHTML = patients
    .map((patient) => {
      const variant = patientCardVariant(patient);
      return `
        <article class="patient-state-item ${variant}">
          <div class="patient-state-avatar">${patientInitials(patient.patient_name)}</div>
          <div class="patient-state-info">
            <div class="patient-state-name">${patient.patient_name}</div>
            <div class="patient-state-room">${patient.room_label || "Unassigned room"}</div>
          </div>
          <div class="patient-state-badge ${variant}">
            <span class="patient-state-badge-dot"></span>
            ${patientStatusLabel(patient)}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderMonitoringCameraStatus(camera = {}) {
  const status = document.getElementById("cameraHealthStatus");
  const indicator = document.getElementById("cameraIndicator");
  const streamLabel = document.getElementById("cameraStreamLabel");
  const reconnect = document.getElementById("cameraReconnectCount");
  const frame = document.getElementById("cameraFrame");

  const health = camera.camera_health || "offline";
  const normalized = String(health).toLowerCase();
  const isOnline = ["online", "active", "normal"].includes(normalized);

  if (status) {
    status.textContent = health;
    status.className = `health-pill ${isOnline ? "online" : "offline"}`;
  }

  if (indicator) {
    indicator.classList.toggle("online", isOnline);
  }

  if (streamLabel) {
    streamLabel.textContent = isOnline ? "Connected" : "Disconnected";
  }

  if (reconnect) {
    reconnect.textContent = String(camera.reconnect_count ?? 0);
  }

  const streamUrl = camera.stream_url || frame?.src || "";
  if (streamUrl && frame && !frame.getAttribute("src")) {
    frame.src = streamUrl;
  }

  toggleStreamVisibility(streamUrl);
  updateStreamLiveBadge(isOnline ? "connected" : "offline");

  if (streamUrl) {
    updateStreamDisplay(streamUrl, isOnline ? "connected" : "waiting");
  }
}

async function refreshMonitoringPage() {
  const [camera, patients] = await Promise.all([
    window.CaregiverAPI.apiJson("/api/monitoring/camera-status"),
    window.CaregiverAPI.apiJson("/api/patients/status"),
  ]);

  if (camera) {
    renderMonitoringCameraStatus(camera);
  }

  if (patients) {
    monitoringState.patients = patients.patients || patients || [];
    renderPatientSelector();
    renderMonitoringPatientStatuses(monitoringState.patients);
  }
}

function renderPatientSelector() {
  const dropdown = document.getElementById("patientSelectDropdown");
  if (!dropdown) return;

  const defaultOption = dropdown.querySelector('option[value=""]');
  const options = [
    defaultOption?.outerHTML ||
      '<option value="">-- Choose a patient --</option>',
  ];

  monitoringState.patients.forEach((patient) => {
    const selected =
      monitoringState.selectedPatientId === patient.patient_id
        ? "selected"
        : "";
    options.push(
      `<option value="${patient.patient_id}" ${selected}>${patient.patient_name} (${patient.room_label || "Room TBD"})</option>`,
    );
  });

  dropdown.innerHTML = options.join("");

  if (monitoringState.selectedPatientId) {
    const selectedPatient = monitoringState.patients.find(
      (p) => p.patient_id === monitoringState.selectedPatientId,
    );
    if (selectedPatient?.stream_url) {
      updateStreamDisplay(selectedPatient.stream_url, "ready");
      toggleStreamVisibility(selectedPatient.stream_url);
    }
  }
}

function normalizeStreamUrl(urlInput) {
  if (!urlInput) return "";
  let url = urlInput;

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `http://${url}`;
  }

  if (
    !url.includes("/video") &&
    !url.includes("/videostream") &&
    !url.includes("/mjpeg") &&
    !url.includes("/stream")
  ) {
    url = `${url}/video`;
  }

  return url;
}

async function setPhoneCameraStream() {
  const input = document.getElementById("cameraStreamUrlInput");
  let streamUrl = input?.value?.trim() || "";

  if (!streamUrl) {
    window.CaregiverAPI.showToast("Please enter a camera URL", "warning");
    return;
  }

  streamUrl = normalizeStreamUrl(streamUrl);

  const dropdown = document.getElementById("patientSelectDropdown");
  const patientId = dropdown?.value?.trim();

  if (!patientId) {
    window.CaregiverAPI.showToast(
      "Please select a patient from the dropdown",
      "error",
    );
    return;
  }

  monitoringState.selectedPatientId = patientId;
  updateStreamDisplay(streamUrl, "connecting...");

  // ── Tell the AI backend to start processing this stream ───────────────────
  // detection.py will pull frames, run best.pt, and emit "frame" + "fall_alert"
  // back through the socket. The img tag is then updated by onAIFrame() below.
  const result = await window.CaregiverAPI.apiJson("/api/stream/start", {
    method: "POST",
    body: JSON.stringify({ patient_id: patientId, ip: streamUrl }),
  });

  if (result) {
    window.CaregiverAPI.showToast("AI detection started", "success");
    input.value = "";
    // Show placeholder frame; real frames arrive via socket "frame" event
    toggleStreamVisibility(streamUrl);
    updateStreamDisplay(streamUrl, "connecting...");
    await refreshMonitoringPage();
  } else {
    // Fallback: direct MJPEG (no AI overlay, original behaviour)
    window.CaregiverAPI.showToast(
      "AI backend unavailable – showing raw stream",
      "warning",
    );
    toggleStreamVisibility(streamUrl);
    updateStreamDisplay(streamUrl, "loading");
    const img = document.getElementById("cameraFrame");
    if (img) img.src = streamUrl;
  }
}

function updateStreamDisplay(url, status) {
  const urlDisplay = document.getElementById("streamUrlDisplay");
  const statusDisplay = document.getElementById("streamStatusDisplay");
  const testButton = document.getElementById("testStreamButton");
  const noStreamHint = document.getElementById("noStreamHint");
  const label = status || "waiting";
  const badgeClass = streamStatusBadgeClass(label);

  if (urlDisplay) {
    urlDisplay.textContent = url || "No stream configured";
  }

  if (statusDisplay) {
    statusDisplay.innerHTML = `<span class="status-badge ${badgeClass}">${label}</span>`;
  }

  updateStreamLiveBadge(
    badgeClass === "online" ? "connected" : badgeClass === "offline" ? "error" : label,
  );

  if (testButton) {
    if (url) {
      testButton.style.display = "inline-flex";
      const normalizedUrl = normalizeStreamUrl(url);
      testButton.onclick = () => window.open(normalizedUrl, "_blank");
      if (noStreamHint) noStreamHint.style.display = "none";
    } else {
      testButton.style.display = "none";
      if (noStreamHint) noStreamHint.style.display = "flex";
    }
  }

  console.log(`[Camera] URL: ${url}, Status: ${status}`);
}

function bindCameraControls() {
  const fullscreenButton = document.getElementById("cameraFullscreenButton");
  const reconnectButton = document.getElementById("cameraReconnectButton");
  const refreshButton = document.getElementById("cameraRefreshButton");
  const streamSetButton = document.getElementById("cameraStreamSetButton");
  const patientDropdown = document.getElementById("patientSelectDropdown");
  const cameraFrame = document.getElementById("cameraFrame");

  if (cameraFrame) {
    cameraFrame.addEventListener("load", () => {
      // Only fire if src is a real URL (not a base64 AI frame)
      if (!cameraFrame.src.startsWith("data:")) {
        updateStreamDisplay(cameraFrame.src, "connected");
        toggleStreamVisibility(cameraFrame.src);
      }
    });

    cameraFrame.addEventListener("error", () => {
      if (!cameraFrame.src.startsWith("data:")) {
        updateStreamDisplay(cameraFrame.src, "error - unable to load");
        console.error("[Camera] Image failed to load stream");
      }
    });
  }

  fullscreenButton?.addEventListener("click", () => {
    const img = document.getElementById("cameraFrame");
    if (!img || !img.src) {
      window.CaregiverAPI.showToast("No camera stream configured", "warning");
      return;
    }
    window.open(img.src, "_blank", "fullscreen=yes");
  });

  reconnectButton?.addEventListener("click", async () => {
    window.CaregiverAPI.showToast("Reconnect requested", "warning");
    await refreshMonitoringPage();
  });

  refreshButton?.addEventListener("click", refreshMonitoringPage);

  streamSetButton?.addEventListener("click", setPhoneCameraStream);

  patientDropdown?.addEventListener("change", (event) => {
    monitoringState.selectedPatientId = event.target.value;

    if (monitoringState.selectedPatientId) {
      const selectedPatient = monitoringState.patients.find(
        (p) => p.patient_id === monitoringState.selectedPatientId,
      );
      if (selectedPatient?.stream_url) {
        updateStreamDisplay(selectedPatient.stream_url, "ready");
        toggleStreamVisibility(selectedPatient.stream_url);
      } else {
        updateStreamDisplay("", "no stream configured");
        toggleStreamVisibility("");
      }
    } else {
      updateStreamDisplay("", "waiting");
      toggleStreamVisibility("");
    }
  });

  document
    .getElementById("cameraStreamUrlInput")
    ?.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        setPhoneCameraStream();
      }
    });
}

function bindMonitoringNav() {
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

// ── AI Socket Handlers ─────────────────────────────────────────────────────────
// These are called by socket.js when AI events arrive.
// They update ONLY the existing img/badge/status elements — no new DOM added.

let _fallAlertTimer = null;

window.onAIFrame = function (data) {
  const img = document.getElementById("cameraFrame");
  const placeholder = document.getElementById("streamPlaceholder");

  if (!img) return;

  // Replace img src with the AI-annotated frame (bounding boxes already drawn)
  img.src = "data:image/jpeg;base64," + data.image;
  img.style.display = "block";
  if (placeholder) placeholder.style.display = "none";

  // Keep the Live badge green while frames are arriving
  updateStreamLiveBadge("connected");

  // Update status display with detection summary (no design change)
  if (data.detections && data.detections.length) {
    const hasFall = data.detections.some((d) =>
      d.label.toLowerCase().includes("fall"),
    );
    updateStreamDisplay(
      document.getElementById("streamUrlDisplay")?.textContent || "",
      hasFall ? "fall detected" : "connected",
    );
  }
};

window.onAIFallAlert = function (data) {
  // Flash the existing stream-wrap border red using a temporary CSS class.
  // The class is removed after 5 s so the design returns to normal.
  const streamWrap = document.querySelector(".stream-wrap");
  if (streamWrap) {
    streamWrap.classList.add("ai-fall-flash");
    clearTimeout(_fallAlertTimer);
    _fallAlertTimer = setTimeout(
      () => streamWrap.classList.remove("ai-fall-flash"),
      5000,
    );
  }

  // Update the status badge to "fall detected"
  updateStreamDisplay(
    document.getElementById("streamUrlDisplay")?.textContent || "",
    "fall detected",
  );

  // Update the Camera Health pill to match severity
  const healthPill = document.getElementById("cameraHealthStatus");
  if (healthPill) {
    healthPill.textContent = "fall detected";
    healthPill.className = "health-pill offline";
    setTimeout(() => {
      healthPill.textContent = "online";
      healthPill.className = "health-pill online";
    }, 5000);
  }

  console.warn("[AI] Fall alert:", data);
};

window.onAIStreamError = function (data) {
  updateStreamDisplay(
    document.getElementById("streamUrlDisplay")?.textContent || "",
    "error - stream lost",
  );
  updateStreamLiveBadge("offline");
  console.error("[AI] Stream error:", data.message);
};

window.onAIStreamStatus = function (data) {
  const isConnected = data.status === "connected" || data.running;
  updateStreamLiveBadge(isConnected ? "connected" : "offline");
  updateStreamDisplay(
    data.url ||
      document.getElementById("streamUrlDisplay")?.textContent ||
      "",
    isConnected ? "connected" : "offline",
  );
};

// ── Inline style for fall flash (no CSS file change needed) ───────────────────
(function injectFallFlashStyle() {
  const style = document.createElement("style");
  style.textContent = `
    .stream-wrap.ai-fall-flash {
      outline: 3px solid #ef4444;
      outline-offset: -3px;
      animation: ai-fall-pulse 0.6s ease-in-out infinite alternate;
    }
    @keyframes ai-fall-pulse {
      from { outline-color: #ef4444; }
      to   { outline-color: #fca5a5; }
    }
  `;
  document.head.appendChild(style);
})();

// ── Exports (unchanged) ────────────────────────────────────────────────────────
window.renderPatientStatuses = renderMonitoringPatientStatuses;
window.renderCameraStatus = renderMonitoringCameraStatus;
window.refreshMonitoringPage = refreshMonitoringPage;
window.setPhoneCameraStream = setPhoneCameraStream;

window.addEventListener("DOMContentLoaded", async () => {
  if (!window.CaregiverAPI.requireCaregiverSession()) return;
  window.CaregiverAPI.bindLogoutButtons();
  bindMonitoringNav();
  bindCameraControls();
  await refreshMonitoringPage();
  window.initCaregiverSocket?.();
});