# Phase 1 Foundation and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prototype's Cloudflare D1 identity layer with an independently deployable FastAPI/PostgreSQL backend, add persistent teams and the approved administrator/leader account boundaries, preserve existing passwords through transparent migration, and connect the existing Web UI to the new source of truth.

**Architecture:** Keep the existing React/TypeScript Web application. Add a Python 3.12 modular monolith under `backend/`, with PostgreSQL as the system of record, Redis reserved for queue/worker infrastructure, server-managed opaque sessions, and feature modules for authentication, organizations, and auditing. The Cloudflare Web Worker proxies same-origin `/api/v1/*` requests to the backend so browser cookies remain first-party; D1 remains untouched until account migration and cutover verification have passed.

**Tech Stack:** React 19, TypeScript 5.9, vinext/Next 16, Cloudflare Worker, Python 3.12, FastAPI 0.139.x, SQLAlchemy 2.0.x, Alembic, PostgreSQL 17, Redis 8, Celery 5.6.x, Argon2id, pytest, Vitest.

## Global Constraints

- Implement only “阶段 1：工程基础与账号体系”; video upload, AI evaluation, points, and real statistics remain outside this plan.
- The first production release is desktop Web only.
- Preserve the existing React/TypeScript page structure; replace only identity, team, audit, and navigation sources touched by this phase.
- Roles are exactly `collector`, `leader`, and `admin`.
- A collector can access only self identity data.
- A leader can view the leader's own team and can create collectors, edit collector display names, reset collector passwords, and enable/disable collectors in that team.
- A leader cannot delete accounts, edit usernames after creation, change roles, transfer teams, create leaders/admins, or access another team.
- An administrator can manage all roles and teams; at least one active administrator must always remain.
- Existing users must keep their current passwords. Legacy PBKDF2-SHA256 credentials are upgraded to Argon2id only after a successful login.
- Plaintext initial credentials must never enter source control, logs, API responses, or documentation.
- Password reset and account/team disable operations revoke affected sessions.
- All server-side endpoints must enforce role and team scope; UI visibility is never an authorization boundary.
- Do not add wallets, payments, withdrawals, online settlement, customer service, chat, or mobile-only features.
- Preserve unrelated untracked workspace files and stage only files named by each task.

## Dependency Baseline

Use compatible stable ranges anchored to the versions verified on 2026-08-05:

- `fastapi>=0.139,<0.140`
- `sqlalchemy[asyncio]>=2.0.51,<2.1`
- `celery[redis]>=5.6.3,<5.7`
- `argon2-cffi>=25.1,<26`
- `pydantic-settings>=2.10,<3`
- `alembic>=1.16,<2`
- `asyncpg>=0.30,<1`
- `uvicorn[standard]>=0.35,<1`
- `pytest>=8.4,<9`, `pytest-asyncio>=1,<2`, `httpx>=0.28,<1`

Official package references:

- <https://pypi.org/project/fastapi/>
- <https://pypi.org/project/SQLAlchemy/>
- <https://pypi.org/project/celery/>
- <https://pypi.org/project/argon2-cffi/>

## Target File Structure

```text
backend/
├── pyproject.toml
├── uv.lock
├── alembic.ini
├── Dockerfile
├── app/
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── errors.py
│   │   ├── ids.py
│   │   ├── middleware.py
│   │   └── time.py
│   ├── health/
│   │   └── router.py
│   ├── auth/
│   │   ├── models.py
│   │   ├── passwords.py
│   │   ├── repository.py
│   │   ├── schemas.py
│   │   ├── service.py
│   │   ├── dependencies.py
│   │   └── router.py
│   ├── organizations/
│   │   ├── models.py
│   │   ├── policy.py
│   │   ├── repository.py
│   │   ├── schemas.py
│   │   ├── service.py
│   │   └── router.py
│   ├── audit/
│   │   ├── models.py
│   │   ├── repository.py
│   │   ├── schemas.py
│   │   └── router.py
│   ├── cli/
│   │   ├── create_admin.py
│   │   └── import_legacy_d1.py
│   └── workers/
│       └── celery_app.py
├── migrations/
│   ├── env.py
│   └── versions/20260805_0001_identity.py
└── tests/
    ├── conftest.py
    ├── unit/
    ├── api/
    ├── integration/
    └── migration/

web/
├── app/[[...slug]]/page.tsx
├── src/auth/
│   ├── contracts.ts
│   ├── client/accountApi.ts
│   ├── client/AuthContext.tsx
│   └── server/backendClient.ts
├── src/features/admin/
│   ├── UsersTeamsPage.tsx
│   ├── TeamFormModal.tsx
│   └── TeamStatusModal.tsx
├── src/features/team/
│   ├── MembersPage.tsx
│   └── CollectorAccountFormModal.tsx
├── src/layout/DashboardShell.tsx
├── src/app/PlatformApp.tsx
├── src/app/navigation.ts
├── worker/index.ts
├── cloudflare-env.d.ts
└── vite.config.ts

compose.yaml
.github/workflows/ci.yml
```

---

### Task 1: Bootstrap the Independent Backend and Liveness Endpoint

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/core/__init__.py`
- Create: `backend/app/core/config.py`
- Create: `backend/app/health/__init__.py`
- Create: `backend/app/health/router.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/api/test_health.py`
- Create: `backend/uv.lock`

**Interfaces:**
- Produces: `app.main.create_app(settings: Settings | None = None) -> FastAPI`
- Produces: `GET /api/v1/health/live -> {"status": "ok", "service": "evdp-api"}`
- Produces: cached `get_settings() -> Settings`

- [ ] **Step 1: Write the failing health test**

```python
# backend/tests/api/test_health.py
from httpx import ASGITransport, AsyncClient

from app.main import create_app


async def test_liveness_is_public_and_stable() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "evdp-api"}
    assert response.headers["cache-control"] == "no-store"
```

- [ ] **Step 2: Add the Python project definition and test configuration**

```toml
# backend/pyproject.toml
[project]
name = "embodied-video-data-platform-backend"
version = "0.1.0"
requires-python = ">=3.12,<3.15"
dependencies = [
  "alembic>=1.16,<2",
  "argon2-cffi>=25.1,<26",
  "asyncpg>=0.30,<1",
  "celery[redis]>=5.6.3,<5.7",
  "fastapi>=0.139,<0.140",
  "pydantic-settings>=2.10,<3",
  "sqlalchemy[asyncio]>=2.0.51,<2.1",
  "uvicorn[standard]>=0.35,<1",
]

[dependency-groups]
dev = [
  "aiosqlite>=0.21,<1",
  "httpx>=0.28,<1",
  "psycopg[binary]>=3.2,<4",
  "pytest>=8.4,<9",
  "pytest-asyncio>=1,<2",
  "ruff>=0.12,<1",
]

[tool.pytest.ini_options]
addopts = "-q"
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
cd backend
uv sync
uv run pytest tests/api/test_health.py -v
```

Expected: FAIL because `app.main` does not yet exist.

- [ ] **Step 4: Implement settings and the liveness router**

```python
# backend/app/core/config.py
from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="EVDP_",
        env_file=".env",
        extra="ignore",
    )

    environment: Literal["local", "test", "production"] = "local"
    database_url: str = "sqlite+aiosqlite:///:memory:"
    redis_url: str = "redis://localhost:6379/0"
    web_origins: list[AnyHttpUrl] = [AnyHttpUrl("http://localhost:3000")]
    cookie_secure: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

```python
# backend/app/health/router.py
from fastapi import APIRouter, Response

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
async def live(response: Response) -> dict[str, str]:
    response.headers["cache-control"] = "no-store"
    return {"status": "ok", "service": "evdp-api"}
```

