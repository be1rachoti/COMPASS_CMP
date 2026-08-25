# Monitoring

## Logs

Structured, JSON in production, via structlog. Every line carries `request_id`.

The correlation id is minted by the first middleware and bound to a contextvar,
so a log line from the bottom of the stack carries it without anybody threading
it through four hundred signatures. A client-supplied `X-Request-ID` is honoured
so a caller can correlate across systems — sanitised and bounded first, because it
reaches a log line.

## What to alert on

| Signal | Means |
|---|---|
| `auth.login_locked_out` rate rising | Credential stuffing |
| `auth.access_denied` rate rising | Probing, or a permission change broke a workflow |
| `cmp.maintenance.verify_audit_chain` reporting a break | Investigate immediately — the trail has been tampered with or corrupted |
| `notification.batch_partial` | A transport is failing for some recipients |
| `upload.path_escape` | Traversal attempt, or a corrupted reference |
| Queue depth on `high_priority` | Somebody is waiting for a sign-in code |

The audit chain alert is the one that matters most and fires least. Treat it as a
page, not a ticket.

## Metrics

Prometheus at `/metrics`, if the instrumentator is installed. Untemplated
handlers are excluded, which is what keeps a consent token out of a metric label
— an unbounded label set is both a memory leak and a credential in a scrape
endpoint.

## What is deliberately not logged

Passwords, one-time codes, session tokens, consent link tokens, and the contents
of a data asset. The access log scrubs `/c/{token}` to `/c/[token]`, because a
link in a log file is a credential in a file that gets shipped to an aggregator
and read by people who were never meant to hold it.

## Reading the audit trail

`GET /audit` with filters, or the console's Audit trail screen. Each entry
resolves its `entity_type`/`entity_id` into a label and a link, so "Notice
published" says *which* notice.

For "what happened to this person's data", filter by `subject`. That is the DSAR
query, and it is backed by `idx_audit_subject`.
