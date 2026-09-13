"""Application configuration loaded from environment variables (.env supported)."""
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "SupplyChainIQ API"
    # Primary database. When unreachable the app transparently falls back to SQLite.
    database_url: str = "postgresql+psycopg2://supplyiq:supplyiq@localhost:5433/supplychainiq"
    sqlite_fallback_url: str = "sqlite:///./supplychainiq.db"
    db_echo: bool = False

    # Comma-separated list of allowed browser origins.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"

    # Demo authentication (no real auth service; structured so JWT can replace it).
    token_secret: str = "supplychainiq-demo-secret-change-me"
    token_expire_minutes: int = 720

    # Default business assumptions (overridable at runtime via /api/settings).
    default_service_level: float = 0.95
    default_ordering_cost: float = 500.0       # ₹ per purchase order (demo assumption)
    default_holding_cost_rate: float = 0.20    # annual holding cost as fraction of unit cost
    default_demand_window_days: int = 90       # window for average daily demand
    default_forecast_days: int = 30

    @field_validator("*", mode="before")
    @classmethod
    def _empty_env_to_default(cls, v, info):
        """Treat empty-string env vars (added but left blank in a host UI) as unset."""
        if isinstance(v, str) and v.strip() == "":
            return cls.model_fields[info.field_name].default
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def cors_origin_list() -> list[str]:
    return [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
