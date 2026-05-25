from app.extensions import db


class SystemConfig(db.Model):
    __tablename__ = "system_config"

    id = db.Column(db.Integer, primary_key=True)
    failed_login_threshold = db.Column(db.Integer, default=3, nullable=False)
    alert_sensitivity = db.Column(db.String(20), default="medium", nullable=False)
    enabled_modules = db.Column(db.JSON, default=lambda: {
        "user_management": True,
        "security_monitoring": True,
        "audit_reporting": True,
        "anomaly_detection": True,
    }, nullable=False)
    created_at = db.Column(db.DateTime, server_default=db.func.now())
    updated_at = db.Column(db.DateTime, server_default=db.func.now(), onupdate=db.func.now())