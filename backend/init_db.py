"""Create all tables in Supabase and seed starter data.

Run from the backend folder:

    python init_db.py

This script is safe to rerun. It will not duplicate users, patients,
alerts, medications, incidents, or configuration rows.
"""

from pathlib import Path
import sys
from datetime import datetime, timedelta


BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))


from app import create_app
from app.extensions import bcrypt, db
from app.models.activity_log_model import ActivityLog
from app.models.alert_model import Alert
from app.models.camera_status_model import CameraStatus
from app.models.incident_report_model import IncidentReport
from app.models.medication_model import MedicationSchedule
from app.models.patient_status_model import PatientStatus
from app.models.security_event_model import SecurityEvent
from app.models.system_config_model import SystemConfig
from app.models.user_log_model import UserLog
from app.models.user_model import User


def make_password(raw_password: str) -> str:
    return bcrypt.generate_password_hash(raw_password).decode("utf-8")


def get_or_create_user(fullname: str, email: str, password: str, role: str) -> User:
    user = User.query.filter_by(email=email).first()
    if user:
        return user

    user = User(
        fullname=fullname,
        email=email,
        password_hash=make_password(password),
        role=role,
    )
    db.session.add(user)
    db.session.flush()
    return user


def get_or_create_patient(user_name: str, patient_id: str, room_label: str, **kwargs) -> PatientStatus:
    patient = PatientStatus.query.filter_by(patient_id=patient_id).first()
    if patient:
        for key, value in kwargs.items():
            setattr(patient, key, value)
        patient.patient_name = user_name
        patient.room_label = room_label
        return patient

    patient = PatientStatus(
        patient_id=patient_id,
        patient_name=user_name,
        room_label=room_label,
        **kwargs,
    )
    db.session.add(patient)
    db.session.flush()
    return patient


def get_or_create_camera(patient_id: str, **kwargs) -> CameraStatus:
    camera = CameraStatus.query.filter_by(patient_id=patient_id).first()
    if camera:
        for key, value in kwargs.items():
            setattr(camera, key, value)
        return camera

    camera = CameraStatus(patient_id=patient_id, **kwargs)
    db.session.add(camera)
    db.session.flush()
    return camera


def get_or_create_medication(patient_id: str, medicine_name: str, schedule_time: str, **kwargs) -> MedicationSchedule:
    medication = MedicationSchedule.query.filter_by(
        patient_id=patient_id,
        medicine_name=medicine_name,
        schedule_time=schedule_time,
    ).first()
    if medication:
        for key, value in kwargs.items():
            setattr(medication, key, value)
        return medication

    medication = MedicationSchedule(
        patient_id=patient_id,
        medicine_name=medicine_name,
        schedule_time=schedule_time,
        **kwargs,
    )
    db.session.add(medication)
    db.session.flush()
    return medication


def get_or_create_alert(patient_id: str, alert_type: str, message: str, **kwargs) -> Alert:
    alert = Alert.query.filter_by(type=alert_type, message=message).first()
    if alert:
        for key, value in kwargs.items():
            setattr(alert, key, value)
        return alert

    alert = Alert(type=alert_type, message=message, **kwargs)
    db.session.add(alert)
    db.session.flush()
    return alert


def get_or_create_incident(patient_id: str, incident_type: str, summary: str, **kwargs) -> IncidentReport:
    report = IncidentReport.query.filter_by(patient_id=patient_id, incident_type=incident_type, summary=summary).first()
    if report:
        for key, value in kwargs.items():
            setattr(report, key, value)
        return report

    report = IncidentReport(patient_id=patient_id, incident_type=incident_type, summary=summary, **kwargs)
    db.session.add(report)
    db.session.flush()
    return report


