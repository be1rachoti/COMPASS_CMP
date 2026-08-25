# Deployment

## Requirements

PostgreSQL 16+, Redis 7+, Python 3.12.

## Processes

| Process | Command | Notes |
|---|---|---|
| API | `gunicorn cmp.main:app -k uvicorn.workers.UvicornWorker` | Stateless; scale horizontally |
| Worker | `celery -A cmp.tasks.app worker -Q high_priority,notifications,documents,default` | Scale per queue |
| Beat | `celery -A cmp.tasks.app beat` | **Exactly one.** Two produce duplicate scheduled work |

## Order of operations

1. `alembic upgrade head`
2. Roll the API
3. Roll the workers

Migrations first, because the API checks the schema version at startup and warns
if it is missing. The API tolerates a schema newer than itself; it does not
tolerate an older one.

## Startup is fail-fast

If PostgreSQL or Redis is unreachable, the process exits rather than serving a
stream of 503s that look like an application bug. An orchestrator can restart a
dead process; it cannot diagnose a live one that is quietly broken.

Production also refuses to start on any of five conditions — see
[configuration.md](configuration.md).

## Health endpoints

| Endpoint | Answers |
|---|---|
| `/health` | The process is up. For the load balancer |
| `/ready` | The database and Redis are reachable. For the orchestrator |

Keep them distinct. A readiness check wired to a liveness probe restarts a
perfectly good process every time the database blips.

## What is disabled in production

`/docs`, `/redoc` and `/openapi.json`. They enumerate every route and schema for
an unauthenticated reader.

## Queue sizing

`high_priority` carries codes somebody is waiting for with a box open. Give it
its own workers. A sign-in code queued behind a document export is a failed
sign-in and a support call.