```python
# backend/app/main.py
from fastapi import FastAPI

from app.core.config import Settings, get_settings
from app.health.router import router as health_router


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="Embodied Video Data Platform API", version="0.1.0")
    app.state.settings = settings or get_settings()
    app.include_router(health_router, prefix="/api/v1")
    return app


app = create_app()
```

- [ ] **Step 5: Lock dependencies and run the focused quality checks**

Run:

```bash
cd backend
uv lock
uv run pytest tests/api/test_health.py -v
uv run ruff check app tests
```

Expected: one passing test and no Ruff errors.

- [ ] **Step 6: Commit the backend skeleton**

```bash
git add backend/pyproject.toml backend/uv.lock backend/app backend/tests
git commit -m "feat: bootstrap independent backend"
```

---

### Task 2: Define PostgreSQL Identity, Team, Session, and Audit Storage

**Files:**
- Create: `backend/app/core/database.py`
- Create: `backend/app/core/ids.py`
- Create: `backend/app/core/time.py`
- Create: `backend/app/organizations/models.py`
- Create: `backend/app/auth/models.py`
- Create: `backend/app/audit/models.py`
- Create: `backend/docker/init-databases.sql`
- Create: `backend/alembic.ini`
- Create: `backend/migrations/env.py`
- Create: `backend/migrations/script.py.mako`
- Create: `backend/migrations/versions/20260805_0001_identity.py`
- Create: `backend/tests/integration/test_identity_migration.py`
- Modify: `backend/tests/conftest.py`
- Create: `compose.yaml`

**Interfaces:**
- Produces: `Base`, `async_session_factory`, and `get_db() -> AsyncIterator[AsyncSession]`
- Produces: `Role`, `AccountStatus`, `TeamStatus`, `PasswordScheme`
- Produces tables: `teams`, `accounts`, `auth_sessions`, `audit_logs`
- Produces string identifiers compatible with legacy values: `U-*`, `TEAM-*`, `AUD-*`

- [ ] **Step 1: Write the failing migration shape test**

```python
# backend/tests/integration/test_identity_migration.py
import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


@pytest.mark.integration
def test_initial_migration_creates_identity_tables() -> None:
    database_url = os.environ["EVDP_TEST_DATABASE_URL"]
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)

    command.downgrade(config, "base")
    command.upgrade(config, "head")

    inspector = inspect(create_engine(database_url))
    assert {"teams", "accounts", "auth_sessions", "audit_logs"} <= set(
        inspector.get_table_names()
    )
    account_columns = {
        column["name"] for column in inspector.get_columns("accounts")
    }
    assert {
        "password_scheme",
        "password_hash",
        "password_salt",
        "password_iterations",
        "failed_attempt_count",
        "locked_until",
    } <= account_columns
```

- [ ] **Step 2: Run the migration test and verify it fails**

Create the minimal database service needed by this task:

```yaml
# compose.yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: evdp
      POSTGRES_PASSWORD: evdp
      POSTGRES_DB: evdp
    ports:
      - "5432:5432"
    volumes:
      - ./backend/docker/init-databases.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
      - evdp-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evdp -d evdp"]
      interval: 2s
      timeout: 2s
      retries: 20

volumes:
  evdp-postgres:
```

```sql
-- backend/docker/init-databases.sql
CREATE DATABASE evdp_test;
```

Run:

```bash
docker compose up -d postgres
cd backend
EVDP_TEST_DATABASE_URL=postgresql+psycopg://evdp:evdp@localhost:5432/evdp_test \
  uv run pytest tests/integration/test_identity_migration.py -v
```

Expected: FAIL because Alembic and the initial migration are absent.

- [ ] **Step 3: Create the shared model enums and identifiers**

```python
# backend/app/organizations/models.py
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Role(StrEnum):
    COLLECTOR = "collector"
    LEADER = "leader"
    ADMIN = "admin"


class AccountStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"


class TeamStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"


class PasswordScheme(StrEnum):
    ARGON2ID = "argon2id"
    PBKDF2_SHA256 = "pbkdf2_sha256"


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    status: Mapped[TeamStatus] = mapped_column(
        Enum(TeamStatus, native_enum=False), default=TeamStatus.ACTIVE
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        Index("ix_accounts_team_role_status", "team_id", "role", "status"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(30), nullable=False)
    username: Mapped[str] = mapped_column(String(32), nullable=False)
    username_normalized: Mapped[str] = mapped_column(
        String(32), unique=True, nullable=False
    )
    password_scheme: Mapped[PasswordScheme] = mapped_column(
        Enum(PasswordScheme, native_enum=False)
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    password_salt: Mapped[str | None] = mapped_column(String(128))
    password_iterations: Mapped[int | None] = mapped_column(Integer)
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False))
    team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), index=True
    )
    status: Mapped[AccountStatus] = mapped_column(
        Enum(AccountStatus, native_enum=False), default=AccountStatus.ACTIVE
    )
    failed_attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    first_failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    team: Mapped[Team | None] = relationship()
```

```python
# backend/app/auth/models.py
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Session(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (Index("ix_auth_sessions_account_expiry", "account_id", "expires_at"),)

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

```python
# backend/app/audit/models.py
from datetime import datetime

from sqlalchemy import DateTime, Index, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_created_at", "created_at"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    actor_account_id: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(30), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_id: Mapped[str] = mapped_column(String(64), nullable=False)
    target_name: Mapped[str] = mapped_column(String(80), nullable=False)
    summary: Mapped[str] = mapped_column(String(255), nullable=False)
    before_data: Mapped[dict[str, object] | None] = mapped_column(JSON)
    after_data: Mapped[dict[str, object] | None] = mapped_column(JSON)
    request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

- [ ] **Step 4: Create the database factory and Alembic migration**

Use an async SQLAlchemy engine for application code and import every model in `migrations/env.py`. The migration must:

1. Create `teams`.
2. Create `accounts` with a case-insensitive normalized username unique constraint.
3. Create `auth_sessions` with cascade deletion by account.
4. Create append-only `audit_logs`.
5. Add indexes for team/role/status, session account/expiry, and audit timestamp.
6. Add a check constraint requiring `team_id IS NULL` for administrators and `team_id IS NOT NULL` for leaders/collectors.

```python
# backend/app/core/database.py
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        yield session
```

- [ ] **Step 5: Run migration and model checks**

Run:

```bash
cd backend
EVDP_TEST_DATABASE_URL=postgresql+psycopg://evdp:evdp@localhost:5432/evdp_test \
  uv run pytest tests/integration/test_identity_migration.py -v
uv run ruff check app migrations tests
```

Expected: migration test passes and Ruff reports no errors.

- [ ] **Step 6: Commit the storage model**

```bash
git add compose.yaml backend/docker backend/alembic.ini backend/migrations backend/app/core backend/app/auth/models.py backend/app/organizations/models.py backend/app/audit/models.py backend/tests
git commit -m "feat: add identity persistence model"
```

---

### Task 3: Implement Argon2id and Transparent Legacy Password Upgrades

**Files:**
- Create: `backend/app/auth/passwords.py`
- Create: `backend/tests/unit/test_passwords.py`

**Interfaces:**
- Produces: `hash_password(password: str) -> str`
- Produces: `verify_argon2(password: str, encoded_hash: str) -> bool`
- Produces: `verify_legacy_pbkdf2(password, hash_value, salt, iterations) -> bool`
- Produces: `verify_and_upgrade(password: str, account: Account) -> PasswordVerification`
- `PasswordVerification` fields: `matches: bool`, `upgraded_hash: str | None`

