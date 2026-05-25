class ActivityAnalyzer:
    def analyze(self, pose_result, last_motion_at=None):
        inactivity_detected = bool(pose_result.get("inactivity_detected"))
        suspicious_posture = bool(pose_result.get("suspicious_posture"))

        if pose_result.get("fall_detected"):
            return {
                "activity_state": "fall_detected",
                "severity": "critical",
            }

        if inactivity_detected:
            return {
                "activity_state": "inactive",
                "severity": "high",
            }

        if suspicious_posture:
            return {
                "activity_state": "suspicious",
                "severity": "medium",
            }

        return {
            "activity_state": "active",
            "severity": "low",
        }
