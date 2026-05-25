from csv import writer
from io import StringIO
from datetime import datetime

from flask import Blueprint, jsonify, request, Response
from flask_jwt_extended import get_jwt_identity
from app.models.activity_log_model import ActivityLog
from app.models.alert_model import Alert
from app.models.security_event_model import SecurityEvent
from app.models.system_config_model import SystemConfig
from app.models.user_model import User
from app.middleware.role_middleware import role_required
from app.extensions import db
from app.services.security_service import get_system_config, process_security_event

admin_bp = Blueprint("admin", __name__)


def serialize_user(user):
    return {
        "id": user.id,
        "fullname": user.fullname,
        "email": user.email,
        "role": user.role,
        "failed_login_attempts": user.failed_login_attempts,
        "is_locked": user.is_locked,
        "created_at": str(user.created_at),
        "updated_at": str(user.updated_at),
        "last_login": str(user.last_login) if user.last_login else None,
        "last_login_ip": user.last_login_ip,
    }


def serialize_config(config):
    return {
        "id": config.id,
        "failed_login_threshold": config.failed_login_threshold,
        "alert_sensitivity": config.alert_sensitivity,
        "enabled_modules": config.enabled_modules or {},
        "updated_at": str(config.updated_at) if config.updated_at else None,
    }


def build_pdf_report(lines):
    escaped_lines = []
    for line in lines:
        safe_line = str(line).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        escaped_lines.append(safe_line)

    content_lines = ["BT", "/F1 12 Tf", "72 760 Td"]
    first_line = True
    for line in escaped_lines:
        if first_line:
            content_lines.append(f"({line}) Tj")
            first_line = False
        else:
            content_lines.append("0 -16 Td")
            content_lines.append(f"({line}) Tj")
    content_lines.append("ET")
    content_stream = "\n".join(content_lines)

    objects = []
    objects.append("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj")
    objects.append("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj")
    objects.append(
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj"
    )
    objects.append("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj")
    objects.append(f"5 0 obj << /Length {len(content_stream.encode('utf-8'))} >> stream\n{content_stream}\nendstream endobj")

    pdf = ["%PDF-1.4\n"]
    offsets = [0]
    current = len(pdf[0].encode("utf-8"))
    for obj in objects:
        offsets.append(current)
        pdf.append(obj + "\n")
        current += len((obj + "\n").encode("utf-8"))

    xref_start = current
    xref = ["xref\n0 6\n0000000000 65535 f \n"]
    for offset in offsets[1:]:
        xref.append(f"{offset:010d} 00000 n \n")
    trailer = f"trailer << /Size 6 /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF"

    return ("".join(pdf) + "".join(xref) + trailer).encode("utf-8")


# =========================
# 1. GET ALL ALERTS
# =========================
@admin_bp.route("/alerts", methods=["GET"])
@role_required(["admin"])
def get_alerts():

    alerts = Alert.query.order_by(Alert.created_at.desc()).all()

    return jsonify([
        {
            "id": a.id,
            "type": a.type,
            "severity": a.severity,
            "message": a.message,
            "user_id": a.user_id,
            "created_at": str(a.created_at)
        }
        for a in alerts
    ])


# =========================
# 1B. GET/CREATE USERS
# =========================
@admin_bp.route("/users", methods=["GET", "POST"])
@role_required(["admin"])
def users_collection():
    if request.method == "GET":
        users = User.query.order_by(User.created_at.desc()).all()
        return jsonify([serialize_user(user) for user in users])

    data = request.get_json() or {}
    fullname = data.get("fullname")
    email = data.get("email")
    password = data.get("password")
    role = data.get("role", "caregiver")

    if not fullname or not email or not password:
        return jsonify({"message": "fullname, email, and password are required"}), 400

    if role not in {"admin", "caregiver", "patient"}:
        return jsonify({"message": "Invalid role"}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"message": "Email already exists"}), 400

    from app.extensions import bcrypt

    user = User(
        fullname=fullname,
        email=email,
        password_hash=bcrypt.generate_password_hash(password).decode("utf-8"),
        role=role,
    )
    db.session.add(user)
    db.session.commit()

    process_security_event(user, "admin_create_user", request.remote_addr, request.headers.get("User-Agent"))
    return jsonify(serialize_user(user)), 201


@admin_bp.route("/users/<user_id>", methods=["PUT", "DELETE"])
@role_required(["admin"])
def user_item(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"message": "User not found"}), 404

    if request.method == "DELETE":
        if user.id == get_jwt_identity():
            return jsonify({"message": "You cannot delete your own account from the admin dashboard"}), 400
        db.session.delete(user)
        db.session.commit()
        return jsonify({"message": "User deleted successfully"})

    data = request.get_json() or {}
    fullname = data.get("fullname")
    email = data.get("email")
    role = data.get("role")
    password = data.get("password")
    is_locked = data.get("is_locked")

    if fullname:
        user.fullname = fullname
    if email:
        duplicate = User.query.filter(User.email == email, User.id != user.id).first()
        if duplicate:
            return jsonify({"message": "Email already exists"}), 400
        user.email = email
    if role:
        if role not in {"admin", "caregiver", "patient"}:
            return jsonify({"message": "Invalid role"}), 400
        user.role = role
    if password:
        from app.extensions import bcrypt
        user.password_hash = bcrypt.generate_password_hash(password).decode("utf-8")
    if is_locked is not None:
        user.is_locked = bool(is_locked)

    db.session.commit()
    return jsonify(serialize_user(user))


