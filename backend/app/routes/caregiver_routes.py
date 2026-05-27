from csv import writer
from datetime import datetime
from io import StringIO
import uuid

from flask import Blueprint, Response, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity

from app.extensions import db
from app.middleware.role_middleware import role_required
from app.models.activity_log_model import ActivityLog
from app.models.alert_model import Alert
from app.models.incident_report_model import IncidentReport
from app.models.medication_model import MedicationSchedule
from app.models.patient_status_model import PatientStatus
from app.models.security_event_model import SecurityEvent
from app.models.camera_status_model import CameraStatus
from app.services.caregiver_service import (
    acknowledge_alert,
    get_camera_health_summary,
    mark_medication_status,
    resolve_alert,
)
from app.services.realtime_service import emit_activity
from app.extensions import socketio


caregiver_bp = Blueprint("caregiver", __name__)


def serialize_patient_status(status):
    return {
        "id": status.id,
        "patient_id": status.patient_id,
        "patient_name": status.patient_name,
        "room_label": status.room_label,
        "online": status.online,
        "fall_detected": status.fall_detected,
        "emergency_status": status.emergency_status,
        "activity_state": status.activity_state,
        "camera_status": status.camera_status,
        "posture_state": status.posture_state,
        "stream_url": status.stream_url,
        "last_activity_at": status.last_activity_at.isoformat() if status.last_activity_at else None,
        "updated_at": status.updated_at.isoformat() if status.updated_at else None,
    }


def serialize_alert(alert):
    return {
        "id": alert.id,
        "type": alert.type,
        "severity": alert.severity,
        "message": alert.message,
        "status": getattr(alert, "status", "new"),
        "source": getattr(alert, "source", "monitoring"),
        "acknowledged_by": getattr(alert, "acknowledged_by", None),
        "acknowledged_at": getattr(alert, "acknowledged_at", None).isoformat() if getattr(alert, "acknowledged_at", None) else None,
        "resolved_by": getattr(alert, "resolved_by", None),
        "resolved_at": getattr(alert, "resolved_at", None).isoformat() if getattr(alert, "resolved_at", None) else None,
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
    }


def serialize_medication(schedule):
    return {
        "id": schedule.id,
        "patient_id": schedule.patient_id,
        "medicine_name": schedule.medicine_name,
        "dosage": schedule.dosage,
        "schedule_time": schedule.schedule_time,
        "status": schedule.status,
        "reminder_badge": schedule.reminder_badge,
        "taken_at": schedule.taken_at.isoformat() if schedule.taken_at else None,
        "missed_at": schedule.missed_at.isoformat() if schedule.missed_at else None,
        "adherence_note": schedule.adherence_note,
        "updated_at": schedule.updated_at.isoformat() if schedule.updated_at else None,
    }


def serialize_incident(report):
    return {
        "id": report.id,
        "patient_id": report.patient_id,
        "incident_type": report.incident_type,
        "severity": report.severity,
        "summary": report.summary,
        "resolved": report.resolved,
        "occurred_at": report.occurred_at.isoformat() if report.occurred_at else None,
        "acknowledged_by": report.acknowledged_by,
        "resolved_by": report.resolved_by,
        "created_at": report.created_at.isoformat() if report.created_at else None,
        "export_payload": report.export_payload or {},
    }


def serialize_log_entry(entry, entry_type):
    if entry_type == "activity":
        return {
            "id": entry.id,
            "type": "activity",
            "label": entry.action,
            "status": entry.status,
            "severity": None,
            "created_at": entry.created_at.isoformat() if entry.created_at else None,
            "meta": {"user_id": entry.user_id, "ip_address": entry.ip_address},
        }

    if entry_type == "security_event":
        return {
            "id": entry.id,
            "type": "security_event",
            "label": entry.event_type,
            "status": entry.severity,
            "severity": entry.severity,
            "created_at": entry.created_at.isoformat() if entry.created_at else None,
            "meta": {"risk_score": entry.risk_score, "message": entry.message},
        }

    return {
        "id": entry.id,
        "type": "incident",
        "label": entry.incident_type,
        "status": "resolved" if entry.resolved else "open",
        "severity": entry.severity,
        "created_at": entry.occurred_at.isoformat() if entry.occurred_at else None,
        "meta": {
            "patient_id": entry.patient_id,
            "summary": entry.summary,
            "source": (entry.export_payload or {}).get("source"),
            "trigger": (entry.export_payload or {}).get("trigger"),
            "alert_type": (entry.export_payload or {}).get("alert_type"),
            "detections": (entry.export_payload or {}).get("detections") or [],
            "export_payload": entry.export_payload or {},
        },
    }


