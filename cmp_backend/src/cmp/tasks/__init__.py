"""Background task package.

Importing `celery_app` here is load-bearing, not tidiness. `@shared_task` binds
to Celery's *current app* at call time; if the configured app has never been
instantiated, that is a default `Celery()` whose broker is `amqp://localhost`.
The symptom is a task that tries to reach RabbitMQ on a machine that only runs
Redis, and it surfaces as a 500 on whichever endpoint queued it.

Importing the app here means any `from cmp.tasks.x import y` also configures it.
"""

from __future__ import annotations

from cmp.tasks.app import celery_app

__all__ = ["celery_app"]
