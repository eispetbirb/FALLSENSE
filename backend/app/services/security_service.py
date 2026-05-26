import logging
from datetime import datetime, timedelta

from app.extensions import db
from app.models.activity_log_model import ActivityLog
from app.models.alert_model import Alert
from app.models.security_event_model import SecurityEvent
from app.models.system_config_model import SystemConfig
from app.models.user_log_model import UserLog
from app.services.realtime_service import emit_alert, emit_activity, emit_security_event

logger = logging.getLogger(__name__)


def get_system_config():
    config = SystemConfig.query.get(1)
    if not config:
        config = SystemConfig(id=1)
        db.session.add(config)
        db.session.commit()
    return config


def _append_activity_log_entry(model, **kwargs):
    entry = model(**kwargs)
    db.session.add(entry)
    return entry


def _normalize_hour_risk(ip, user_agent):
    current_hour = datetime.utcnow().hour
    unusual_hour = current_hour < 6 or current_hour > 22
    return unusual_hour, current_hour


def evaluate_risk_score(user, action, ip, user_agent):
    config = get_system_config()
    risk_score = 0
    reasons = []

    if action == "failed_login":
        risk_score += 25
        reasons.append("failed_login")

        if user and user.failed_login_attempts >= config.failed_login_threshold:
            risk_score += 45
            reasons.append("threshold_exceeded")

    unusual_hour, current_hour = _normalize_hour_risk(ip, user_agent)
    if action == "login_success" and unusual_hour:
        risk_score += 20
        reasons.append(f"unusual_login_time_{current_hour}")

    recent_window_start = datetime.utcnow() - timedelta(minutes=10)
    recent_user_actions = 0
    if user:
        recent_user_actions = ActivityLog.query.filter(
            ActivityLog.user_id == user.id,
            ActivityLog.created_at >= recent_window_start,
        ).count()

    if recent_user_actions >= 12:
        risk_score += 35
        reasons.append("abnormal_activity_volume")

    if user and getattr(user, "is_locked", False):
        risk_score += 50
        reasons.append("locked_user")

    if action in {"login_failed_user_not_found", "login_blocked_locked_account"}:
        risk_score += 20
        reasons.append(action)

    severity = "low"
    if risk_score >= 80:
        severity = "critical"
    elif risk_score >= 50:
        severity = "high"
    elif risk_score >= 25:
        severity = "medium"

    return {
        "risk_score": risk_score,
        "severity": severity,
        "reasons": reasons,
        "current_hour": current_hour,
    }

# =========================================================
# 1. LOG ACTIVITY (EVENT COLLECTION LAYER)
# =========================================================
def log_activity(user_id, action, ip, user_agent, status="success"):
    try:
        activity_kwargs = {
            "user_id": user_id,
            "action": action,
            "ip_address": ip,
            "user_agent": user_agent,
            "status": status,
        }

        _append_activity_log_entry(ActivityLog, **activity_kwargs)
        _append_activity_log_entry(UserLog, **activity_kwargs)
        db.session.commit()

        # REAL-TIME FEED (DASHBOARD)
        emit_activity({
            "user_id": user_id,
            "action": action,
            "status": status,
            "created_at": datetime.utcnow().isoformat(),
        })

    except Exception as e:
        db.session.rollback()
        logger.error(f"[LOG_ACTIVITY_ERROR]: {str(e)}", exc_info=True)


# =========================================================
# 2. ALERT SYSTEM (INCIDENT STORAGE + NOTIFICATION)
# =========================================================
def trigger_alert(alert_type, message, user_id=None, severity="medium"):
    try:
        alert = Alert(
            type=alert_type,
            message=message,
            user_id=user_id,
            severity=severity,
        )

        db.session.add(alert)
        db.session.commit()

        # REAL-TIME ALERT PUSH
        emit_alert({
            "source": "security_rules",
            "type": alert_type,
            "trigger": alert_type,
            "message": message,
            "severity": severity,
            "details": message,
            "created_at": datetime.utcnow().isoformat(),
        })

    except Exception as e:
        db.session.rollback()
        logger.error(f"[TRIGGER_ALERT_ERROR]: {str(e)}", exc_info=True)


# =========================================================
# 3. SECURITY DETECTION ENGINE (RULE-BASED SOC BRAIN)
# =========================================================
def detect_security_event(user, action):

    alert = False
    severity = "low"
    message = None

    # RULE 1: brute force login detection
    if action == "failed_login" and user and user.failed_login_attempts >= 3:
        alert = True
        severity = "high"
        message = f"Multiple failed login attempts detected for {user.email}"

    # RULE 2: locked account access attempt
    if user and getattr(user, "is_locked", False):
        alert = True
        severity = "critical"
        message = f"Locked account access attempt detected for {user.email}"

    return {
        "alert": alert,
        "severity": severity,
        "message": message or action
    }


# =========================================================
# 4. INCIDENT RESPONSE PIPELINE (AUTOMATED SOC ACTIONS)
# =========================================================
def process_security_event(user, action, ip, user_agent):

    try:
        # STEP 1: LOG EVERYTHING FIRST
        log_activity(
            user_id=user.id if user else None,
            action=action,
            ip=ip,
            user_agent=user_agent,
            status="processed"
        )

        # STEP 2: RUN DETECTION ENGINE
        result = detect_security_event(user, action)

        risk = evaluate_risk_score(user, action, ip, user_agent)

        event = SecurityEvent(
            user_id=user.id if user else None,
            event_type=action,
            severity=risk["severity"],
            risk_score=risk["risk_score"],
            message=result["message"],
            event_metadata={
                "reasons": risk["reasons"],
                "ip": ip,
                "user_agent": user_agent,
            },
        )
        db.session.add(event)

        # STEP 3: IF THREAT DETECTED → TRIGGER RESPONSE
        if result["alert"] or risk["risk_score"] >= 50:

            trigger_alert(
                alert_type=action,
                message=result["message"],
                user_id=user.id if user else None,
                severity=risk["severity"],
            )

            emit_security_event({
                "user_id": user.id if user else None,
                "event_type": action,
                "severity": risk["severity"],
                "risk_score": risk["risk_score"],
                "message": result["message"],
                "reasons": risk["reasons"],
            })

            # STEP 4: AUTOMATED RESPONSE (SOC ACTION)
            if risk["severity"] == "critical" and user:
                user.is_locked = True
                db.session.commit()

        db.session.commit()

    except Exception as e:
        db.session.rollback()
        logger.error(f"[PROCESS_SECURITY_EVENT_ERROR]: {str(e)}", exc_info=True)