@caregiver_bp.route("/patients/status", methods=["GET"])
@role_required(["caregiver"])
def get_patient_statuses():
    caregiver_id = get_jwt_identity()
    statuses = (
        PatientStatus.query
        .filter_by(caregiver_id=caregiver_id)
        .order_by(PatientStatus.updated_at.desc())
        .all()
    )
    return jsonify([serialize_patient_status(status) for status in statuses])


@caregiver_bp.route("/patients", methods=["POST"])
@role_required(["caregiver"])
def create_patient():
    caregiver_id = get_jwt_identity()
    current_count = PatientStatus.query.filter_by(caregiver_id=caregiver_id).count()
    if current_count >= 3:
        return jsonify({"message": "Patient limit reached. Caregiver can only manage up to 3 patients."}), 400

    data = request.get_json() or {}
    patient_name = (data.get("patient_name") or "").strip()
    room_label = (data.get("room_label") or "").strip()

    if not patient_name:
        return jsonify({"message": "patient_name is required"}), 400

    try:
        patient = PatientStatus(
            patient_id=f"patient-{str(uuid.uuid4())[:8]}",
            patient_name=patient_name,
            room_label=room_label or "Unassigned room",
            caregiver_id=caregiver_id,
            online=False,
            fall_detected=False,
            emergency_status=False,
            activity_state="inactive",
            camera_status="disconnected",
            posture_state="unknown",
        )
        db.session.add(patient)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"message": f"Unable to create patient: {exc}"}), 500

    socketio.emit("patient_status_updated", serialize_patient_status(patient), namespace="/")

    emit_activity({
        "user_id": get_jwt_identity(),
        "action": "caregiver_create_patient",
        "status": "success",
        "patient_id": patient.patient_id,
        "created_at": datetime.utcnow().isoformat(),
    })

    return jsonify(serialize_patient_status(patient)), 201


@caregiver_bp.route("/patients/<patient_id>", methods=["PUT"])
@role_required(["caregiver"])
def update_patient(patient_id):
    caregiver_id = get_jwt_identity()
    patient = PatientStatus.query.filter_by(patient_id=patient_id, caregiver_id=caregiver_id).first()
    if not patient:
        return jsonify({"message": "Patient not found or not owned by you"}), 404

    data = request.get_json() or {}
    patient_name = (data.get("patient_name") or "").strip()
    room_label = (data.get("room_label") or "").strip()

    if not patient_name:
        return jsonify({"message": "patient_name is required"}), 400

    try:
        patient.patient_name = patient_name
        patient.room_label = room_label or "Unassigned room"
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"message": f"Unable to update patient: {exc}"}), 500

    payload = serialize_patient_status(patient)
    socketio.emit("patient_status_updated", payload, namespace="/")

    emit_activity({
        "user_id": get_jwt_identity(),
        "action": "caregiver_update_patient",
        "status": "success",
        "patient_id": patient.patient_id,
        "updated_at": datetime.utcnow().isoformat(),
    })

    return jsonify(payload)


@caregiver_bp.route("/patients/<patient_id>", methods=["DELETE"])
@role_required(["caregiver"])
def delete_patient(patient_id):
    caregiver_id = get_jwt_identity()
    patient = PatientStatus.query.filter_by(patient_id=patient_id, caregiver_id=caregiver_id).first()
    if not patient:
        return jsonify({"message": "Patient not found or not owned by you"}), 404

    try:
        medication_count = MedicationSchedule.query.filter_by(patient_id=patient_id).delete(synchronize_session=False)
        camera_count = CameraStatus.query.filter_by(patient_id=patient_id).delete(synchronize_session=False)
        incident_count = IncidentReport.query.filter_by(patient_id=patient_id).delete(synchronize_session=False)

        db.session.delete(patient)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        return jsonify({"message": f"Unable to remove patient: {exc}"}), 500

    socketio.emit(
        "patient_status_updated",
        {"patient_id": patient_id, "id": patient.id, "deleted": True},
        namespace="/",
    )

    emit_activity({
        "user_id": get_jwt_identity(),
        "action": "caregiver_delete_patient",
        "status": "success",
        "patient_id": patient_id,
        "medications_removed": medication_count,
        "camera_records_removed": camera_count,
        "incident_reports_removed": incident_count,
        "deleted_at": datetime.utcnow().isoformat(),
    })

    return jsonify({
        "message": "Patient removed successfully",
        "patient_id": patient_id,
    })


