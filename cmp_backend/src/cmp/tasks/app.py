"""Celery application.

Architecture: FastAPI -> producer -> Redis broker -> worker -> task -> database or
external service.

Every setting below is a decision about what happens when something fails, and
the defaults Celery ships with are wrong for work that touches personal data:

* `task_acks_late=True` - acknowledge *after* the task succeeds, not on receipt.
  If a worker is killed mid-task the message is redelivered rather than lost.
  The cost is at-least-once delivery, which is why every task here is idempotent.
* `task_reject_on_worker_lost=True` - the same guarantee for a hard kill.
* `worker_prefetch_multiplier=1` - a worker takes one task at a time. The default
  of 4 lets one slow worker hoard a queue while its neighbours idle.
* `task_time_limit` and `soft_time_limit` - a task with no time limit is a worker
  slot that can be lost permanently.
* `broker_transport_options.visibility_timeout` must exceed the longest task, or
  Redis redelivers a task that is still running and it executes twice.

Queues are separated by latency requirement, not by subject matter. An OTP email
that queues behind a report is a sign-in the user gave up on.
"""

from __future__ import annotations

from celery import Celery, signals
from celery.schedules import crontab
from kombu import Queue

from cmp.core.config import settings
from cmp.core.logging import configure_logging, get_logger

log = get_logger("cmp.tasks")

celery_app = Celery("cmp")

celery_app.conf.update(
    broker_url=settings.celery_broker_url,
    result_backend=settings.celery_result_backend,

    # --- serialisation: JSON only. Pickle would let a compromised broker
    # execute arbitrary code inside the worker.
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],

    timezone="UTC",
    enable_utc=True,

    # --- delivery guarantees
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_acks_on_failure_or_timeout=True,
    worker_prefetch_multiplier=1,

    # --- limits
    task_time_limit=600,          # hard kill
    task_soft_time_limit=540,     # raises SoftTimeLimitExceeded so a task can clean up
    task_default_retry_delay=10,
    task_max_retries=5,
    result_expires=60 * 60 * 24,

    broker_transport_options={
        "visibility_timeout": 3600,   # > task_time_limit, or work is delivered twice
        "max_retries": 3,
    },
    broker_connection_retry_on_startup=True,
    broker_pool_limit=10,

    # --- observability
    task_send_sent_event=True,
    worker_send_task_events=True,
    task_track_started=True,

    # --- routing
    task_default_queue="default",
    task_queues=(
        Queue("high_priority"),
        Queue("email"),
        Queue("documents"),
        Queue("reports"),
        Queue("notifications"),
        Queue("default"),
    ),
    task_routes={
        "cmp.notifications.send_mfa_code": {"queue": "high_priority"},
        "cmp.notifications.send_login_code": {"queue": "high_priority"},
        "cmp.notifications.send_consent_code": {"queue": "high_priority"},
        "cmp.notifications.send_password_reset": {"queue": "high_priority"},
        "cmp.notifications.*": {"queue": "notifications"},
        "cmp.exports.*": {"queue": "documents"},
        "cmp.imports.*": {"queue": "documents"},
        "cmp.reports.*": {"queue": "reports"},
        "cmp.maintenance.*": {"queue": "default"},
    },

    # --- Beat. Exactly one instance; two produce duplicate scheduled work.
    beat_schedule={
        "expire-consent-links": {
            "task": "cmp.maintenance.expire_consent_links",
            "schedule": crontab(minute="*/15"),
        },
        "apply-retention-lapse": {
            "task": "cmp.maintenance.apply_retention_lapse",
            "schedule": crontab(hour="2", minute="0"),
        },
        "verify-audit-chain": {
            "task": "cmp.maintenance.verify_audit_chain",
            "schedule": crontab(hour="3", minute="0"),
        },
        "flag-unmapped-assets": {
            "task": "cmp.maintenance.flag_unmapped_assets",
            "schedule": crontab(hour="*/6", minute="30"),
        },
    },
)

celery_app.autodiscover_tasks(
    [
        "cmp.tasks.authentication",
        "cmp.tasks.notifications",
        "cmp.tasks.maintenance",
        "cmp.tasks.exchange",
    ], force=True
)


@signals.setup_logging.connect
def _configure_worker_logging(**_: object) -> None:
    """Use our structured logging in the worker too.

    Without this the worker emits Celery's own format and the two halves of a
    request cannot be correlated by request_id.
    """
    configure_logging()


@signals.task_prerun.connect
def _bind_task_context(task_id: str | None = None, task: object = None, **kw: object) -> None:
    """Restore the originating request's correlation id inside the worker.

    The producer puts `request_id` in the task headers; without re-binding it
    here, a task's log lines cannot be joined to the request that queued it.
    """
    from cmp.core.context import RequestContext, set_context

    headers = getattr(task, "request", None)
    request_id = getattr(headers, "request_id", None) if headers else None
    set_context(RequestContext(request_id=str(request_id or task_id or "-")))


@signals.task_failure.connect
def _log_task_failure(
    task_id: str | None = None, exception: BaseException | None = None, **kw: object
) -> None:
    log.error(
        "task.failed",
        task_id=task_id,
        exc_type=type(exception).__name__ if exception else None,
        error=str(exception) if exception else None,
    )


__all__ = ["celery_app"]
