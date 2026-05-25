"""
stream_routes.py — Drop into backend/app/routes/
Register this blueprint in your main Flask app.
"""

from flask import Blueprint, request, jsonify
from flask_socketio import emit
from .. detection import start_stream, stop_stream, get_status

stream_bp = Blueprint("stream", __name__)

# ── REST endpoints ─────────────────────────────────────────────────────────────

@stream_bp.route("/api/stream/start", methods=["POST"])
def api_start():
    data = request.get_json()
    ip = data.get("ip", "").strip()
    if not ip:
        return jsonify({"error": "IP address required"}), 400

    from app import socketio          # import your socketio instance
    result = start_stream(socketio, ip)
    return jsonify(result)


@stream_bp.route("/api/stream/stop", methods=["POST"])
def api_stop():
    return jsonify(stop_stream())


@stream_bp.route("/api/stream/status", methods=["GET"])
def api_status():
    return jsonify(get_status())


# ── SocketIO events ────────────────────────────────────────────────────────────
# Call register_socket_events(socketio) from your app factory

def register_socket_events(socketio):

    @socketio.on("connect")
    def on_connect():
        emit("stream_status", get_status())

    @socketio.on("start_stream")
    def on_start(data):
        ip = data.get("ip", "")
        result = start_stream(socketio, ip)
        emit("stream_status", result)

    @socketio.on("stop_stream")
    def on_stop():
        emit("stream_status", stop_stream())
