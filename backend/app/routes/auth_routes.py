from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token
from datetime import datetime, timedelta

from app.extensions import db, bcrypt
from app.models.user_model import User
from app.services.security_service import process_security_event, trigger_alert

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json() or {}

    fullname = data.get("fullname")
    email = data.get("email")
    password = data.get("password")
    role = data.get("role", "caregiver")

    if not fullname or not email or not password:
        return jsonify({"message": "Missing required fields"}), 400

    existing_user = User.query.filter_by(email=email).first()
    if existing_user:
        return jsonify({"message": "Email already exists"}), 400

    hashed_password = bcrypt.generate_password_hash(password).decode("utf-8")

    user = User(
        fullname=fullname,
        email=email,
        password_hash=hashed_password,
        role=role,
    )

    db.session.add(user)
    db.session.commit()

    return jsonify({"message": "User registered successfully"}), 201


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json() or {}

    ip = request.remote_addr
    user_agent = request.headers.get("User-Agent")

    # ======================
    # VALIDATE INPUT
    # ======================
    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"message": "Missing credentials"}), 400

    # ======================
    # FIND USER
    # ======================
    user = User.query.filter_by(email=email).first()

    if not user:
        process_security_event(None, "login_failed_user_not_found", ip, user_agent)
        return jsonify({"message": "Invalid credentials"}), 401

    # ======================
    # CHECK LOCKED ACCOUNT
    # ======================
    # If there's a locked_until timestamp, check expiry
    now = datetime.utcnow()
    if getattr(user, "locked_until", None):
        if user.locked_until > now:
            # still in lock period
            process_security_event(user, "login_blocked_locked_account", ip, user_agent)
            return jsonify({"message": f"Account temporarily locked until {user.locked_until.isoformat()}Z"}), 403
        else:
            # lock expired -> auto-unlock
            user.is_locked = False
            user.failed_login_attempts = 0
            user.locked_until = None
            db.session.commit()

    # ======================
    # VERIFY PASSWORD
    # ======================
    if not bcrypt.check_password_hash(user.password_hash, password):
        now = datetime.utcnow()
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        user.last_failed_attempt = now

        process_security_event(user, "failed_login", ip, user_agent)

        # AUTO LOCK: lock after 5 failed attempts for 15 minutes
        if user.failed_login_attempts >= 5:
            lock_duration = timedelta(minutes=15)
            user.is_locked = True
            user.locked_until = now + lock_duration

            trigger_alert(
                alert_type="account_locked",
                message=f"User {user.email} locked due to failed login attempts",
                user_id=user.id,
                severity="high"
            )

        db.session.commit()

        # If account is now locked, return a locked message
        if user.is_locked and getattr(user, "locked_until", None):
            return jsonify({"message": f"Account temporarily locked until {user.locked_until.isoformat()}Z"}), 403

        return jsonify({"message": "Invalid credentials"}), 401

    # ======================
    # SUCCESS LOGIN
    # ======================
    user.failed_login_attempts = 0
    user.locked_until = None

    process_security_event(user, "login_success", ip, user_agent)

    db.session.commit()

    # ======================
    # JWT TOKEN
    # ======================
    access_token = create_access_token(
        identity=user.id,
        additional_claims={
            "role": user.role
        }
    )

    return jsonify({
        "access_token": access_token,
        "role": user.role,
        "user_id": user.id
    })