def seed_database() -> None:
    db.create_all()

    admin = get_or_create_user("System Admin", "admin@test.com", "admin123", "admin")
    caregiver = get_or_create_user("Primary Caregiver", "caregiver@test.com", "caregiver123", "caregiver")
    patient_a = get_or_create_user("Patient One", "patient1@test.com", "patient123", "patient")
    patient_b = get_or_create_user("Patient Two", "patient2@test.com", "patient123", "patient")

    now = datetime.utcnow()

    patient_one = get_or_create_patient(
        user_name="Patient One",
        patient_id=patient_a.id,
        room_label="Room 101",
        online=True,
        fall_detected=False,
        emergency_status=False,
        activity_state="active",
        camera_status="connected",
        posture_state="upright",
        stream_url="https://example.com/streams/patient-1",
        last_activity_at=now - timedelta(minutes=5),
    )

    patient_two = get_or_create_patient(
        user_name="Patient Two",
        patient_id=patient_b.id,
        room_label="Room 102",
        online=True,
        fall_detected=True,
        emergency_status=True,
        activity_state="fall_detected",
        camera_status="reconnecting",
        posture_state="fallen",
        stream_url="https://example.com/streams/patient-2",
        last_activity_at=now - timedelta(minutes=12),
    )

    get_or_create_camera(
        patient_id=patient_one.patient_id,
        stream_url="https://example.com/streams/patient-1",
        health_state="online",
        reconnect_count=0,
        fullscreen_supported=True,
    )

    get_or_create_camera(
        patient_id=patient_two.patient_id,
        stream_url="https://example.com/streams/patient-2",
        health_state="warning",
        reconnect_count=2,
        fullscreen_supported=True,
    )

    get_or_create_medication(
        patient_id=patient_one.patient_id,
        medicine_name="Amlodipine",
        schedule_time="08:00 AM",
        dosage="5 mg",
        status="pending",
        reminder_badge="normal",
    )

    get_or_create_medication(
        patient_id=patient_two.patient_id,
        medicine_name="Metformin",
        schedule_time="08:00 PM",
        dosage="500 mg",
        status="missed",
        reminder_badge="warning",
    )

    get_or_create_alert(
        patient_id=patient_two.patient_id,
        alert_type="fall",
        message="Possible fall detected in Room 102",
        severity="critical",
        status="new",
        source="camera",
    )

    get_or_create_alert(
        patient_id=patient_one.patient_id,
        alert_type="inactivity",
        message="Patient inactive for 20 minutes",
        severity="high",
        status="acknowledged",
        source="monitoring",
        acknowledged_by=caregiver.id,
        acknowledged_at=now - timedelta(minutes=3),
    )

    get_or_create_incident(
        patient_id=patient_two.patient_id,
        incident_type="fall",
        summary="Patient reported a fall near the bed",
        severity="critical",
        resolved=False,
    )

    get_or_create_incident(
        patient_id=patient_one.patient_id,
        incident_type="sos",
        summary="SOS button pressed during medication round",
        severity="high",
        resolved=True,
        acknowledged_by=caregiver.id,
        resolved_by=caregiver.id,
    )

    if not SystemConfig.query.get(1):
        db.session.add(SystemConfig(id=1))

    if ActivityLog.query.count() == 0:
        db.session.add_all([
            ActivityLog(
                user_id=admin.id,
                action="bootstrap_admin_created",
                status="success",
                ip_address="127.0.0.1",
                user_agent="init_db.py",
            ),
            ActivityLog(
                user_id=caregiver.id,
                action="bootstrap_caregiver_created",
                status="success",
                ip_address="127.0.0.1",
                user_agent="init_db.py",
            ),
        ])

    if UserLog.query.count() == 0:
        db.session.add_all([
            UserLog(
                user_id=admin.id,
                action="bootstrap_admin_created",
                status="success",
                ip_address="127.0.0.1",
                user_agent="init_db.py",
            ),
            UserLog(
                user_id=caregiver.id,
                action="bootstrap_caregiver_created",
                status="success",
                ip_address="127.0.0.1",
                user_agent="init_db.py",
            ),
        ])

    if SecurityEvent.query.count() == 0:
        db.session.add(SecurityEvent(
            user_id=admin.id,
            event_type="bootstrap_complete",
            severity="low",
            risk_score=0,
            message="Database bootstrap completed successfully",
            event_metadata={"seed": True},
        ))

    db.session.commit()

    print("Database tables created and seeded successfully.")
    print("Admin login: admin@test.com / admin123")
    print("Caregiver login: caregiver@test.com / caregiver123")
    print("Patient demo logins: patient1@test.com / patient123, patient2@test.com / patient123")


if __name__ == "__main__":
    app = create_app()
    with app.app_context():
        seed_database()