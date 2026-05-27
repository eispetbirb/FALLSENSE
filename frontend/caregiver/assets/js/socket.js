let caregiverSocket = null;

function getSocketToken() {
  return localStorage.getItem("auth_token");
}

function initCaregiverSocket() {
  const token = getSocketToken();
  if (!token || caregiverSocket) {
    return caregiverSocket;
  }

  caregiverSocket = io(window.BACKEND_URL || "http://localhost:5000", {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 8,
    auth: { token },
  });

  caregiverSocket.on("connect", () => {
    window.CaregiverAPI?.showToast?.(
      "Realtime monitoring connected",
      "success",
    );
  });

  caregiverSocket.on("connect_error", (error) => {
    console.error("Socket connection failed", error);
    window.CaregiverAPI?.showToast?.(
      "Realtime connection failed. The dashboard will stay open and keep retrying.",
      "warning",
    );
  });

  caregiverSocket.on("patient_status_updated", (payload) => {
    if (payload?.deleted) {
      window.removePatientStatus?.(payload);
      window.CaregiverAPI?.showToast?.("Patient removed", "warning");
      return;
    }

    window.upsertPatientStatus?.(payload);
    window.CaregiverAPI?.showToast?.(
      "Patient monitoring state updated",
      "info",
    );
  });

  caregiverSocket.on("caregiver_alert", (payload) => {
    window.prependAlert?.(payload);
    window.CaregiverAPI?.showToast?.(
      payload.message || "New caregiver alert",
      "danger",
    );
  });

  caregiverSocket.on("new_alert", (payload) => {
    window.prependAlert?.(payload);
  });

  caregiverSocket.on("medication_updated", () => {
    window.refreshMedications?.();
  });

  caregiverSocket.on("incident_updated", () => {
    window.refreshIncidents?.();
  });

  // ── AI Detection Events ────────────────────────────────────────────────────

  // Receives base64-encoded JPEG frames with bounding boxes already drawn by
  // detection.py, and replaces the existing cameraFrame img src.
  caregiverSocket.on("frame", (data) => {
    window.onAIFrame?.(data);
  });

  // Fired by detection.py for falling (warn) or laying down (critical).
  caregiverSocket.on("posture_alert", (data) => {
    window.onAIPostureAlert?.(data);
  });

  // Backward-compatible: laying-down alerts still use fall_alert from detection.py.
  caregiverSocket.on("fall_alert", (data) => {
    if (data.alert_type === "falling") return;
    window.onAIPostureAlert?.({
      ...data,
      alert_type: data.alert_type || "laying_down",
      severity: data.severity || "critical",
    });
  });

  // Fired when the backend IP camera stream drops or fails to open.
  caregiverSocket.on("stream_error", (data) => {
    window.onAIStreamError?.(data);
    window.CaregiverAPI?.showToast?.(
      data.message || "Camera stream error",
      "warning",
    );
  });

  // Fired when detection.py connects/disconnects from the IP camera.
  caregiverSocket.on("stream_status", (data) => {
    window.onAIStreamStatus?.(data);
  });

  return caregiverSocket;
}

function disconnectCaregiverSocket() {
  if (caregiverSocket) {
    caregiverSocket.disconnect();
    caregiverSocket = null;
  }
}

window.initCaregiverSocket = initCaregiverSocket;
window.disconnectCaregiverSocket = disconnectCaregiverSocket;