- [ ] **Step 1: Write failing password compatibility tests**

```python
# backend/tests/unit/test_passwords.py
from types import SimpleNamespace

from app.auth.passwords import verify_and_upgrade
from app.organizations.models import PasswordScheme


def test_legacy_password_matches_and_returns_argon2_upgrade() -> None:
    account = SimpleNamespace(
        password_scheme=PasswordScheme.PBKDF2_SHA256,
        password_hash="sYbp5d4ckNaxK0GKfg3tGDK99XXawEB_P2GYXs4cpyA",
        password_salt="AwMDAwMDAwMDAwMDAwMDAw",
        password_iterations=600_000,
    )

    result = verify_and_upgrade("test-password-admin", account)

    assert result.matches is True
    assert result.upgraded_hash is not None
    assert result.upgraded_hash.startswith("$argon2id$")


def test_legacy_password_rejects_wrong_value_without_upgrade() -> None:
    account = SimpleNamespace(
        password_scheme=PasswordScheme.PBKDF2_SHA256,
        password_hash="sYbp5d4ckNaxK0GKfg3tGDK99XXawEB_P2GYXs4cpyA",
        password_salt="AwMDAwMDAwMDAwMDAwMDAw",
        password_iterations=600_000,
    )

    result = verify_and_upgrade("wrong-password", account)

    assert result.matches is False
    assert result.upgraded_hash is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend
uv run pytest tests/unit/test_passwords.py -v
```

Expected: FAIL because `app.auth.passwords` is absent.

- [ ] **Step 3: Implement constant-time legacy verification and Argon2id hashing**

```python
# backend/app/auth/passwords.py
import base64
import hashlib
import hmac
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.organizations.models import Account, PasswordScheme

hasher = PasswordHasher()


@dataclass(frozen=True)
class PasswordVerification:
    matches: bool
    upgraded_hash: str | None = None


def _decode_base64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_argon2(password: str, encoded_hash: str) -> bool:
    try:
        return hasher.verify(encoded_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def verify_legacy_pbkdf2(
    password: str,
    hash_value: str,
    salt: str,
    iterations: int,
) -> bool:
    actual = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        _decode_base64url(salt),
        iterations,
        dklen=32,
    )
    return hmac.compare_digest(actual, _decode_base64url(hash_value))


def verify_and_upgrade(password: str, account: Account) -> PasswordVerification:
    if account.password_scheme == PasswordScheme.PBKDF2_SHA256:
        if not account.password_salt or not account.password_iterations:
            return PasswordVerification(False)
        matches = verify_legacy_pbkdf2(
            password,
            account.password_hash,
            account.password_salt,
            account.password_iterations,
        )
        return PasswordVerification(
            matches,
            hash_password(password) if matches else None,
        )
    matches = verify_argon2(password, account.password_hash)
    if not matches:
        return PasswordVerification(False)
    return PasswordVerification(
        matches,
        hash_password(password) if hasher.check_needs_rehash(account.password_hash) else None,
    )
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd backend
uv run pytest tests/unit/test_passwords.py -v
uv run ruff check app/auth/passwords.py tests/unit/test_passwords.py
```

Expected: all password compatibility tests pass.

- [ ] **Step 5: Commit password compatibility**

```bash
git add backend/app/auth/passwords.py backend/tests/unit/test_passwords.py
git commit -m "feat: preserve and upgrade legacy passwords"
```

---

### Task 4: Build Authentication, Lockout, Revocable Sessions, and Team Disable Enforcement

**Files:**
- Create: `backend/app/core/errors.py`
- Create: `backend/app/auth/repository.py`
- Create: `backend/app/auth/schemas.py`
- Create: `backend/app/auth/service.py`
- Create: `backend/app/auth/dependencies.py`
- Create: `backend/tests/unit/test_auth_service.py`
- Create: `backend/tests/integration/test_auth_repository.py`

**Interfaces:**
- Produces: `AuthService.login(username, password, now) -> LoginResult`
- Produces: `AuthService.authenticate(raw_token, now) -> Account | None`
- Produces: `AuthService.logout(raw_token) -> None`
- Produces: `AuthRepository.revoke_account_sessions(account_id) -> None`
- Produces: `AuthRepository.revoke_team_sessions(team_id) -> None`
- Session token: 32 random bytes encoded URL-safe; only SHA-256 digest stored.
- Constants: 5 failed attempts in 15 minutes, 15-minute lock, 7-day session expiry.

- [ ] **Step 1: Write failing service tests**

Cover all of these cases in `backend/tests/unit/test_auth_service.py` with an in-memory repository double:

```python
async def test_login_upgrades_legacy_password_and_creates_session() -> None:
    result = await service.login("  ADMIN ", "test-password-admin", now)
    assert result.account.id == "U-ADMIN-01"
    assert result.raw_token != ""
    assert repo.accounts["U-ADMIN-01"].password_scheme == PasswordScheme.ARGON2ID
    assert repo.accounts["U-ADMIN-01"].password_salt is None


async def test_fifth_failure_locks_for_fifteen_minutes() -> None:
    for _ in range(4):
        with pytest.raises(AuthError, match="用户名或密码错误"):
            await service.login("admin", "wrong-password", now)
    with pytest.raises(AuthError) as error:
        await service.login("admin", "wrong-password", now)
    assert error.value.code == "LOCKED"


async def test_disabled_team_rejects_non_admin_login() -> None:
    team.status = TeamStatus.DISABLED
    with pytest.raises(AuthError) as error:
        await service.login("tuanzhang1", "correct-password", now)
    assert error.value.code == "DISABLED"
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend
uv run pytest tests/unit/test_auth_service.py -v
```

Expected: FAIL because repository and service do not exist.

- [ ] **Step 3: Implement authentication service invariants**

Define the shared error and login result before the service:

```python
# backend/app/core/errors.py
class ApplicationError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        retry_after_seconds: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retry_after_seconds = retry_after_seconds


class AuthError(ApplicationError):
    pass
```

```python
# backend/app/auth/schemas.py
@dataclass(frozen=True)
class LoginResult:
    account: Account
    raw_token: str
    expires_at: datetime
```

In `auth/service.py`, implement these private helpers with the stated
algorithms:

```python
def normalize_username_or_none(value: str) -> str | None:
    normalized = value.strip().lower()
    return normalized if re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,31}", normalized) else None


def generate_session_token() -> str:
    return secrets.token_urlsafe(32)


def sha256_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


DUMMY_PASSWORD_HASH = hash_password("constant-dummy-password")


def verify_dummy_password(password: str) -> None:
    verify_argon2(password, DUMMY_PASSWORD_HASH)
```

```python
# backend/app/auth/service.py
FAILURE_WINDOW = timedelta(minutes=15)
LOCK_DURATION = timedelta(minutes=15)
SESSION_TTL = timedelta(days=7)
MAX_FAILURES = 5


async def login(self, username: str, password: str, now: datetime) -> LoginResult:
    normalized = normalize_username_or_none(username)
    account = await self.repository.find_account_for_login(normalized)
    if account is None:
        verify_dummy_password(password)
        raise AuthError("INVALID_CREDENTIALS", "用户名或密码错误")
    if account.status != AccountStatus.ACTIVE:
        raise AuthError("DISABLED", "账号已停用，请联系管理员")
    if account.role != Role.ADMIN and (
        account.team is None or account.team.status != TeamStatus.ACTIVE
    ):
        raise AuthError("DISABLED", "所属团队已停用，请联系管理员")
    if account.locked_until and account.locked_until > now:
        raise AuthError("LOCKED", "登录尝试过多，请稍后再试")

    verification = verify_and_upgrade(password, account)
    if not verification.matches:
        await self.repository.record_failed_login(account, now)
        raise self._failure_error(account, now)

    if verification.upgraded_hash:
        await self.repository.upgrade_password(account.id, verification.upgraded_hash)
    await self.repository.clear_failed_login(account.id)
    raw_token = generate_session_token()
    await self.repository.create_session(
        sha256_token(raw_token),
        account.id,
        now,
        now + SESSION_TTL,
    )
    return LoginResult(account=account, raw_token=raw_token, expires_at=now + SESSION_TTL)
```

