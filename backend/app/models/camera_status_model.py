import uuid

from app.extensions import db


class CameraStatus(db.Model):
    __tablename__ = "camera_status"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    patient_id = db.Column(db.String(36), unique=True, nullable=False, index=True)
    stream_url = db.Column(db.Text)
    health_state = db.Column(db.String(30), default="offline", nullable=False)
    reconnect_count = db.Column(db.Integer, default=0, nullable=False)
    fullscreen_supported = db.Column(db.Boolean, default=True, nullable=False)
    updated_at = db.Column(db.DateTime, server_default=db.func.now(), onupdate=db.func.now())