# =========================
# 2. GET ACTIVITY LOGS
# =========================
@admin_bp.route("/activity-logs", methods=["GET"])
@role_required(["admin"])
def get_activity_logs():

    logs = ActivityLog.query.order_by(ActivityLog.created_at.desc()).limit(200).all()

    return jsonify([
        {
            "id": l.id,
            "user_id": l.user_id,
            "action": l.action,
            "status": l.status,
            "ip_address": l.ip_address,
            "created_at": str(l.created_at)
        }
        for l in logs
    ])


# =========================
# 2B. SYSTEM CONFIG
# =========================
@admin_bp.route("/system-config", methods=["GET", "PUT"])
@role_required(["admin"])
def system_config():
    config = get_system_config()

    if request.method == "GET":
        return jsonify(serialize_config(config))

    data = request.get_json() or {}

    if "failed_login_threshold" in data:
        config.failed_login_threshold = max(1, int(data["failed_login_threshold"]))
    if "alert_sensitivity" in data:
        config.alert_sensitivity = data["alert_sensitivity"]
    if "enabled_modules" in data and isinstance(data["enabled_modules"], dict):
        config.enabled_modules = data["enabled_modules"]

    db.session.commit()
    return jsonify(serialize_config(config))


# =========================
# 3. SECURITY SUMMARY
# =========================
@admin_bp.route("/security-summary", methods=["GET"])
@role_required(["admin"])
def security_summary():

    total_users = User.query.count()
    total_alerts = Alert.query.count()
    failed_logins = ActivityLog.query.filter_by(action="failed_login").count()
    locked_users = User.query.filter_by(is_locked=True).count()

    return jsonify({
        "total_users": total_users,
        "total_alerts": total_alerts,
        "failed_logins": failed_logins,
        "locked_users": locked_users,
        "current_config": serialize_config(get_system_config()),
    })


# =========================
# 4. USER RISK ANALYSIS
# =========================
@admin_bp.route("/user-risk", methods=["GET"])
@role_required(["admin"])
def user_risk():

    users = User.query.all()

    result = []

    for u in users:

        risk_score = 0

        if u.failed_login_attempts and u.failed_login_attempts > 3:
            risk_score += 50

        if u.is_locked:
            risk_score += 100

        if u.role == "caregiver":
            risk_score += 10

        result.append({
            "user_id": u.id,
            "email": u.email,
            "role": u.role,
            "risk_score": risk_score
        })

    return jsonify(result)


# =========================
# 4B. AUDIT REPORTS
# =========================
@admin_bp.route("/audit-reports", methods=["GET"])
@role_required(["admin"])
def audit_reports():
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")

    query = ActivityLog.query
    if start_date:
        query = query.filter(ActivityLog.created_at >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.filter(ActivityLog.created_at <= datetime.fromisoformat(end_date))

    logs = query.order_by(ActivityLog.created_at.desc()).limit(500).all()
    security_events = SecurityEvent.query.order_by(SecurityEvent.created_at.desc()).limit(200).all()

    return jsonify({
        "total_logs": len(logs),
        "total_security_events": len(security_events),
        "critical_events": sum(1 for event in security_events if event.severity == "critical"),
        "high_events": sum(1 for event in security_events if event.severity == "high"),
        "recent_logs": [
            {
                "id": log.id,
                "user_id": log.user_id,
                "action": log.action,
                "status": log.status,
                "created_at": str(log.created_at),
            }
            for log in logs[:50]
        ],
        "recent_events": [
            {
                "id": event.id,
                "user_id": event.user_id,
                "event_type": event.event_type,
                "severity": event.severity,
                "risk_score": event.risk_score,
                "message": event.message,
                "created_at": str(event.created_at),
            }
            for event in security_events[:50]
        ],
    })


@admin_bp.route("/audit-reports/export/csv", methods=["GET"])
@role_required(["admin"])
def export_audit_csv():
    output = StringIO()
    csv_writer = writer(output)
    csv_writer.writerow(["type", "id", "user_id", "label", "status", "severity", "risk_score", "created_at"])

    for log in ActivityLog.query.order_by(ActivityLog.created_at.desc()).limit(500).all():
        csv_writer.writerow(["activity", log.id, log.user_id, log.action, log.status, "", "", str(log.created_at)])

    for event in SecurityEvent.query.order_by(SecurityEvent.created_at.desc()).limit(500).all():
        csv_writer.writerow(["security_event", event.id, event.user_id, event.event_type, "", event.severity, event.risk_score, str(event.created_at)])

    response = Response(output.getvalue(), mimetype="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=audit-report.csv"
    return response


@admin_bp.route("/audit-reports/export/pdf", methods=["GET"])
@role_required(["admin"])
def export_audit_pdf():
    report = audit_reports().get_json()
    lines = [
        "SOC Audit Report",
        f"Generated: {datetime.utcnow().isoformat()}Z",
        f"Total Logs: {report['total_logs']}",
        f"Total Security Events: {report['total_security_events']}",
        f"Critical Events: {report['critical_events']}",
        f"High Events: {report['high_events']}",
        "",
        "Recent Security Events:",
    ]

    for event in report["recent_events"][:20]:
        lines.append(f"- {event['created_at']} | {event['severity']} | {event['event_type']} | risk={event['risk_score']}")

    pdf_bytes = build_pdf_report(lines)
    response = Response(pdf_bytes, mimetype="application/pdf")
    response.headers["Content-Disposition"] = "attachment; filename=audit-report.pdf"
    return response


# =========================
# 5. RESOLVE ALERT
# =========================
@admin_bp.route("/alerts/<alert_id>/resolve", methods=["PUT"])
@role_required(["admin"])
def resolve_alert(alert_id):

    alert = Alert.query.get(alert_id)

    if not alert:
        return jsonify({"message": "Alert not found"}), 404

    alert.status = "resolved"
    alert.message = f"{alert.message} (RESOLVED)"

    db.session.commit() 

    return jsonify({"message": "Alert resolved successfully"})