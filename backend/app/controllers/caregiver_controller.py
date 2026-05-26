from app.models.alert_model import Alert
from app.models.incident_report_model import IncidentReport
from app.models.medication_model import MedicationSchedule
from app.models.patient_status_model import PatientStatus
from app.services.caregiver_service import acknowledge_alert, get_camera_health_summary, mark_medication_status, resolve_alert


class CaregiverController:
    @staticmethod
    def patient_status_snapshot():
        return [
            {
                "id": patient.id,
                "patient_id": patient.patient_id,
                "patient_name": patient.patient_name,
                "online": patient.online,
                "fall_detected": patient.fall_detected,
            }
            for patient in PatientStatus.query.all()
        ]

    @staticmethod
    def alert_feed():
        return [
            {
                "id": alert.id,
                "type": alert.type,
                "severity": alert.severity,
                "message": alert.message,
                "status": getattr(alert, "status", "new"),
            }
            for alert in Alert.query.order_by(Alert.created_at.desc()).all()
        ]

    @staticmethod
    def acknowledge_alert(alert_id, caregiver_id):
        alert = Alert.query.get(alert_id)
        if not alert:
            return None
        return acknowledge_alert(alert, caregiver_id)

    @staticmethod
    def resolve_alert(alert_id, caregiver_id):
        alert = Alert.query.get(alert_id)
        if not alert:
            return None
        return resolve_alert(alert, caregiver_id)

    @staticmethod
    def camera_status(patient_id=None):
        return get_camera_health_summary(patient_id=patient_id)

    @staticmethod
    def medication_status(medication_id, status, note=None):
        schedule = MedicationSchedule.query.get(medication_id)
        if not schedule:
            return None
        return mark_medication_status(schedule, status, note=note)

    @staticmethod
    def incident_reports():
        return [
            {
                "id": report.id,
                "patient_id": report.patient_id,
                "incident_type": report.incident_type,
                "severity": report.severity,
                "summary": report.summary,
                "resolved": report.resolved,
            }
            for report in IncidentReport.query.order_by(IncidentReport.occurred_at.desc()).all()
        ]