The real implementation must perform failed-attempt updates atomically and must use a dummy Argon2 hash for unknown usernames to reduce timing differences.

- [ ] **Step 4: Add repository integration tests**

Verify with PostgreSQL that:

- Expired sessions do not authenticate.
- Disabled accounts do not authenticate.
- `revoke_account_sessions` deletes every session for one account.
- `revoke_team_sessions` deletes sessions only for accounts in that team.
- Password upgrade clears legacy salt and iteration fields in one transaction.

- [ ] **Step 5: Run authentication tests**

Run:

```bash
cd backend
uv run pytest tests/unit/test_auth_service.py tests/integration/test_auth_repository.py -v
uv run ruff check app/auth tests/unit/test_auth_service.py tests/integration/test_auth_repository.py
```

Expected: all authentication tests pass.

- [ ] **Step 6: Commit authentication**

```bash
git add backend/app/auth backend/tests/unit/test_auth_service.py backend/tests/integration/test_auth_repository.py
git commit -m "feat: add backend authentication and sessions"
```

---

### Task 5: Implement Team-Scoped Account Management and Append-Only Auditing

**Files:**
- Create: `backend/app/organizations/policy.py`
- Create: `backend/app/organizations/repository.py`
- Create: `backend/app/organizations/schemas.py`
- Create: `backend/app/organizations/service.py`
- Create: `backend/app/audit/repository.py`
- Create: `backend/app/audit/schemas.py`
- Create: `backend/tests/unit/test_account_policy.py`
- Create: `backend/tests/unit/test_account_service.py`
- Create: `backend/tests/unit/test_team_service.py`
- Create: `backend/tests/integration/test_audit_repository.py`

**Interfaces:**
- Produces: `policy_allows(actor_role, target_role, same_team, action) -> bool`
- Produces: `AccountService.list_visible(actor) -> list[Account]`
- Produces: `AccountService.create(actor, AccountCreate, request_context) -> Account`
- Produces: `AccountService.update(actor, account_id, AccountPatch, request_context) -> Account`
- Produces: `AccountService.reset_password(actor, account_id, password, request_context) -> bool`
- Produces: `AccountService.set_status(actor, account_id, status, request_context) -> Account`
- Produces: `TeamService.list_visible(actor) -> list[Team]`
- Produces administrator-only team create/update/status methods.
- Every write produces one audit row in the same database transaction.

- [ ] **Step 1: Write the failing role and scope matrix tests**

```python
# backend/tests/unit/test_account_policy.py
@pytest.mark.parametrize(
    ("actor_role", "target_role", "same_team", "action", "allowed"),
    [
        (Role.ADMIN, Role.ADMIN, False, "create", True),
        (Role.ADMIN, Role.LEADER, False, "update", True),
        (Role.LEADER, Role.COLLECTOR, True, "create", True),
        (Role.LEADER, Role.COLLECTOR, True, "reset_password", True),
        (Role.LEADER, Role.COLLECTOR, False, "reset_password", False),
        (Role.LEADER, Role.LEADER, True, "update", False),
        (Role.LEADER, Role.ADMIN, False, "create", False),
        (Role.COLLECTOR, Role.COLLECTOR, True, "update", False),
    ],
)
def test_account_policy_matrix(
    actor_role: Role,
    target_role: Role,
    same_team: bool,
    action: str,
    allowed: bool,
) -> None:
    assert policy_allows(actor_role, target_role, same_team, action) is allowed
```

Also write service tests proving:

- A leader-created account is always `collector` and always inherits the actor's team.
- A leader may patch only `displayName`; username, role, and team changes return `FORBIDDEN`.
- A leader cannot see another team's account.
- An administrator can create all roles and can reassign non-admin accounts.
- A disabled team rejects new non-admin accounts.
- The current actor cannot disable self.
- The last active administrator cannot be disabled or demoted.
- Disabling a team revokes team sessions without changing individual account statuses.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
cd backend
uv run pytest tests/unit/test_account_policy.py tests/unit/test_account_service.py tests/unit/test_team_service.py -v
```

Expected: FAIL because organization policy and services do not exist.

- [ ] **Step 3: Implement request context and audit writer**

```python
# backend/app/audit/repository.py
@dataclass(frozen=True)
class RequestContext:
    request_id: str
    ip_address: str | None
    user_agent: str | None


async def append_audit(
    session: AsyncSession,
    *,
    actor: Account,
    action: str,
    target_type: str,
    target_id: str,
    target_name: str,
    summary: str,
    before_data: dict[str, object] | None,
    after_data: dict[str, object] | None,
    context: RequestContext,
    created_at: datetime,
) -> AuditLog:
    log = AuditLog(
        id=new_id("AUD"),
        actor_account_id=actor.id,
        actor_name=actor.display_name,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_name=target_name,
        summary=summary,
        before_data=before_data,
        after_data=after_data,
        request_id=context.request_id,
        ip_address=context.ip_address,
        user_agent=context.user_agent,
        created_at=created_at,
    )
    session.add(log)
    return log
```

- [ ] **Step 4: Implement policy before persistence**

The service must authorize before constructing mutations. Use explicit policy functions, not role checks scattered across routers:

```python
def assert_leader_collector_scope(actor: Account, target: Account) -> None:
    if (
        actor.role != Role.LEADER
        or target.role != Role.COLLECTOR
        or not actor.team_id
        or target.team_id != actor.team_id
    ):
        raise ApplicationError("FORBIDDEN", "只能管理本团队数采人员")
```

For leader account creation, ignore no client-supplied elevated values: reject payloads whose `role` is not `collector` or whose `teamId` differs from the actor's team.

- [ ] **Step 5: Run unit and repository tests**

Run:

```bash
cd backend
uv run pytest tests/unit/test_account_policy.py tests/unit/test_account_service.py tests/unit/test_team_service.py tests/integration/test_audit_repository.py -v
uv run ruff check app/organizations app/audit tests
```

Expected: policy, service, session revocation, and audit transaction tests pass.

- [ ] **Step 6: Commit organization services**

```bash
git add backend/app/organizations backend/app/audit backend/tests
git commit -m "feat: enforce team-scoped account management"
```

---

### Task 6: Expose Versioned FastAPI Endpoints with Secure Cookies and Stable Errors

**Files:**
- Modify: `backend/app/core/errors.py`
- Create: `backend/app/core/middleware.py`
- Create: `backend/app/auth/router.py`
- Create: `backend/app/organizations/router.py`
- Create: `backend/app/audit/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/api/test_auth_api.py`
- Create: `backend/tests/api/test_accounts_api.py`
- Create: `backend/tests/api/test_teams_api.py`
- Create: `backend/tests/api/test_audit_api.py`
- Create: `backend/tests/api/test_openapi_contract.py`

**Interfaces:**
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/session`
- `GET|POST /api/v1/accounts`
- `PATCH /api/v1/accounts/{account_id}`
- `POST /api/v1/accounts/{account_id}/reset-password`
- `PATCH /api/v1/accounts/{account_id}/status`
- `GET|POST /api/v1/teams`
- `PATCH /api/v1/teams/{team_id}`
- `PATCH /api/v1/teams/{team_id}/status`
- `GET /api/v1/audit-logs?limit=100`
- Cookie name remains `evdp_session`.
- JSON fields remain camelCase to preserve current TypeScript contracts.

