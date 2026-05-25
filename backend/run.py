import os

from app import create_app
from app.extensions import socketio

app = create_app()

PORT = int(os.getenv("PORT", "5000"))

if __name__ == "__main__":
    socketio.run(
        app,
        host="0.0.0.0",
        port=PORT,
        debug=os.getenv("FLASK_DEBUG", "true").lower() == "true",
        use_reloader=False,
        log_output=True
    )