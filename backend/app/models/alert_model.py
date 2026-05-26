from app.extensions import db
import uuid

class Alert(db.Model):
    __tablename__ = "alerts"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    type = db.Column(db.String(50))
    severity = db.Column(db.String(20))
    message = db.Column(db.Text)
    user_id = db.Column(db.String(36))
    created_at = db.Column(db.DateTime, server_default=db.func.now())