import uuid

from app.extensions import db


class UserLog(db.Model):
    __tablename__ = "user_logs"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), index=True)
    action = db.Column(db.String(255), index=True)
    status = db.Column(db.String(20), index=True)
    ip_address = db.Column(db.String(50))
    user_agent = db.Column(db.Text)
    created_at = db.Column(db.DateTime, server_default=db.func.now(), index=True)