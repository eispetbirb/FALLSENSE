import uuid
from app.extensions import db


class User(db.Model):
    __tablename__ = "users"

    # ======================
    # CORE IDENTITY
    # ======================
    id = db.Column(
        db.String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    fullname = db.Column(db.String(100), nullable=False)

    email = db.Column(db.String(120), unique=True, nullable=False)

    password_hash = db.Column(db.Text, nullable=False)

    # ======================
    # ACCESS CONTROL (RBAC)
    # ======================
    role = db.Column(
        db.String(20),
        nullable=False
    )  # admin / caregiver

    # ======================
    # SECURITY TRACKING
    # ======================
    failed_login_attempts = db.Column(
        db.Integer,
        default=0
    )

    is_locked = db.Column(
        db.Boolean,
        default=False
    )

    # ======================
    # AUDIT TRAIL
    # ======================
    created_at = db.Column(
        db.DateTime,
        server_default=db.func.now()
    )

    updated_at = db.Column(
        db.DateTime,
        server_default=db.func.now(),
        onupdate=db.func.now()
    )

    # ======================
    # SECURITY ANALYTICS (SOC FEATURES)
    # ======================
    last_login = db.Column(
        db.DateTime,
        nullable=True
    )

    last_login_ip = db.Column(
        db.String(45),
        nullable=True
    )