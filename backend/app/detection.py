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


def _detection_loop(socketio, url: str):
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
    FRAME_SKIP = 4

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
        frame = cv2.resize(frame, (640, 640))
        results = model(frame, imgsz=320, verbose=False)[0]

        fall_detected = False
        detections = []

        for box in results.boxes:
            conf = float(box.conf[0])
            cls_id = int(box.cls[0])
            label = model.names[cls_id]
            x1, y1, x2, y2 = map(int, box.xyxy[0])

            is_fall = "fall" in label.lower()
            color = (0, 0, 255) if is_fall else (0, 255, 0)

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

            if is_fall and conf >= CONF_THRESHOLD:
                fall_detected = True

        # ── Encode frame → base64 JPEG ────────────────────────────────────────
        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 40])
        frame_b64 = base64.b64encode(buffer).decode("utf-8")

        # ── Emit annotated frame to all connected clients ─────────────────────
        socketio.emit(
            "frame",
            {
                "image": frame_b64,
                "detections": detections,
                "fall": fall_detected,
                "timestamp": time.time(),
            },
            namespace="/",
        )

        if fall_detected:
            socketio.emit(
                "fall_alert",
                {
                    "message": "⚠️ FALL DETECTED",
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "detections": detections,
                },
                namespace="/",
            )
            print(f"[AI] 🚨 Fall detected! {detections}")

    cap.release()
    print("[AI] Detection loop stopped.")


# ── Public API ────────────────────────────────────────────────────────────────

def start_stream(socketio, ip: str):
    global _thread, _running, _camera_url

    if _running:
        stop_stream()
        time.sleep(0.5)

    _camera_url = _build_url(ip)
    _running = True

    _thread = threading.Thread(
        target=_detection_loop,
        args=(socketio, _camera_url),
        daemon=True,
        name="ai-detection-thread",
    )
    _thread.start()
    print(f"[AI] Detection thread started for {_camera_url}")
    return {"status": "started", "url": _camera_url}


def stop_stream():
    global _running
    _running = False
    return {"status": "stopped"}


def get_status():
    return {
        "running": _running,
        "url": _camera_url,
    }