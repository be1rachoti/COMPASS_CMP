# syntax=docker/dockerfile:1.7

# Multi-stage build.
#
# The build stage carries uv, compilers and the full lock file. The runtime stage
# carries the virtualenv and the application, and nothing else - no uv, no build
# tools, no lock file. That is roughly a third of the size and, more importantly,
# a much smaller surface: a compiler in a production image is a compiler an
# attacker who lands there can use.
#
# Dependencies are installed before the source is copied, so editing a router
# does not invalidate the dependency layer.

# ----------------------------------------------------------------- build
FROM python:3.12-slim-bookworm AS build

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, from the lock file only. --frozen fails the build if the
# lock is out of date rather than silently resolving something different from
# what was tested.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev

COPY pyproject.toml uv.lock README.md ./
COPY src/ ./src/

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# --------------------------------------------------------------- runtime
FROM python:3.12-slim-bookworm AS runtime

# libpq for psycopg, curl for the health check. Nothing else.
RUN apt-get update \
    && apt-get install --no-install-recommends -y libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

# A non-root user with no shell and no home to write to. If the process is
# compromised, it cannot install anything or leave a login behind.
RUN groupadd --system --gid 1001 cmp \
    && useradd --system --uid 1001 --gid cmp --no-create-home --shell /usr/sbin/nologin cmp

WORKDIR /app

COPY --from=build --chown=cmp:cmp /app/.venv /app/.venv
COPY --chown=cmp:cmp src/ ./src/
COPY --chown=cmp:cmp migrations/ ./migrations/
COPY --chown=cmp:cmp alembic.ini pyproject.toml ./
COPY --chown=cmp:cmp scripts/ ./scripts/

RUN mkdir -p /app/var/uploads && chown -R cmp:cmp /app/var

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH=/app/src \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ENVIRONMENT=production

USER cmp

EXPOSE 8000

# Distinguishes a live process from a ready one: this is liveness, and it must
# not touch the database. A database outage would otherwise fail every replica's
# health check at once and have the orchestrator restart all of them.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

# Gunicorn supervises; uvicorn workers serve. Gunicorn restarts a worker that
# dies, which uvicorn alone does not do.
#
# --timeout 60 with --graceful-timeout 30: a worker gets 30s to finish in-flight
# requests on shutdown, so a rolling deploy drains rather than severs.
# --max-requests with jitter recycles workers to bound any slow leak, and the
# jitter stops every worker recycling in the same second.
CMD ["gunicorn", "cmp.main:app", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--workers", "4", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "60", \
     "--graceful-timeout", "30", \
     "--keep-alive", "5", \
     "--max-requests", "2000", \
     "--max-requests-jitter", "200", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "--capture-output"]
