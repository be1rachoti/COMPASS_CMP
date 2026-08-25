"""File storage, as the rest of the system sees it.

One protocol, one factory, and two named call sites — an approval proof and an
import manifest. Callers say what kind of thing they are storing; they never say
where it goes.

The seam is narrow on purpose. Three methods is the whole surface a backend has
to implement, which is what makes swapping local disk for object storage a
module rather than a project.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Protocol, runtime_checkable

from cmp.core.config import settings
from cmp.infrastructure.storage.local import LocalFileStorage
from cmp.infrastructure.storage.object_store import ObjectStorage


@runtime_checkable
class FileStorage(Protocol):
    """The only three things anything above this layer may ask of storage."""

    def save(self, payload: bytes, *, subdir: str, suggested_name: str) -> str:
        """Store bytes; return the reference to record in the database."""
        ...

    def read(self, reference: str) -> bytes:
        """Read a stored file, or raise `NotFound`."""
        ...

    def delete(self, reference: str) -> bool:
        """Remove it. False if it was not there — deletion is idempotent."""
        ...


#: The two subdirectories that exist. Named rather than passed as strings from
#: the routers, so a typo cannot scatter proofs across `approval/`, `approvals/`
#: and `Approvals/` and leave a set of files nobody can find.
APPROVALS = "approvals"
MANIFESTS = "manifests"


def build_storage() -> FileStorage:
    if settings.storage_backend == "object":
        return ObjectStorage(
            bucket=settings.storage_bucket,
            prefix=settings.storage_prefix,
            region=settings.storage_region,
        )
    return LocalFileStorage()


@lru_cache(maxsize=1)
def storage() -> FileStorage:
    """The process-wide instance."""
    return build_storage()


# ------------------------------------------------------------ named call sites
def save_approval_proof(payload: bytes, filename: str | None) -> str:
    return storage().save(payload, subdir=APPROVALS, suggested_name=filename or "proof")


def save_manifest(payload: bytes, filename: str | None) -> str:
    return storage().save(payload, subdir=MANIFESTS, suggested_name=filename or "manifest.csv")


def read_upload(reference: str) -> bytes:
    return storage().read(reference)


def delete_upload(reference: str) -> bool:
    return storage().delete(reference)
