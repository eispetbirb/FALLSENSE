from pathlib import Path

from flask import Flask, send_from_directory
from flask_cors import CORS
from sqlalchemy.exc import OperationalError

from app.config import Config
from app.extensions import db, jwt, bcrypt, migrate, socketio
from app.ai.monitoring_loop import start_monitoring_loop
from app.models import (
    ActivityLog,
    Alert,
    CameraStatus,
    IncidentReport,
    MedicationSchedule,
    PatientStatus,
    SecurityEvent,
    SystemConfig,
    User,
    UserLog,
)
from app.routes.caregiver_routes import caregiver_bp
from app.routes.admin_routes import admin_bp
from app.routes.auth_routes import auth_bp


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    allowed_origins = [origin.strip() for origin in app.config.get("ALLOWED_ORIGINS", []) if origin.strip()]

    # =========================
    # FIX CORS (IMPORTANT)
    # =========================
    CORS(
        app,
        resources={r"/api/*": {"origins": allowed_origins}},
        supports_credentials=False,
        allow_headers=["Content-Type", "Authorization"],
    )

    print("DB URL:", app.config.get("SQLALCHEMY_DATABASE_URI"))

    # Extensions
    db.init_app(app)
    jwt.init_app(app)
    bcrypt.init_app(app)
    migrate.init_app(app, db)

    socketio.init_app(
        app,
        cors_allowed_origins=allowed_origins
    )

    with app.app_context():
        try:
            db.create_all()
        except OperationalError as exc:
            app.logger.warning(
                "Database bootstrap skipped because the connection is unavailable: %s",
                exc,
            )

        if app.config.get("ENABLE_AI_MONITORING", False):
            start_monitoring_loop(app)

    # =========================
    # SOCKET AUTH
    # =========================
    @socketio.on("connect")
    def handle_connect(auth):
        try:
            if not auth or "token" not in auth:
                return False

            from flask_jwt_extended import decode_token
            decode_token(auth["token"])

        except Exception as e:
            print(f"SocketIO auth error: {e}")
            return False

        print("SocketIO client connected with auth")
        return True

    # Routes
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(caregiver_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")

    frontend_dir = Path(__file__).resolve().parents[2] / "frontend"

    @app.get("/")
    def serve_landing():
        return send_from_directory(frontend_dir, "landing.html")

    @app.get("/<path:filename>")
    def serve_frontend(filename):
        if filename.startswith("api/"):
            return {"error": "Not found"}, 404
        return send_from_directory(frontend_dir, filename)

    return app