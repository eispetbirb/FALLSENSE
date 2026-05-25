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

  // Fired by detection.py when best.pt detects a fall above threshold.
  caregiverSocket.on("fall_alert", (data) => {
    window.onAIFallAlert?.(data);
    // Also surface as a caregiver alert so the Alerts page picks it up.
    window.prependAlert?.({
      message: data.message || "Fall detected",
      severity: "critical",
      created_at: data.timestamp,
    });
    window.CaregiverAPI?.showToast?.(
      data.message || "⚠️ Fall detected!",
      "danger",
    );
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