@caregiver_bp.route("/alerts", methods=["GET"])
@role_required(["caregiver"])
def get_alerts():
    caregiver_id = get_jwt_identity()
    alerts = (
        Alert.query
        .filter((Alert.user_id == caregiver_id) | (Alert.user_id.is_(None)))
        .order_by(Alert.created_at.desc())
        .limit(200)
        .all()
    )
    return jsonify([serialize_alert(alert) for alert in alerts])


@caregiver_bp.route("/alerts/<alert_id>/acknowledge", methods=["PUT"])
@role_required(["caregiver"])
def acknowledge_alert_route(alert_id):
    alert = Alert.query.get(alert_id)
    if not alert:
        return jsonify({"message": "Alert not found"}), 404

    caregiver_id = get_jwt_identity()
    if alert.user_id and alert.user_id != caregiver_id:
        return jsonify({"message": "Alert not found or not owned by you"}), 403

    acknowledge_alert(alert, caregiver_id)
    return jsonify(serialize_alert(alert))


@caregiver_bp.route("/alerts/<alert_id>/resolve", methods=["PUT"])
@role_required(["caregiver"])
def resolve_alert_route(alert_id):
    alert = Alert.query.get(alert_id)
    if not alert:
        return jsonify({"message": "Alert not found"}), 404

    caregiver_id = get_jwt_identity()
    if alert.user_id and alert.user_id != caregiver_id:
        return jsonify({"message": "Alert not found or not owned by you"}), 403

    resolve_alert(alert, caregiver_id)
    return jsonify(serialize_alert(alert))


@caregiver_bp.route("/monitoring/camera-status", methods=["GET"])
@role_required(["caregiver"])
def camera_status():
    patient_id = request.args.get("patient_id")
    
    query = PatientStatus.query
    if patient_id:
        query = query.filter_by(patient_id=patient_id)
    
    patient = query.first()
    
    if not patient:
        return jsonify({
            "camera_health": "offline",
            "stream_url": None,
            "reconnect_count": 0,
            "fullscreen_supported": True,
            "last_checked_at": datetime.utcnow().isoformat() + "Z",
        })
    
    return jsonify({
        "camera_health": "online" if patient.stream_url else "offline",
        "stream_url": patient.stream_url,
        "patient_id": patient.patient_id,
        "patient_name": patient.patient_name,
        "reconnect_count": 0,
        "fullscreen_supported": True,
        "last_checked_at": datetime.utcnow().isoformat() + "Z",
    })


@caregiver_bp.route("/logs", methods=["GET"])
@role_required(["caregiver"])
def get_logs():
    query_text = (request.args.get("q") or "").strip().lower()
    log_type = (request.args.get("type") or "all").strip().lower()
    page = max(1, int(request.args.get("page", 1)))
    page_size = min(100, max(1, int(request.args.get("page_size", 20))))

    activity_logs = ActivityLog.query.order_by(ActivityLog.created_at.desc()).limit(250).all()
    security_events = SecurityEvent.query.order_by(SecurityEvent.created_at.desc()).limit(250).all()
    incident_reports = IncidentReport.query.order_by(IncidentReport.occurred_at.desc()).limit(250).all()

    entries = [
        *[serialize_log_entry(item, "activity") for item in activity_logs],
        *[serialize_log_entry(item, "security_event") for item in security_events],
        *[serialize_log_entry(item, "incident") for item in incident_reports],
    ]

    if log_type != "all":
        entries = [entry for entry in entries if entry["type"] == log_type]

    if query_text:
        entries = [
            entry for entry in entries
            if query_text in (entry.get("label") or "").lower()
            or query_text in (entry.get("type") or "").lower()
            or query_text in (entry.get("severity") or "").lower()
        ]

    start = (page - 1) * page_size
    end = start + page_size

    return jsonify({
        "items": entries[start:end],
        "page": page,
        "page_size": page_size,
        "total": len(entries),
    })


