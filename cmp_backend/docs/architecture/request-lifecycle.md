# Request lifecycle

What happens between a socket and a row, in order.

```
CLIENT
  │
  ▼
TrustedHost → CORS → GZip                      bootstrap/middleware.py
  │   a request for a host we do not serve is refused before it reaches
  │   anything that logs or allocates
  ▼
RequestContext                                 api/middleware/request_context.py
  │   mints or adopts a request id, binds it to a contextvar
  │   FIRST, because everything after — including the failure of anything
  │   after — needs somewhere to record which request it was
  ▼
SecurityHeaders                                api/middleware/security_headers.py
  ▼
BodyLimit                                      api/middleware/body_limit.py
  │   refuses an oversized body before anything parses it
  ▼
AccessLog                                      api/middleware/access_log.py
  │   one structured line; the consent token is scrubbed from the path
  ▼
Router match                                   api/routers/{v1,public}/
  ▼
Dependencies                                   api/dependencies/
  │   session ← cookie          sessions.py
  │   CSRF on unsafe verbs      csrf.py
  │   Principal ← session       authentication.py
  │   matrix + row scope        authorization.py
  │   cursor, limit, sort       pagination.py
  │   unknown filters refused   filters.py
  ▼
Domain service, in ONE transaction             domain/*/service.py
  │   validates, mutates, and writes the audit row together
  ▼
Repository                                     db/repositories/
  │   hand-written SQL; scope is a WHERE predicate
  ▼
PostgreSQL
      CHECK constraints · triggers · append-only · revoked grants
```

## Ordering that is load-bearing

**Request context first.** A 500 with no correlation id is a 500 nobody can match
to the report that produced it.

**Body limit above the routes.** Parsing two gigabytes to discover it is too
large is the denial-of-service this prevents.

**Public routers before authenticated ones.** So `/c/{token}` can never be
shadowed by a path parameter on another router.

## The transaction boundary

One transaction per request that writes, opened by the router and passed to the
service. The service does everything inside it — including `audit.record()` —
so a change and its audit row commit together or not at all.

A dependency never opens one. A guard that wrote an audit row would be writing
outside the transaction the service is about to start, so denials are audited by
the layer that has the connection.

## 403 versus 404

**403 means visible but not permitted.** Anything outside your scope is 404,
because a 403 would confirm the row exists — and existence is exactly what the
scope was meant to withhold. This is why scope is a predicate in the query rather
than a check after it: there is nothing to answer 403 *about*.
