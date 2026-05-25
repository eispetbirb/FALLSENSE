import uuid

from app.extensions import db


class MedicationSchedule(db.Model):
    __tablename__ = "medication_schedules"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    patient_id = db.Column(db.String(36), index=True, nullable=False)
    medicine_name = db.Column(db.String(120), nullable=False)
    dosage = db.Column(db.String(120), nullable=False)
    schedule_time = db.Column(db.String(50), nullable=False)
    status = db.Column(db.String(30), default="pending", nullable=False, index=True)
    reminder_badge = db.Column(db.String(30), default="normal", nullable=False)
    taken_at = db.Column(db.DateTime, nullable=True)
    missed_at = db.Column(db.DateTime, nullable=True)
    adherence_note = db.Column(db.Text)
    updated_at = db.Column(db.DateTime, server_default=db.func.now(), onupdate=db.func.now())