@caregiver_bp.route("/medications", methods=["GET"])
@role_required(["caregiver"])
def get_medications():
    schedules = MedicationSchedule.query.order_by(MedicationSchedule.updated_at.desc()).all()
    return jsonify([serialize_medication(schedule) for schedule in schedules])


@caregiver_bp.route("/medications", methods=["POST"])
@role_required(["caregiver"])
def create_medication_schedule():
    data = request.get_json() or {}

    patient_id = (data.get("patient_id") or "").strip()
    medicine_name = (data.get("medicine_name") or "").strip()
    dosage = (data.get("dosage") or "").strip()
    schedule_time = (data.get("schedule_time") or "").strip()

    if not patient_id:
        return jsonify({"message": "patient_id is required"}), 400
    if not medicine_name:
        return jsonify({"message": "medicine_name is required"}), 400
    if not dosage:
        return jsonify({"message": "dosage is required"}), 400
    if not schedule_time:
        return jsonify({"message": "schedule_time is required"}), 400

    schedule = MedicationSchedule(
        patient_id=patient_id,
        medicine_name=medicine_name,
        dosage=dosage,
        schedule_time=schedule_time,
        status="pending",
        reminder_badge=(data.get("reminder_badge") or "normal"),
        adherence_note=data.get("note"),
    )
    db.session.add(schedule)
    db.session.commit()

    socketio.emit("medication_updated", {"id": schedule.id}, namespace="/")
    emit_activity({
        "user_id": get_jwt_identity(),
        "action": "caregiver_create_medication_schedule",
        "status": "success",
        "created_at": datetime.utcnow().isoformat(),
        "meta": {
            "medication_id": schedule.id,
            "patient_id": schedule.patient_id,
        },
    })

    return jsonify(serialize_medication(schedule)), 201


@caregiver_bp.route("/medications/<medication_id>", methods=["DELETE"])
@role_required(["caregiver"])
def delete_medication_schedule(medication_id):
    schedule = MedicationSchedule.query.get(medication_id)
    if not schedule:
        return jsonify({"message": "Medication schedule not found"}), 404

    db.session.delete(schedule)
    db.session.commit()

    socketio.emit("medication_updated", {"id": medication_id, "deleted": True}, namespace="/")
    emit_activity({
        "user_id": get_jwt_identity(),
        "action": "caregiver_delete_medication_schedule",
        "status": "success",
        "created_at": datetime.utcnow().isoformat(),
        "meta": {"medication_id": medication_id},
    })

    return jsonify({"message": "Deleted"})


@caregiver_bp.route("/medications/<medication_id>/status", methods=["PUT"])
@role_required(["caregiver"])
def update_medication_status(medication_id):
    schedule = MedicationSchedule.query.get(medication_id)
    if not schedule:
        return jsonify({"message": "Medication schedule not found"}), 404

    data = request.get_json() or {}
    status = (data.get("status") or "taken").strip().lower()
    if status not in {"taken", "missed", "pending"}:
        return jsonify({"message": "Invalid medication status"}), 400

    mark_medication_status(schedule, status, note=data.get("note"))
    return jsonify(serialize_medication(schedule))


