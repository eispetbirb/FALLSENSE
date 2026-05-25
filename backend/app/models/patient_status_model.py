import uuid

from app.extensions import db


class PatientStatus(db.Model):
    __tablename__ = "patient_status"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    patient_id = db.Column(db.String(36), unique=True, nullable=False, index=True)
    patient_name = db.Column(db.String(120), nullable=False)
    room_label = db.Column(db.String(50))
    online = db.Column(db.Boolean, default=False, nullable=False)
    fall_detected = db.Column(db.Boolean, default=False, nullable=False)
    emergency_status = db.Column(db.Boolean, default=False, nullable=False)
    activity_state = db.Column(db.String(30), default="active", nullable=False)
    camera_status = db.Column(db.String(30), default="disconnected", nullable=False)
    posture_state = db.Column(db.String(50), default="upright", nullable=False)
    stream_url = db.Column(db.Text)
    last_activity_at = db.Column(db.DateTime, nullable=True)
    updated_at = db.Column(db.DateTime, server_default=db.func.now(), onupdate=db.func.now())