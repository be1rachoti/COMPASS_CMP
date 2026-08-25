"""The domain: business rules, and the only layer that writes.

One package per aggregate, each owning the rules for one part of the system and
serving as the single path to writing it. A service is also the only thing that
calls the audit recorder, which is what makes "every change is recorded" a
property of the structure rather than a convention.

Nothing here imports FastAPI or knows what an HTTP status code is. A service
takes a connection, a principal id and role, and plain values; it raises domain
exceptions and lets the API layer decide what those become on the wire. That is
what lets the same service be called from a Celery task or a script.
"""
