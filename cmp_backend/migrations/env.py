"""Alembic environment.

Migrations carry raw SQL, not autogenerate output. The schema in DATA-MODEL.md is
authoritative; autogenerate would derive it from ORM models that do not exist, and
every review would then be a diff against the wrong source of truth.

The URL comes from the validated application settings, so a migration cannot run
against a database the application itself would refuse to boot against.

This runs synchronously on purpose. Migrations are strictly sequential - there is
no concurrency for an event loop to exploit - and the sync driver avoids the
Windows ProactorEventLoop incompatibility that would otherwise make `alembic
upgrade` a Linux-only command.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from cmp.core.config import settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# psycopg 3, synchronous.
DB_URL = settings.dsn.replace("postgresql://", "postgresql+psycopg://")
config.set_main_option("sqlalchemy.url", DB_URL)

target_metadata = None  # raw SQL migrations: nothing to autogenerate from


def run_migrations_offline() -> None:
    """Emit SQL to stdout for review - the deployment gate before a risky change."""
    context.configure(
        url=DB_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(DB_URL, poolclass=pool.NullPool, future=True)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # One transaction per migration: a failure rolls back that revision
            # only, and the stamp reflects exactly what applied.
            transaction_per_migration=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