- [ ] **Step 1: Write failing endpoint contract tests**

```python
async def test_login_sets_first_party_opaque_cookie(client, admin) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        headers={"origin": "http://localhost:3000"},
        json={"username": "admin", "password": "test-password-admin"},
    )

    assert response.status_code == 200
    assert response.json()["user"]["role"] == "admin"
    assert response.json()["homePath"] == "/admin"
    cookie = response.headers["set-cookie"]
    assert "evdp_session=" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=Lax" in cookie
    assert "password" not in response.text.lower()


async def test_cross_origin_mutation_is_rejected(client) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        headers={"origin": "https://evil.example"},
        json={"username": "admin", "password": "test-password-admin"},
    )
    assert response.status_code == 403
    assert response.json() == {
        "code": "FORBIDDEN",
        "error": "请求来源无效",
    }
```

Add contract tests for the leader's allowed collector creation and forbidden admin creation, administrator team CRUD, self-disable protection, last-admin protection, audit pagination, and an unauthenticated `401`.
Also assert that a leader receives `403 FORBIDDEN` from `/api/v1/audit-logs`.

- [ ] **Step 2: Run API tests to verify they fail**

Run:

```bash
cd backend
uv run pytest tests/api/test_auth_api.py tests/api/test_accounts_api.py tests/api/test_teams_api.py tests/api/test_audit_api.py -v
```

Expected: FAIL because routers are absent.

- [ ] **Step 3: Add request ID, origin validation, and error mapping**

```python
# backend/app/core/errors.py
ERROR_STATUS = {
    "VALIDATION": 400,
    "UNAUTHENTICATED": 401,
    "FORBIDDEN": 403,
    "NOT_FOUND": 404,
    "CONFLICT": 409,
    "LOCKED": 429,
}


@app.exception_handler(ApplicationError)
async def application_error_handler(
    request: Request,
    error: ApplicationError,
) -> JSONResponse:
    headers = (
        {"retry-after": str(error.retry_after_seconds)}
        if error.retry_after_seconds is not None
        else {}
    )
    return JSONResponse(
        status_code=ERROR_STATUS[error.code],
        content={"code": error.code, "error": error.message},
        headers=headers,
    )
```

Middleware must:

- Create or validate `x-request-id`.
- Add it to response headers and structured logs.
- Reject non-GET/HEAD/OPTIONS requests whose `Origin` is missing or not in `EVDP_WEB_ORIGINS`.
- Never log cookies, passwords, authorization headers, or request bodies.

- [ ] **Step 4: Implement Pydantic camelCase response schemas and routers**

Use one shared schema base:

```python
def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )
```

Convert UTC datetimes to epoch milliseconds for `createdAt` and `updatedAt`, matching the current Web client. Login returns only the public account and home path. Set the session cookie with `HttpOnly`, `SameSite=Lax`, `Path=/`, seven-day maximum age, and `Secure` when `EVDP_COOKIE_SECURE=true`.

- [ ] **Step 5: Assert the complete OpenAPI path set**

```python
async def test_openapi_contains_phase_one_endpoints(client) -> None:
    document = (await client.get("/openapi.json")).json()
    assert {
        "/api/v1/auth/login",
        "/api/v1/auth/logout",
        "/api/v1/auth/session",
        "/api/v1/accounts",
        "/api/v1/accounts/{account_id}",
        "/api/v1/teams",
        "/api/v1/teams/{team_id}",
        "/api/v1/audit-logs",
    } <= set(document["paths"])
```

- [ ] **Step 6: Run the API suite**

Run:

```bash
cd backend
uv run pytest tests/api -v
uv run ruff check app tests/api
```

Expected: all API and OpenAPI contract tests pass.

- [ ] **Step 7: Commit the versioned API**

```bash
git add backend/app backend/tests/api
git commit -m "feat: expose identity and team api"
```

---

### Task 7: Add Safe D1 Account Migration and Secret-Only Fresh Bootstrap

**Files:**
- Create: `backend/app/cli/__init__.py`
- Create: `backend/app/cli/import_legacy_d1.py`
- Create: `backend/app/cli/create_admin.py`
- Create: `backend/tests/migration/test_import_legacy_d1.py`
- Create: `backend/tests/migration/test_create_admin.py`
- Create: `backend/docs/account-cutover.md`

**Interfaces:**
- Produces CLI: `python -m app.cli.import_legacy_d1 --sqlite PATH --team TEAM-01=星火一队 --team TEAM-02=远山二队`
- Produces CLI: `python -m app.cli.create_admin --username admin --display-name 管理员 --password-file PATH`
- Produces: `ImportResult(teams: int, accounts: int, audits: int)`
- Does not import legacy sessions.
- Preserves legacy account IDs, usernames, roles, team IDs, statuses, PBKDF2 hashes, salts, iterations, timestamps, and account audit logs.

- [ ] **Step 1: Write a failing migration fixture test**

Create a temporary SQLite database with the current D1 `accounts`, `auth_sessions`, and `account_audit_logs` shape. Insert:

- `U-ADMIN-01` with no team.
- `U-LEAD-01` in `TEAM-01`.
- `U-COL-01` in `TEAM-01`.
- One account audit row.
- One active legacy session that must not migrate.

```python
async def test_import_preserves_passwords_and_skips_sessions(
    legacy_sqlite: Path,
    postgres_session: AsyncSession,
) -> None:
    result = await import_legacy_database(
        sqlite_path=legacy_sqlite,
        team_names={"TEAM-01": "星火一队"},
        session=postgres_session,
    )

    assert result == ImportResult(teams=1, accounts=3, audits=1)
    account = await postgres_session.get(Account, "U-COL-01")
    assert account.password_scheme == PasswordScheme.PBKDF2_SHA256
    assert account.password_iterations == 600_000
    assert await count_sessions(postgres_session) == 0
```

- [ ] **Step 2: Run migration tests and verify failure**

Run:

```bash
cd backend
uv run pytest tests/migration/test_import_legacy_d1.py tests/migration/test_create_admin.py -v
```

Expected: FAIL because the CLIs are absent.

- [ ] **Step 3: Implement an idempotent transaction-based importer**

Define the result returned by both the callable and CLI:

```python
@dataclass(frozen=True)
class ImportResult:
    teams: int
    accounts: int
    audits: int
```

The importer must:

1. Refuse unknown roles, account statuses, audit actions, duplicate usernames, or missing team mappings.
2. Create mapped teams before accounts.
3. Set `password_scheme=pbkdf2_sha256`.
4. Preserve password hash/salt/iterations without ever printing them.
5. Preserve account IDs and audit IDs.
6. Skip `auth_sessions`.
7. Run inside one PostgreSQL transaction.
8. Return counts only.
9. On a second run, verify records are identical and return zero new rows; conflicting records abort.

- [ ] **Step 4: Implement password-file bootstrap for an empty database**

```python
password = Path(args.password_file).read_text(encoding="utf-8").rstrip("\r\n")
if len(password) < 8 or len(password) > 64:
    raise SystemExit("管理员密码长度需为 8 到 64 位")
```

The command must refuse to create a bootstrap administrator if any administrator exists. It must never accept the password as a command-line argument and must not print the password or hash.

- [ ] **Step 5: Document the operational export/import sequence**

`backend/docs/account-cutover.md` must use paths outside the repository:

