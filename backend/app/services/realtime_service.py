from app.extensions import socketio

# Send real-time updates to clients via SocketIO
def emit_alert(alert_data):
    socketio.emit("new_alert", alert_data)

# Send real-time activity logs to clients
def emit_activity(log_data):
    socketio.emit("new_activity", log_data)
    socketio.emit("user_activity", log_data)

# Send real-time security events to clients
def emit_security_event(event):
    socketio.emit("security_event", event)