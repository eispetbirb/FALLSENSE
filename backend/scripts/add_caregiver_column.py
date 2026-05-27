"""Add caregiver_id column to patient_status table if it doesn't exist.

Run from the backend folder:

    python scripts/add_caregiver_column.py

It reads DATABASE_URL from environment (.env) and runs an ALTER TABLE with IF NOT EXISTS.
"""
from sqlalchemy import create_engine, text
import os
from dotenv import load_dotenv

load_dotenv()

db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("DATABASE_URL not set in environment. Set it and retry.")
    raise SystemExit(1)

engine = create_engine(db_url)

with engine.begin() as conn:
    # Add column if missing (DDL inside a transaction will be committed by begin())
    print("Checking/adding caregiver_id column on patient_status...")
    try:
        conn.execute(text("ALTER TABLE patient_status ADD COLUMN IF NOT EXISTS caregiver_id VARCHAR(36);"))
        print("Column ensured (caregiver_id).")
    except Exception as exc:
        print("Failed to add column:", exc)
        raise

    # Ensure index (IF NOT EXISTS is supported in modern Postgres)
    try:
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_patient_status_caregiver_id ON patient_status (caregiver_id);"))
        print("Index ensured (ix_patient_status_caregiver_id).")
    except Exception as exc:
        print("Index creation skipped or failed:", exc)

print("Done.")
