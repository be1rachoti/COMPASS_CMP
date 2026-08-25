"""File storage for the two upload paths: approval proof and import manifest.

Local filesystem here; object storage in a real deployment. The seam is
deliberate - `save_upload` and `read_upload` are the only functions that know
where bytes live, so swapping to S3 is one module.

Two properties that must survive that swap:

* **The client never chooses the path.** A stored name is derived from a content
  hash and a random component, never from the uploaded filename. Accepting a
  client filename is how `../../etc/passwd` gets written.
* **Reads are confined to the upload root.** Every path is resolved and checked
  to be inside the root before it is opened, so a malformed reference in the
  database cannot become an arbitrary file read.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from cmp.core.config import settings
from cmp.core.errors import NotFound, ValidationFailed
from cmp.core.logging import get_logger
from cmp.core.security import file_hash, new_token

log = get_logger("cmp.storage")

_SAFE_SUFFIX = re.compile(r"^\.[A-Za-z0-9]{1,8}$")


def _root() -> Path:
    root = Path(settings.upload_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def save_upload(payload: bytes, *, subdir: str, suggested_name: str) -> str:
    """Store bytes and return the reference recorded in the database.

    The reference is relative to the upload root. Storing an absolute path would
    break the moment the deployment path changes, and would leak the host layout
    into a table that gets exported.
    """
    if not payload:
        raise ValidationFailed("The file is empty", field="file")
    if len(payload) > settings.max_upload_bytes:
        raise ValidationFailed(
            f"File exceeds {settings.max_upload_bytes // (1024 * 1024)} MB", field="file"
        )

    # Keep only a conservative extension from the client's name; discard the rest.
    suffix = Path(suggested_name).suffix.lower()
    if not _SAFE_SUFFIX.match(suffix):
        suffix = ".bin"

    digest = file_hash(payload)
    # Hash prefix makes duplicates recognisable; the random tail stops one upload
    # from overwriting another with identical content but a different history.
    name = f"{digest[:16]}-{new_token(8)}{suffix}"

    safe_subdir = re.sub(r"[^a-z0-9_-]", "", subdir.lower()) or "misc"
    target_dir = _root() / safe_subdir
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / name

    # Write to a temporary name and rename: a crash mid-write must not leave a
    # truncated file that hashes to something nobody recorded.
    tmp = target.with_suffix(target.suffix + ".part")
    tmp.write_bytes(payload)
    os.replace(tmp, target)

    reference = f"{safe_subdir}/{name}"
    log.info("upload.stored", reference=reference, bytes=len(payload), sha256=digest)
    return reference


def read_upload(reference: str) -> bytes:
    """Read a stored file, refusing anything that escapes the upload root."""
    root = _root()
    candidate = (root / reference).resolve()

    if not candidate.is_relative_to(root):
        # A traversal attempt, or a corrupted reference. Either way, not a read.
        log.error("upload.path_escape", reference=reference)
        raise NotFound("File")

    if not candidate.is_file():
        raise NotFound("File")

    return candidate.read_bytes()


def delete_upload(reference: str) -> bool:
    root = _root()
    candidate = (root / reference).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        return False
    candidate.unlink()
    log.info("upload.deleted", reference=reference)
    return True
