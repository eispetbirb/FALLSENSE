from functools import wraps

from flask import jsonify, request

from flask_jwt_extended import (
    get_jwt,
    get_jwt_identity,
    verify_jwt_in_request,
)


def role_required(required_roles):

    def wrapper(fn):

        @wraps(fn)
        def decorator(*args, **kwargs):

            # Let CORS preflight pass without JWT validation.
            if request.method == "OPTIONS":
                return "", 204

            verify_jwt_in_request()

            # =========================
            # GET CURRENT USER FROM JWT
            # =========================
            current_user_id = get_jwt_identity()
            current_claims = get_jwt()

            # =========================
            # NO USER FOUND
            # =========================
            if not current_user_id:
                return jsonify({
                    "message": "Unauthorized"
                }), 401

            # =========================
            # EXTRACT ROLE
            # =========================
            current_role = current_claims.get("role")

            # =========================
            # ROLE CHECK
            # =========================
            if current_role not in required_roles:
                return jsonify({
                    "message": "Access denied"
                }), 403

            # =========================
            # ACCESS GRANTED
            # =========================
            return fn(*args, **kwargs)

        return decorator

    return wrapper