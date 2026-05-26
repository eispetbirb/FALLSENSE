import logging
from datetime import datetime

from app.extensions import db, socketio
from app.models.alert_model import Alert
from app.models.camera_status_model import CameraStatus
from app.models.incident_report_model import IncidentReport
from app.models.medication_model import MedicationSchedule

logger = logging.getLogger(__name__)


def serialize_dt(value):
    return value.isoformat() if value else None


def emit_caregiver_event(event_name, payload):
    socketio.emit(event_name, payload)


def emit_caregiver_alert(payload):
    emit_caregiver_event("caregiver_alert", payload)
    emit_caregiver_event("new_alert", payload)


def emit_patient_status(payload):
    emit_caregiver_event("patient_status_updated", payload)


def emit_medication_update(payload):
    emit_caregiver_event("medication_updated", payload)


def emit_incident_update(payload):
    emit_caregiver_event("incident_updated", payload)


def get_camera_health_summary(patient_id=None):
    query = CameraStatus.query
    if patient_id:
        query = query.filter_by(patient_id=patient_id)

    rows = query.all()
    stream = rows[0] if rows else None

    return {
        "camera_health": stream.health_state if stream else "offline",
        "stream_url": stream.stream_url if stream else None,
        "reconnect_count": stream.reconnect_count if stream else 0,
        "fullscreen_supported": True,
        "last_checked_at": datetime.utcnow().isoformat() + "Z",
    }


def acknowledge_alert(alert, caregiver_id):
    alert.status = "acknowledged"
    alert.acknowledged_by = caregiver_id
    alert.acknowledged_at = datetime.utcnow()
    db.session.commit()

    payload = {
        "id": alert.id,
        "status": getattr(alert, "status", "acknowledged"),
        "acknowledged_by": caregiver_id,
        "updated_at": serialize_dt(alert.acknowledged_at),
    }
    emit_caregiver_alert(payload)
    return alert


def resolve_alert(alert, caregiver_id):
    alert.status = "resolved"
    alert.resolved_by = caregiver_id
    alert.resolved_at = datetime.utcnow()
    db.session.commit()

    payload = {
        "id": alert.id,
        "status": getattr(alert, "status", "resolved"),
        "resolved_by": caregiver_id,
        "updated_at": serialize_dt(alert.resolved_at),
    }
    emit_caregiver_alert(payload)
    return alert


def mark_medication_status(schedule, status, note=None):
    now = datetime.utcnow()
    schedule.status = status
    schedule.adherence_note = note
    if status == "taken":
        schedule.taken_at = now
    elif status == "missed":
        schedule.missed_at = now
    db.session.commit()

    emit_medication_update({
        "id": schedule.id,
        "status": schedule.status,
        "updated_at": now.isoformat() + "Z",
    })
    return schedule


def create_incident_report(patient_id, incident_type, severity, summary, payload=None):
    report = IncidentReport(
        patient_id=patient_id,
        incident_type=incident_type,
        severity=severity,
        summary=summary,
        export_payload=payload or {},
    )
    db.session.add(report)
    db.session.commit()

    emit_incident_update({
        "id": report.id,
        "patient_id": report.patient_id,
        "incident_type": report.incident_type,
        "severity": report.severity,
        "summary": report.summary,
        "created_at": serialize_dt(report.created_at),
    })
    return report