@caregiver_bp.route("/reports/incidents", methods=["GET"])
@role_required(["caregiver"])
def incident_reports():
    severity = (request.args.get("severity") or "").strip().lower()
    incident_type = (request.args.get("type") or "").strip().lower()
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    export_format = (request.args.get("format") or "json").strip().lower()

    query = IncidentReport.query
    if severity:
        query = query.filter(db.func.lower(IncidentReport.severity) == severity)
    if incident_type:
        query = query.filter(db.func.lower(IncidentReport.incident_type) == incident_type)
    if start_date:
        query = query.filter(IncidentReport.occurred_at >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.filter(IncidentReport.occurred_at <= datetime.fromisoformat(end_date))

    reports = query.order_by(IncidentReport.occurred_at.desc()).all()

    if export_format == "csv":
        output = StringIO()
        csv_writer = writer(output)
        csv_writer.writerow(["id", "patient_id", "incident_type", "severity", "summary", "occurred_at", "resolved"])
        for report in reports:
            csv_writer.writerow([
                report.id,
                report.patient_id,
                report.incident_type,
                report.severity,
                report.summary,
                report.occurred_at.isoformat() if report.occurred_at else "",
                report.resolved,
            ])

        response = Response(output.getvalue(), mimetype="text/csv")
        response.headers["Content-Disposition"] = "attachment; filename=incident-reports.csv"
        return response

    if export_format == "pdf-structure":
        return jsonify({
            "title": "Incident Reports",
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "columns": ["id", "patient_id", "incident_type", "severity", "summary", "occurred_at", "resolved"],
            "rows": [serialize_incident(report) for report in reports],
        })

    return jsonify({
        "items": [serialize_incident(report) for report in reports],
        "filters": {
            "severity": severity or None,
            "type": incident_type or None,
            "start_date": start_date,
            "end_date": end_date,
        },
        "count": len(reports),
    })


@caregiver_bp.route("/quick-actions/refresh", methods=["POST"])
@role_required(["caregiver"])
def refresh_monitoring_state():
    emit_activity({
        "user_id": get_jwt_identity(),
        "action": "caregiver_refresh_monitoring_state",
        "status": "success",
        "created_at": datetime.utcnow().isoformat(),
    })
    return jsonify({"message": "Monitoring state refreshed"})


@caregiver_bp.route("/camera/configure", methods=["POST"])
@role_required(["caregiver"])
def configure_camera_stream():
    data = request.get_json() or {}
    patient_id = data.get("patient_id")
    stream_url = data.get("stream_url", "").strip()

    if not patient_id:
        return jsonify({"message": "patient_id is required"}), 400

    caregiver_id = get_jwt_identity()
    patient = PatientStatus.query.filter_by(patient_id=patient_id, caregiver_id=caregiver_id).first()
    if not patient:
        return jsonify({"message": "Patient not found or not owned by you"}), 404

    patient.stream_url = stream_url if stream_url else None
    if stream_url:
        patient.camera_status = "online"
    else:
        patient.camera_status = "disconnected"

    db.session.commit()

    socketio.emit(
        "patient_status_updated",
        {
            "patient_id": patient_id,
            "stream_url": stream_url,
            "camera_status": patient.camera_status,
            "updated_by": get_jwt_identity(),
        },
        namespace="/",
    )

    emit_activity({
        "user_id": get_jwt_identity(),
        "action": "configure_camera_stream",
        "patient_id": patient_id,
        "status": "success",
        "created_at": datetime.utcnow().isoformat(),
    })

    return jsonify({
        "status": "configured",
        "patient_id": patient_id,
        "stream_url": stream_url,
        "camera_status": patient.camera_status,
    })


# ── AI Stream Routes ───────────────────────────────────────────────────────────
# These wire the frontend "Set URL" button to detection.py (best.pt inference).
# Frames are emitted back to the browser via Socket.IO "frame" events.

@caregiver_bp.route("/stream/start", methods=["POST"])
@role_required(["caregiver"])
def stream_start():
    from app.detection import start_stream

    data = request.get_json() or {}
    ip = (data.get("ip") or "").strip()
    patient_id = (data.get("patient_id") or "").strip()

    if not ip:
        return jsonify({"error": "ip is required"}), 400

    # Persist stream URL on the patient record (same as configure_camera_stream)
    if patient_id:
        caregiver_id = get_jwt_identity()
        patient = PatientStatus.query.filter_by(patient_id=patient_id, caregiver_id=caregiver_id).first()
        if patient:
            patient.stream_url = ip
            patient.camera_status = "online"
            db.session.commit()

    result = start_stream(
        socketio,
        ip,
        flask_app=current_app._get_current_object(),
        patient_id=patient_id,
    )
    print(f"[AI] stream/start called — {result}")
    return jsonify(result)


@caregiver_bp.route("/stream/stop", methods=["POST"])
@role_required(["caregiver"])
def stream_stop():
    from app.detection import stop_stream
    return jsonify(stop_stream())


@caregiver_bp.route("/stream/status", methods=["GET"])
@role_required(["caregiver"])
def stream_status():
    from app.detection import get_status
    return jsonify(get_status())