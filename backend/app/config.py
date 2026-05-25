import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "jwt-secret-key-change-in-production")

    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///app.db")
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": int(os.getenv("SQLALCHEMY_POOL_RECYCLE", "300")),
    }

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # CORS Configuration
    ALLOWED_ORIGINS = os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:5000,http://127.0.0.1:3000,http://127.0.0.1:5000,http://127.0.0.1:5500",
    ).split(",")
    
    # Environment
    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
    ENABLE_AI_MONITORING = os.getenv("ENABLE_AI_MONITORING", "false").lower() == "true"