```bash
cd web
pnpm wrangler d1 export site-creator-d1 --remote \
  --output /secure/evdp-d1-export.sql
sqlite3 /secure/evdp-legacy.sqlite < /secure/evdp-d1-export.sql

cd ../backend
test -n "$EVDP_DATABASE_URL"
uv run python -m app.cli.import_legacy_d1 \
  --sqlite /secure/evdp-legacy.sqlite \
  --team TEAM-01=星火一队 \
  --team TEAM-02=远山二队
```

Include verification queries, rollback conditions, secure deletion of temporary exports, and the fact that users must log in again with unchanged passwords after cutover.

- [ ] **Step 6: Run migration tests**

Run:

```bash
cd backend
uv run pytest tests/migration -v
uv run ruff check app/cli tests/migration
```

Expected: importer, conflict, idempotency, session-skip, and bootstrap tests pass.

- [ ] **Step 7: Commit migration tooling**

```bash
git add backend/app/cli backend/tests/migration backend/docs/account-cutover.md
git commit -m "feat: add safe legacy account migration"
```

---

### Task 8: Proxy the Versioned API and Bootstrap Auth from the New Backend

**Files:**
- Create: `web/src/auth/server/backendClient.ts`
- Create: `web/src/auth/server/backendClient.test.ts`
- Create: `web/src/auth/server/backendProxy.ts`
- Create: `web/src/auth/server/backendProxy.test.ts`
- Modify: `web/worker/index.ts`
- Modify: `web/cloudflare-env.d.ts`
- Modify: `web/vite.config.ts`
- Modify: `web/app/[[...slug]]/page.tsx`
- Modify: `web/src/auth/client/accountApi.ts`
- Modify: `web/src/auth/client/accountApi.test.ts`
- Modify: `web/src/auth/contracts.ts`
- Modify: `web/src/test/accountFixtures.ts`

**Interfaces:**
- Browser paths use same-origin `/api/v1/*`.
- Worker forwards `/api/v1/*` to `Cloudflare.Env.BACKEND_API_URL`.
- Produces: `loadAuthBootstrap(cookieHeader: string | null) -> Promise<AuthBootstrap | null>`
- `AuthBootstrap`: `{ currentAccount: AccountPublic; accounts: AccountPublic[]; teams: TeamPublic[] }`

- [ ] **Step 1: Update client tests first**

Change the expected API calls to:

```typescript
[
  "/api/v1/accounts",
  "/api/v1/accounts",
  "/api/v1/accounts/U%2FADMIN%2002",
  "/api/v1/accounts/U%2FADMIN%2002/reset-password",
  "/api/v1/accounts/U%2FADMIN%2002/status",
  "/api/v1/audit-logs",
]
```

Add tests for:

- `listTeams`, `createTeam`, `updateTeam`, `setTeamStatus`.
- `login` using `/api/v1/auth/login`.
- `logout` using `/api/v1/auth/logout`.
- Worker proxy preserving `Cookie`, `Origin`, `Set-Cookie`, status, and body.
- Worker proxy rejecting an unset or non-HTTP(S) backend URL.
- Server bootstrap returning `null` on backend `401`, and throwing a safe availability error on `5xx`.

Move account fixture construction from the soon-to-be-deleted
`src/auth/server/testFactories.ts` into
`src/test/accountFixtures.ts`, and update all client/UI tests to import it
from the new location before Task 10 removes the D1 server files.

- [ ] **Step 2: Run Web auth tests and verify failure**

Run:

```bash
cd web
pnpm test -- src/auth/client/accountApi.test.ts src/auth/server/backendClient.test.ts src/auth/server/backendProxy.test.ts
```

Expected: FAIL because paths and backend bridge do not yet exist.

- [ ] **Step 3: Extend shared Web contracts**

```typescript
export type TeamStatus = "active" | "disabled";

export type TeamPublic = {
  id: string;
  name: string;
  status: TeamStatus;
  createdAt: number;
  updatedAt: number;
};

export type AuthBootstrap = {
  currentAccount: AccountPublic;
  accounts: AccountPublic[];
  teams: TeamPublic[];
};

export type UpdateAccountInput = Partial<
  Pick<AccountPublic, "displayName" | "username" | "role" | "teamId">
>;
```

- [ ] **Step 4: Implement the Cloudflare backend proxy**

```typescript
// web/src/auth/server/backendProxy.ts
export async function proxyBackend(
  request: Request,
  backendApiUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const upstreamBase = new URL(backendApiUrl);
  if (!["http:", "https:"].includes(upstreamBase.protocol)) {
    return Response.json(
      { code: "CONFIGURATION", error: "服务配置无效" },
      { status: 503 },
    );
  }
  const incoming = new URL(request.url);
  const upstream = new URL(incoming.pathname + incoming.search, upstreamBase);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  const body = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : await request.arrayBuffer();
  const response = await fetcher(upstream, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
```

Call this before vinext routing in `web/worker/index.ts` whenever `url.pathname.startsWith("/api/v1/")`.

- [ ] **Step 5: Bootstrap the server-rendered page from FastAPI**

`backendClient.ts` must call backend `/api/v1/auth/session`, then visible `/api/v1/accounts` and `/api/v1/teams`, forwarding only the `Cookie` header. Update `web/app/[[...slug]]/page.tsx` to use this bootstrap instead of `getRuntimeServices()` and D1.

Unauthenticated public and login pages still render without a backend session. Protected paths redirect to `/login` when bootstrap is `null`.

- [ ] **Step 6: Run focused and full Web checks**

Run:

```bash
cd web
pnpm test -- src/auth
pnpm typecheck
```

Expected: auth client, proxy, server bootstrap, and type checks pass.

- [ ] **Step 7: Commit the backend bridge**

```bash
git add web/src/auth web/worker/index.ts web/cloudflare-env.d.ts web/vite.config.ts 'web/app/[[...slug]]/page.tsx'
git commit -m "feat: connect web authentication to backend"
```

---

### Task 9: Make Backend Accounts and Teams the UI Source of Truth

**Files:**
- Create: `web/src/auth/client/AuthContext.tsx`
- Create: `web/src/auth/client/AuthContext.test.tsx`
- Create: `web/src/features/admin/TeamFormModal.tsx`
- Create: `web/src/features/admin/TeamStatusModal.tsx`
- Create: `web/src/features/team/CollectorAccountFormModal.tsx`
- Modify: `web/src/data/DemoStoreContext.tsx`
- Modify: `web/src/app/PlatformApp.tsx`
- Modify: `web/src/layout/DashboardShell.tsx`
- Modify: `web/src/layout/DashboardShell.test.tsx`
- Modify: `web/src/features/admin/UserFormModal.tsx`
- Modify: `web/src/features/admin/UsersTeamsPage.tsx`
- Modify: `web/src/features/admin/accountManagement.test.tsx`
- Modify: `web/src/features/team/MembersPage.tsx`
- Create: `web/src/features/team/memberAccountManagement.test.tsx`
- Modify: `web/src/features/admin/AuditLogPage.tsx`
- Modify: `web/src/features/admin/AuditLogPage.test.tsx`

**Interfaces:**
- Produces: `AuthProvider({ bootstrap, children })`
- Produces: `useAuth() -> { currentAccount, accounts, teams, upsertAccount, upsertTeam }`
- `PlatformApp` and `DashboardShell` read role/display name from `useAuth`, never from demo data.
- Admin organization page reads/writes backend accounts and teams.
- Leader member page reads/writes only backend-visible accounts.

- [ ] **Step 1: Write failing provider and page behavior tests**

Add tests proving:

