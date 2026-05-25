import uuid

from app.extensions import db


class IncidentReport(db.Model):
    __tablename__ = "incident_reports"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    patient_id = db.Column(db.String(36), index=True, nullable=False)
    incident_type = db.Column(db.String(50), nullable=False, index=True)
    severity = db.Column(db.String(20), default="medium", nullable=False, index=True)
    summary = db.Column(db.Text, nullable=False)
    resolved = db.Column(db.Boolean, default=False, nullable=False)
    occurred_at = db.Column(db.DateTime, nullable=False, server_default=db.func.now(), index=True)
    acknowledged_by = db.Column(db.String(36), nullable=True)
    resolved_by = db.Column(db.String(36), nullable=True)
    export_payload = db.Column(db.JSON, default=dict)
    created_at = db.Column(db.DateTime, server_default=db.func.now())