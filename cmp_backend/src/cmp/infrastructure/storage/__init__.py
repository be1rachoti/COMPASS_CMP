"""File storage for the two upload paths: approval proof and import manifest."""

from cmp.infrastructure.storage.local import LocalFileStorage
from cmp.infrastructure.storage.object_store import ObjectStorage
from cmp.infrastructure.storage.service import (
    APPROVALS,
    MANIFESTS,
    FileStorage,
    build_storage,
    delete_upload,
    read_upload,
    save_approval_proof,
    save_manifest,
    storage,
)

__all__ = [
    "APPROVALS",
    "MANIFESTS",
    "FileStorage",
    "LocalFileStorage",
    "ObjectStorage",
    "build_storage",
    "delete_upload",
    "read_upload",
    "save_approval_proof",
    "save_manifest",
    "storage",
]