- An updated account immediately updates the header and list.
- A newly created team appears in the administrator team selector.
- The administrator can create, rename, disable, and re-enable a team.
- A leader sees “新增数采人员”, creates a collector with the leader's own team, edits only display name, resets password, and disables/enables that collector.
- The leader UI contains no role selector, team selector, username edit, administrator creation, or team transfer control.
- Another team's collector is absent even if a malicious fixture includes it in unrelated demo data.

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
cd web
pnpm test -- src/auth/client/AuthContext.test.tsx src/features/admin/accountManagement.test.tsx src/features/team/memberAccountManagement.test.tsx src/layout/DashboardShell.test.tsx
```

Expected: FAIL because `AuthContext` and the approved team management UI are absent.

- [ ] **Step 3: Implement the auth organization provider**

```tsx
type AuthState = AuthBootstrap;

type AuthContextValue = AuthState & {
  upsertAccount(account: AccountPublic): void;
  upsertTeam(team: TeamPublic): void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];
  return items.map((item) => (item.id === next.id ? next : item));
}

export function AuthProvider({
  bootstrap,
  children,
}: {
  bootstrap: AuthBootstrap;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>(bootstrap);
  const upsertAccount = (account: AccountPublic) =>
    setState((current) => ({
      ...current,
      currentAccount:
        current.currentAccount.id === account.id
          ? account
          : current.currentAccount,
      accounts: upsertById(current.accounts, account),
    }));
  const upsertTeam = (team: TeamPublic) =>
    setState((current) => ({
      ...current,
      teams: upsertById(current.teams, team),
    }));
  return (
    <AuthContext.Provider value={{ ...state, upsertAccount, upsertTeam }}>
      {children}
    </AuthContext.Provider>
  );
}
```

Wrap authenticated pages with `AuthProvider` in the server page. Keep `DemoStoreProvider` temporarily for phase-2-and-later demo business screens, but stop using it for route authorization, account lists, teams, or the shell identity chip.

- [ ] **Step 4: Refactor administrator organization management**

Update `UserFormModal` to receive `teams: TeamPublic[]` from props. Remove demo team price text. Add team create/edit/status modals backed by `/api/v1/teams`. Successful account and team writes call `upsertAccount` or `upsertTeam`.

Administrator tests must continue to cover creation of all three roles, duplicate username errors, password confirmation, status confirmation, role/status filters, and self-disable protection.

- [ ] **Step 5: Implement the leader-only collector management surface**

`CollectorAccountFormModal` has two modes:

- Create: `displayName`, `username`, initial password.
- Edit: `displayName` only.

`MembersPage` uses the backend account list, excludes non-team data, and reuses `ResetPasswordModal` and `AccountStatusModal`. The server remains authoritative even if the browser payload is modified.

- [ ] **Step 6: Make audit page persistent-only for phase-1 domains**

The account/team audit table must show only backend audit records for account and team actions. Remove prototype price, settlement, withdrawal, and simulated quality audit rows from this page. Keep stable labels for:

```typescript
const auditActionLabels = {
  account_create: "创建账号",
  account_update: "更新账号",
  account_reset_password: "重置密码",
  account_enable: "启用账号",
  account_disable: "停用账号",
  team_create: "创建团队",
  team_update: "更新团队",
  team_enable: "启用团队",
  team_disable: "停用团队",
} as const;
```

- [ ] **Step 7: Run UI and complete Web tests**

Run:

```bash
cd web
pnpm test -- src/auth src/features/admin src/features/team src/layout
pnpm typecheck
pnpm lint
```

Expected: organization management, shell, authorization, and lint/type checks pass.

- [ ] **Step 8: Commit the real organization UI**

```bash
git add web/src/auth web/src/data/DemoStoreContext.tsx web/src/app/PlatformApp.tsx web/src/layout web/src/features/admin web/src/features/team
git commit -m "feat: add real team and leader account management"
```

---

### Task 10: Align Navigation and Copy with the Approved Product Scope

**Files:**
- Modify: `web/src/app/navigation.ts`
- Modify: `web/src/app/PlatformApp.tsx`
- Modify: `web/src/app/PlatformApp.test.tsx`
- Modify: `web/app/layout.tsx`
- Modify: `web/src/features/auth/LoginPage.tsx`
- Modify: `web/src/layout/DashboardShell.tsx`

**Interfaces:**
- External UI keeps only approved role navigation.

- [ ] **Step 1: Write failing navigation boundary tests**

```typescript
it("removes money, withdrawal, settlement, and customer-service surfaces", () => {
  const labels = Object.values(navigationByRole).flat().map((item) => item.label);
  expect(labels).not.toEqual(
    expect.arrayContaining([
      "收入与提现",
      "团队收入",
      "价格与结算",
      "提现审核",
      "客服消息",
    ]),
  );
});
```

Also assert:

- Collector navigation: dashboard, upload, videos, quality, guide, profile.
- Leader navigation: dashboard, members, team videos, analytics.
- Admin navigation: operations, videos, AI tasks, quality review, accounts/teams, rules, audit.
- The role label is exactly “管理员”, not “平台管理员”.
- Login copy no longer calls the product an “演示数据” experience.
- Metadata no longer mentions settlement.

- [ ] **Step 2: Run navigation tests to verify failure**

Run:

```bash
cd web
pnpm test -- src/app/PlatformApp.test.tsx src/layout/DashboardShell.test.tsx
```

Expected: FAIL because excluded routes remain.

- [ ] **Step 3: Remove excluded routes and imports**

Delete route branches and navigation items for:

- `/collector/earnings`
- `/team/review`
- `/team/income`
- `/admin/settlements`
- `/admin/withdrawals`

Keep necessary system notifications; do not add chat or customer service.

- [ ] **Step 4: Run the focused navigation and shell tests**

Run:

```bash
cd web
pnpm test -- src/app/PlatformApp.test.tsx src/layout/DashboardShell.test.tsx src/features/auth/LoginPage.test.tsx
pnpm typecheck
```

Expected: excluded routes are absent and the approved role labels/copy pass.

- [ ] **Step 5: Commit the scope cleanup**

```bash
git add web/src/app web/src/layout web/src/features/auth/LoginPage.tsx web/app/layout.tsx
git commit -m "refactor: align web navigation with product scope"
```

---

### Task 11: Retire the D1 Identity Runtime After Backend Cutover Tests

**Files:**
- Modify: `web/package.json`
- Modify: `web/pnpm-lock.yaml`
- Modify: `web/vite.config.ts`
- Modify: `web/cloudflare-env.d.ts`
- Delete: `web/app/api/auth/login/route.ts`
- Delete: `web/app/api/auth/logout/route.ts`
- Delete: `web/app/api/auth/session/route.ts`
- Delete: `web/app/api/admin/account-audit/route.ts`
- Delete: `web/app/api/admin/accounts/route.ts`
- Delete: `web/app/api/admin/accounts/[id]/route.ts`
- Delete: `web/app/api/admin/accounts/[id]/reset-password/route.ts`
- Delete: `web/app/api/admin/accounts/[id]/status/route.ts`
- Delete: `web/src/auth/password.ts`
- Delete: `web/src/auth/password.test.ts`
- Delete: `web/src/auth/validation.ts`
- Delete: `web/src/auth/validation.test.ts`
- Delete: `web/src/auth/server/accountService.ts`
- Delete: `web/src/auth/server/accountService.test.ts`
- Delete: `web/src/auth/server/authService.ts`
- Delete: `web/src/auth/server/authService.test.ts`
- Delete: `web/src/auth/server/bootstrapAccounts.ts`
- Delete: `web/src/auth/server/d1AccountRepository.ts`
- Delete: `web/src/auth/server/d1AccountRepository.test.ts`
- Delete: `web/src/auth/server/http.ts`
- Delete: `web/src/auth/server/http.test.ts`
- Delete: `web/src/auth/server/initialCredentials.ts`
- Delete: `web/src/auth/server/initialCredentials.test.ts`
- Delete: `web/src/auth/server/runtime.ts`
- Delete: `web/src/auth/server/testD1.ts`
- Delete: `web/src/auth/server/testFactories.ts`
- Delete: `web/db/index.ts`
- Delete: `web/db/schema.ts`
- Delete: `web/drizzle/0000_account-authentication.sql`
- Delete: `web/drizzle/meta/0000_snapshot.json`
- Delete: `web/drizzle/meta/_journal.json`
- Delete: `web/drizzle.config.ts`

**Interfaces:**
- Web has no D1 binding, Drizzle dependency, credential bootstrap, or local password hashing.
- `web/src/auth/server/access.ts`, `backendClient.ts`, and `backendProxy.ts` remain.
- The remote D1 database is not deleted by this task.

- [ ] **Step 1: Prove the backend bridge covers the retiring runtime**

Before deletion, run:

```bash
cd web
pnpm test -- src/auth src/features/admin src/features/team
```

Expected: the versioned backend client, proxy, route access, administrator UI,
leader UI, and audit UI pass without importing the D1 runtime modules.

- [ ] **Step 2: Delete the exact D1 files and dependencies**

Remove only the files listed above. Preserve `access.ts`, `backendClient.ts`, and `backendProxy.ts`. Remove `drizzle-orm`, `drizzle-kit`, `miniflare`, and the `db:generate` script from `web/package.json`, then regenerate the lockfile:

```bash
cd web
pnpm install --lockfile-only
```

- [ ] **Step 3: Run the entire Web verification set**

Run:

```bash
cd web
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:render
```

Expected: all Web verification commands pass with no D1 binding.

- [ ] **Step 4: Commit the D1 cleanup**

```bash
git add web
git commit -m "refactor: retire d1 identity runtime"
```

---

### Task 12: Add Local Orchestration, Readiness, CI, and the Phase-1 Cutover Checklist

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/app/workers/__init__.py`
- Create: `backend/app/workers/celery_app.py`
- Create: `backend/tests/api/test_readiness.py`
- Create: `backend/tests/unit/test_celery_config.py`
- Modify: `compose.yaml`
- Create: `.env.example`
- Create: `web/.dev.vars.example`
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Modify: `README.md`
- Create: `docs/operations/phase-1-cutover-checklist.md`

**Interfaces:**
- Produces: `GET /api/v1/health/ready`
- Readiness reports only `{"status": "ok"}` when PostgreSQL and Redis respond.
- Produces: `HealthChecks.database_ping() -> Awaitable[bool]`
- Produces: `HealthChecks.redis_ping() -> Awaitable[bool]`
- Produces: `get_health_checks() -> HealthChecks`
- Produces Celery application `app.workers.celery_app.celery_app`.
- Local services: `postgres`, `redis`, `api`, `worker`.
- CI jobs: `backend-unit`, `backend-integration`, `web`.

- [ ] **Step 1: Write failing readiness and Celery configuration tests**

```python
async def test_readiness_requires_database_and_redis() -> None:
    checks = AsyncMock(spec=HealthChecks)
    checks.database_ping.return_value = True
    checks.redis_ping.return_value = True
    app = create_app()
    app.dependency_overrides[get_health_checks] = lambda: checks
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

    checks.redis_ping.return_value = False
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json() == {
        "status": "unavailable",
        "dependencies": {"database": "ok", "redis": "error"},
    }
```

```python
def test_celery_uses_json_and_late_acknowledgement() -> None:
    assert celery_app.conf.task_serializer == "json"
    assert celery_app.conf.accept_content == ["json"]
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
cd backend
uv run pytest tests/api/test_readiness.py tests/unit/test_celery_config.py -v
```

Expected: FAIL because readiness and worker configuration are absent.

- [ ] **Step 3: Implement readiness and the worker foundation**

The readiness endpoint performs a bounded `SELECT 1` and Redis `PING`, each with a two-second timeout. Liveness never depends on external services. Celery must use Redis from `EVDP_REDIS_URL`, JSON-only serialization, late acknowledgements, worker-lost rejection, and UTC.

- [ ] **Step 4: Add container and local service configuration**

`compose.yaml` must define:

- PostgreSQL 17 with separate `evdp` and `evdp_test` databases created by an initialization script.
- Redis 8 with append-only persistence for local parity.
- API running Alembic upgrade before Uvicorn.
- Celery worker using the same image.
- Health checks and named volumes.

No real credentials belong in the file. `.env.example` uses obvious non-production examples and documents every required `EVDP_*` variable. `web/.dev.vars.example` contains:

```dotenv
BACKEND_API_URL=http://127.0.0.1:8000
```

- [ ] **Step 5: Add CI**

The workflow must:

- Use Python 3.12 and Node 22.
- Cache `uv` and pnpm dependencies.
- Run backend Ruff and non-integration tests.
- Start PostgreSQL/Redis service containers for migrations and integration tests.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
- Never inject production secrets.

- [ ] **Step 6: Write the cutover checklist**

`docs/operations/phase-1-cutover-checklist.md` must require:

1. Backup/export D1 outside the repository.
2. Apply PostgreSQL migration.
3. Run legacy importer and compare team/account/audit counts.
4. Test one administrator, one leader, and one collector login with unchanged passwords.
5. Confirm legacy login upgrades only that account to Argon2id.
6. Test leader same-team permissions and cross-team denial.
7. Test reset/disable session revocation.
8. Point Web `BACKEND_API_URL` to production API.
9. Run smoke checks for login, account/team management, audit, logout, liveness, and readiness.
10. Retain the D1 backup for rollback; do not delete D1 during the phase-1 release.

Rollback condition: if authentication, role isolation, or audit write verification fails, restore the previous Web deployment and D1 runtime; do not proceed to phase 2.

- [ ] **Step 7: Run complete phase-1 verification**

Run:

```bash
docker compose up -d postgres redis
cd backend
uv run alembic upgrade head
uv run ruff check app migrations tests
uv run pytest
cd ../web
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:render
```

Expected: all backend, migration, Web, build, and rendered HTML checks pass.

- [ ] **Step 8: Commit operational readiness**

```bash
git add backend/Dockerfile backend/app/workers backend/tests compose.yaml .env.example web/.dev.vars.example .github/workflows/ci.yml .gitignore README.md docs/operations
git commit -m "chore: add phase one operations and ci"
```

---

## Phase-1 Definition of Done

- [ ] FastAPI, PostgreSQL, Redis, and Worker foundations run locally and in CI.
- [ ] Existing D1 accounts and teams import transactionally without plaintext credentials.
- [ ] Existing passwords continue to work and upgrade to Argon2id after successful login.
- [ ] Login, logout, lockout, session expiry, password reset, and account/team disable behavior are tested.
- [ ] Administrator account/team controls are fully persistent.
- [ ] Leader collector management is persistent and server-enforced for the actor's own team.
- [ ] Collector identity access is self-only.
- [ ] Account and team writes produce append-only audit rows.
- [ ] The Web shell, routing, and organization pages use the backend as the source of truth.
- [ ] Excluded money/settlement/withdrawal navigation is removed.
- [ ] D1 runtime code is removed only after migration and cutover tests pass; remote D1 data is retained for rollback.
- [ ] Full backend and Web verification commands pass.
- [ ] The phase-1 cutover checklist has been rehearsed in a non-production environment.
