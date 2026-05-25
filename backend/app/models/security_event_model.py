import uuid

from app.extensions import db


class SecurityEvent(db.Model):
    __tablename__ = "security_events"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), index=True)
    event_type = db.Column(db.String(100), index=True)
    severity = db.Column(db.String(20), index=True)
    risk_score = db.Column(db.Integer, default=0)
    message = db.Column(db.Text)
    event_metadata = db.Column("metadata", db.JSON, default=dict)
    created_at = db.Column(db.DateTime, server_default=db.func.now(), index=True)