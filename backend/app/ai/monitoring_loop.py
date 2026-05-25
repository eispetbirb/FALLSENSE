import logging
import threading
import time

from app.extensions import db
from app.ai.activity_analyzer import ActivityAnalyzer
from app.ai.alert_generator import AlertGenerator
from app.ai.camera_capture import CameraCapture
from app.ai.pose_analyzer import PoseAnalyzer
from app.models.patient_status_model import PatientStatus
from app.services.caregiver_service import emit_patient_status

logger = logging.getLogger(__name__)


class CaregiverMonitoringLoop:
    def __init__(self, app, interval_seconds=5):
        self.app = app
        self.interval_seconds = interval_seconds
        self._running = False
        self._thread = None
        self.camera_capture = CameraCapture()
        self.pose_analyzer = PoseAnalyzer()
        self.activity_analyzer = ActivityAnalyzer()
        self.alert_generator = AlertGenerator()

    def start(self):
        if self._running:
            return

        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False

    def _run(self):
        with self.app.app_context():
            while self._running:
                try:
                    self.tick()
                except Exception as exc:  # pragma: no cover
                    logger.exception("Caregiver monitoring loop failed: %s", exc)
                time.sleep(self.interval_seconds)

    def tick(self):
        patient_statuses = PatientStatus.query.all()
        frame = None

        if self.camera_capture.capture is None:
            self.camera_capture.open()

        if self.camera_capture.capture is not None:
            frame = self.camera_capture.read_frame()

        pose_result = self.pose_analyzer.analyze_frame(frame)
        activity_result = self.activity_analyzer.analyze(pose_result)

        for patient_status in patient_statuses:
            patient_status.posture_state = pose_result.get("posture_state", patient_status.posture_state)
            patient_status.activity_state = activity_result.get("activity_state", patient_status.activity_state)
            patient_status.fall_detected = bool(pose_result.get("fall_detected"))
            patient_status.emergency_status = patient_status.fall_detected or patient_status.emergency_status
            db.session.commit()
            emit_patient_status({
                "patient_id": patient_status.patient_id,
                "patient_name": patient_status.patient_name,
                "online": patient_status.online,
                "fall_detected": patient_status.fall_detected,
                "emergency_status": patient_status.emergency_status,
                "activity_state": patient_status.activity_state,
                "camera_status": patient_status.camera_status,
                "posture_state": patient_status.posture_state,
                "last_activity_at": patient_status.last_activity_at.isoformat() if patient_status.last_activity_at else None,
            })
            self.alert_generator.generate(patient_status, activity_result)


_monitoring_loop = None


def start_monitoring_loop(app):
    global _monitoring_loop

    if _monitoring_loop is None:
        _monitoring_loop = CaregiverMonitoringLoop(app)
        _monitoring_loop.start()

    return _monitoring_loop
