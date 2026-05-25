import logging

logger = logging.getLogger(__name__)

try:
    import mediapipe as mp  # type: ignore
except Exception:  # pragma: no cover
    mp = None


class PoseAnalyzer:
    def __init__(self):
        self.enabled = mp is not None

    def analyze_frame(self, frame):
        if not self.enabled or frame is None:
            return {
                "posture_state": "unknown",
                "fall_detected": False,
                "suspicious_posture": False,
                "inactivity_detected": False,
            }

        return {
            "posture_state": "upright",
            "fall_detected": False,
            "suspicious_posture": False,
            "inactivity_detected": False,
        }
