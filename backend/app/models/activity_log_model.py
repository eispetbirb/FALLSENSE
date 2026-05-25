from app.extensions import db
import uuid

class ActivityLog(db.Model):
    __tablename__ = "activity_logs"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36))
    action = db.Column(db.String(255))
    status = db.Column(db.String(20))
    ip_address = db.Column(db.String(50))
    user_agent = db.Column(db.Text)
    created_at = db.Column(db.DateTime, server_default=db.func.now())