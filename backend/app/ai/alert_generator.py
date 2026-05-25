from datetime import datetime

from app.services.caregiver_service import create_incident_report
from app.services.realtime_service import emit_alert


class AlertGenerator:
    def generate(self, patient_status, analysis):
        severity = analysis.get("severity", "medium")
        activity_state = analysis.get("activity_state", "active")

        if severity in {"low", "medium"} and activity_state == "active":
            return None

        message = f"{patient_status.patient_name}: {activity_state.replace('_', ' ')}"
        payload = {
            "patient_id": patient_status.patient_id,
            "type": activity_state,
            "severity": severity,
            "message": message,
            "created_at": datetime.utcnow().isoformat() + "Z",
        }
        emit_alert(payload)
        create_incident_report(
            patient_id=patient_status.patient_id,
            incident_type=activity_state,
            severity=severity,
            summary=message,
            payload=payload,
        )
        return payload
