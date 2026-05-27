"""
detection.py — lives at backend/app/detection.py
Reads frames from phone IP camera, runs best.pt, emits events via Socket.IO.
"""

import os
import cv2
import threading
import base64
import time
from ultralytics import YOLO

from app.services.caregiver_service import create_incident_report

# ── Absolute path to best.pt (backend/best.pt) ───────────────────────────────
# __file__ = backend/app/detection.py  →  parent = backend/app  →  parent = backend
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(_BASE_DIR, "best.pt")

print(f"[AI] Loading model from: {MODEL_PATH}")
if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(
        f"[AI] best.pt not found at {MODEL_PATH}. "
        "Place best.pt in your backend/ folder."
    )

model = YOLO(MODEL_PATH)
print(f"[AI] Model loaded. Classes: {model.names}")

# ── State ─────────────────────────────────────────────────────────────────────
_thread = None
_running = False
_camera_url = None
_active_patient_id = None
_ALERT_COOLDOWN_SECONDS = 12
_last_alert_by_key = {}


def _build_url(ip: str) -> str:
    """
    Accepts any of these formats from the frontend input:
      192.168.1.5          → http://192.168.1.5:8080/video
      192.168.1.5:8080     → http://192.168.1.5:8080/video
      http://192.168.1.5:8080/video  → unchanged
    Adjust the path suffix if your phone app uses /shot.jpg or /mjpeg etc.
    """
    ip = ip.strip()
    if ip.startswith("http"):
        return ip
    if ":" not in ip:
        ip = f"{ip}:8080"
    return f"http://{ip}/video"


def _normalize_incident_severity(raw_severity: str) -> str:
    normalized = str(raw_severity or "").strip().lower()
    if normalized in {"critical", "high", "medium", "low"}:
        return normalized
    if normalized in {"warning", "warn"}:
        return "high"
    return "medium"


def _should_store_alert(patient_id: str, alert_type: str) -> bool:
    key = f"{patient_id}:{alert_type}"
    now = time.time()
    previous = _last_alert_by_key.get(key, 0)
    if now - previous < _ALERT_COOLDOWN_SECONDS:
        return False
    _last_alert_by_key[key] = now
    return True


def _persist_ai_alert(flask_app, patient_id: str, alert_payload: dict):
    if not flask_app or not patient_id:
        return None

    alert_type = str(alert_payload.get("alert_type") or "incident").strip().lower()
    if not _should_store_alert(patient_id, alert_type):
        return None

    severity = _normalize_incident_severity(alert_payload.get("severity"))
    message = str(alert_payload.get("message") or "AI incident detected").strip()
    with flask_app.app_context():
        report = create_incident_report(
            patient_id=patient_id,
            incident_type=alert_type,
            severity=severity,
            summary=message,
            payload=alert_payload,
        )
        return report.id


def _detection_loop(socketio, url: str, flask_app=None, patient_id=None):
    global _running

    print(f"[AI] Connecting to stream: {url}")
    cap = cv2.VideoCapture(url)

    if not cap.isOpened():
        print(f"[AI] ERROR: Cannot open stream at {url}")
        socketio.emit("stream_error", {"message": f"Cannot open stream: {url}"}, namespace="/")
        _running = False
        return

    socketio.emit("stream_status", {"status": "connected", "url": url}, namespace="/")
    print(f"[AI] Stream opened. Starting inference loop...")

    CONF_THRESHOLD = 0.4
    FRAME_SKIP = 1

    frame_count = 0

    while _running:
        ret, frame = cap.read()

        if not ret:
            print("[AI] Frame read failed — retrying in 2s...")
            socketio.emit("stream_error", {"message": "Stream lost. Retrying..."}, namespace="/")
            time.sleep(2)
            cap.release()
            cap = cv2.VideoCapture(url)
            continue

        frame_count += 1
        if frame_count % FRAME_SKIP != 0:
            continue

        # ── YOLOv8 inference ──────────────────────────────────────────────────
        frame = cv2.resize(frame, (640, 480))
        results = model(frame, imgsz=320, verbose=False)[0]

        falling_detected = False
        laying_detected = False
        detections = []

        for box in results.boxes:
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            label = model.names[cls_id]
            x1, y1, x2, y2 = map(int, box.xyxy[0])

            label_lower = label.lower().replace(" ", "_")
            is_falling = label_lower == "falling" or (
                "fall" in label_lower and "lay" not in label_lower
            )
            is_laying = "lay" in label_lower or "lying" in label_lower

            if is_laying:
                color = (0, 0, 255)  # red — laying down
            elif is_falling:
                color = (0, 200, 255)  # yellow — falling
            else:
                color = (0, 255, 0)  # green — standing / other

            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(
                frame,
                f"{label} {conf:.0%}",
                (x1, max(y1 - 8, 10)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                color,
                2,
            )

            detections.append({"label": label, "confidence": round(conf, 3)})

            if is_falling and conf >= CONF_THRESHOLD:
                falling_detected = True
            if is_laying and conf >= CONF_THRESHOLD:
                laying_detected = True

        # ── Encode frame → base64 JPEG ────────────────────────────────────────
        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 40])
        frame_b64 = base64.b64encode(buffer).decode("utf-8")

        # ── Emit annotated frame to all connected clients ─────────────────────
        socketio.emit(
            "frame",
            {
                "image": frame_b64,
                "detections": detections,
                "falling": falling_detected,
                "laying_down": laying_detected,
                "fall": laying_detected or falling_detected,
                "timestamp": time.time(),
            },
            namespace="/",
        )

        if laying_detected:
            alert_payload = {
                "source": "ai_pose_detector",
                "alert_type": "laying_down",
                "trigger": "laying_down",
                "severity": "critical",
                "message": "LAYING DOWN DETECTED",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "detections": detections,
            }
            report_id = _persist_ai_alert(flask_app, patient_id, alert_payload)
            if report_id:
                alert_payload["report_id"] = report_id
            socketio.emit(
                "posture_alert",
                alert_payload,
                namespace="/",
            )
            print(f"[AI] 🚨 Laying down detected! {detections}")
        elif falling_detected:
            alert_payload = {
                "source": "ai_pose_detector",
                "alert_type": "falling",
                "trigger": "falling",
                "severity": "warning",
                "message": "FALLING DETECTED",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "detections": detections,
            }
            report_id = _persist_ai_alert(flask_app, patient_id, alert_payload)
            if report_id:
                alert_payload["report_id"] = report_id
            socketio.emit(
                "posture_alert",
                alert_payload,
                namespace="/",
            )
            print(f"[AI] ⚠️ Falling detected! {detections}")

    cap.release()
    print("[AI] Detection loop stopped.")


# ── Public API ────────────────────────────────────────────────────────────────

def start_stream(socketio, ip: str, flask_app=None, patient_id=None):
    global _thread, _running, _camera_url, _active_patient_id

    if _running:
        stop_stream()
        time.sleep(0.5)

    _camera_url = _build_url(ip)
    _active_patient_id = (patient_id or "").strip() or None
    _running = True

    _thread = threading.Thread(
        target=_detection_loop,
        args=(socketio, _camera_url, flask_app, _active_patient_id),
        daemon=True,
        name="ai-detection-thread",
    )
    _thread.start()
    print(f"[AI] Detection thread started for {_camera_url}")
    return {"status": "started", "url": _camera_url}


def stop_stream():
    global _running, _active_patient_id
    _running = False
    _active_patient_id = None
    return {"status": "stopped"}


def get_status():
    return {
        "running": _running,
        "url": _camera_url,
        "patient_id": _active_patient_id,
    }