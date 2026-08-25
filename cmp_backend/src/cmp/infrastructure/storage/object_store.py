"""Object storage.

Not wired by default, and deliberately left as a stub rather than a half-working
client: a storage backend that silently fails to persist an approval proof is
worse than one that refuses to start.

What a real implementation must keep, because the rest of the system assumes it:

* **The reference stays relative.** `approvals/ab12…-x9.pdf`, exactly as the
  local backend produces. The bucket and region belong to configuration, not to
  the database — a table that gets exported must not carry the host's topology.
  This is also why swapping backends needs no migration.
* **The client never chooses the key.** Same reasoning as the local backend.
* **A missing object raises `NotFound`.** The router turns that into a 404. A
  backend that returns empty bytes for a missing key produces a zero-length
  "proof" that passes every check except the one that matters.
* **Reads are bounded.** An explicit timeout, never infinite.
"""

from __future__ import annotations

from cmp.core.errors import ServiceUnavailable
from cmp.core.logging import get_logger

log = get_logger("cmp.infrastructure.storage.object")


class ObjectStorage:
    """S3-compatible storage. Implement before enabling.

    Raising rather than no-op'ing is the point: if somebody sets
    `STORAGE_BACKEND=object` without finishing this, the first upload fails
    loudly at the boundary instead of returning a reference that resolves to
    nothing three months later, when the proof is needed.
    """

    def __init__(self, bucket: str, *, prefix: str = "", region: str | None = None) -> None:
        self._bucket = bucket
        self._prefix = prefix.strip("/")
        self._region = region

    def _unimplemented(self) -> ServiceUnavailable:
        return ServiceUnavailable(
            "Object storage is configured but not implemented. "
            "Set STORAGE_BACKEND=local, or implement ObjectStorage.",
        )

    def save(self, payload: bytes, *, subdir: str, suggested_name: str) -> str:
        raise self._unimplemented()

    def read(self, reference: str) -> bytes:
        raise self._unimplemented()

    def delete(self, reference: str) -> bool:
        raise self._unimplemented()
