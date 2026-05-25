# Admin SOC Control Dashboard Design

## 1. System Architecture

The Admin Control Dashboard is the operational center of the SOC platform. It sits on top of the Flask REST API and Socket.IO stream and is responsible for user administration, incident visibility, system configuration, and audit reporting.

### Role in the system

- Receives real-time alerts from the monitoring engine.
- Manages users, roles, and account locking.
- Controls security thresholds and module enablement.
- Serves audit summaries and exportable incident reports.

### Connection to caregiver and monitoring systems

- Caregiver and patient actions are written to the activity log stream.
- Monitoring events and anomaly detections are published to the alert stream.
- The dashboard consumes both the REST API and the Socket.IO channel to stay synchronized with the backend.

### Data flow

1. User action occurs in the app.
2. Flask auth and service layer validate and record the action.
3. Security engine evaluates risk and may generate a security event or alert.
4. Database stores activity logs, alerts, and security events.
5. Socket.IO broadcasts the event to the admin dashboard.
6. The dashboard updates charts, tables, and counters immediately.

## 2. User Management System

### Capabilities

- Create user
- Update user
- Delete user
- Assign roles: admin, caregiver, patient
- Lock/unlock accounts

### REST API

- `POST /api/admin/users`
- `GET /api/admin/users`
- `PUT /api/admin/users/<id>`
- `DELETE /api/admin/users/<id>`

### Operational rules

- Admin-only access.
- Duplicate email detection.
- Passwords are hashed before storage.
- Self-deletion is blocked from the dashboard.

## 3. Authentication and Access Control

### JWT flow

1. User logs in with email and password.
2. Backend validates credentials.
3. JWT is issued with user ID as the subject and role in claims.
4. Frontend stores the token in `localStorage`.
5. Every protected request sends `Authorization: Bearer <token>`.

### Role enforcement

- `role_required(["admin"])` protects admin endpoints.
- Protected routes validate role claims, not just token presence.
- Failed auth responses return 401/403 and trigger safe logout in the frontend.

## 4. Activity Logging System

### What gets logged

- Login attempts
- Account lock attempts
- Admin actions
- User lifecycle operations
- Security engine responses

### Database tables

- `activity_logs`
- `user_logs`

### API

- `GET /api/admin/activity-logs`

## 5. Security Engine and Anomaly Detection

### Detection logic

- Multiple failed logins
- Unusual login times
- Abnormal burst behavior
- Locked-account access attempts

### Risk scoring

- Risk score is computed from login behavior and recent activity volume.
- Low / medium / high / critical severity is assigned from the score.
- Critical cases can auto-lock a user.

### Output

- Security events are stored in `security_events`.
- Alerts are written to `alerts`.
- Socket.IO broadcasts `security_event` and `new_alert`.

## 6. Real-Time Security Alerts

### Socket.IO events

- `new_alert`
- `security_event`
- `user_activity`

### Flow

- Backend service emits event.
- Socket client receives event.
- Dashboard updates panels, tables, and summary widgets.

## 7. Audit Trail Reporting System

### Purpose

- Aggregate operational logs and security incidents.
- Summarize activity volume and incident severity.
- Produce downloadable reports for compliance and review.

### APIs

- `GET /api/admin/audit-reports`
- `GET /api/admin/audit-reports/export/csv`
- `GET /api/admin/audit-reports/export/pdf`

### Export formats

- CSV for data analysis and spreadsheets.
- PDF for human-readable incident summaries.

## 8. System Configuration Module

### Configurable controls

- Failed login threshold
- Alert sensitivity level
- Enable/disable modules

### Database table

- `system_config`

### API

- `GET /api/admin/system-config`
- `PUT /api/admin/system-config`

## 9. Frontend Admin Dashboard

### Panels

- User management table
- Activity logs
- Live alerts
- System settings
- Audit report viewer

### Requirements

- Vanilla HTML/CSS/JavaScript only
- Responsive layout
- Real-time updates
- Safe fetch wrapper with auto logout on 401/422

## 10. Database Schema

### Tables

- `users`
- `activity_logs`
- `user_logs`
- `alerts`
- `security_events`
- `system_config`

## 11. Real-Time System Design

### Event flow

- Backend -> Socket.IO -> Dashboard UI

### Events

- `new_alert`
- `security_event`
- `user_activity`

## 12. Error Handling Strategy

- Validate request payloads on the backend.
- Return clear 400/401/403 responses.
- The frontend uses a safe fetch wrapper.
- On 401/422, the dashboard logs out and returns to the login screen.

## 13. Scalability Plan

- Use Redis for caching hot log summaries.
- Move anomaly detection into a background worker.
- Split the security engine into a dedicated service as the event volume grows.
- Keep the dashboard read-heavy and event-driven.

## 14. Production Notes

- Keep admin routes behind role checks.
- Rotate the JWT secret in production.
- Set a strong `SECRET_KEY` and `JWT_SECRET_KEY`.
- Use a dedicated reverse proxy in front of Flask for production deployment.
