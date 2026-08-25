"""Local filesystem storage.

The default backend, and the one a single-node deployment keeps. Two properties
matter more than anything else here, and both survive a swap to object storage:

* **The client never chooses the path.** A stored name is derived from a content
  hash plus a random tail — never from the uploaded filename. Accepting a client
  filename is how `../../etc/passwd` gets written, and how one upload silently
  overwrites another.
* **Reads are confined to the root.** Every path is resolved and checked to be
  inside the upload root before it is opened, so a corrupted reference in the
  database becomes a 404 rather than an arbitrary file read.

The random tail is not decoration. Two uploads with identical content hash
identically; without the tail, the second would overwrite the first and the two
approvals would share a file with one upload history between them.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from cmp.core.config import settings
from cmp.core.errors import NotFound, ValidationFailed
from cmp.core.logging import get_logger
from cmp.core.security import file_hash, new_token

log = get_logger("cmp.infrastructure.storage.local")

#: A conservative extension allow-list. Anything else is stored as `.bin` — the
#: file is still kept, hashed and downloadable, it simply cannot claim on disk
#: to be something executable.
_SAFE_SUFFIX = re.compile(r"^\.[A-Za-z0-9]{1,8}$")


class LocalFileStorage:
    """Bytes on the local disk, under `settings.upload_root`."""

    def __init__(self, root: str | None = None) -> None:
        self._configured_root = root

    @property
    def root(self) -> Path:
        root = Path(self._configured_root or settings.upload_root).resolve()
        root.mkdir(parents=True, exist_ok=True)
        return root

    def save(self, payload: bytes, *, subdir: str, suggested_name: str) -> str:
        """Store bytes; return the reference recorded in the database.

        The reference is *relative* to the root. An absolute path would break
        the moment the deployment path changes, and would leak the host's
        directory layout into a table that gets exported.
        """
        if not payload:
            raise ValidationFailed("The file is empty", field="file")
        if len(payload) > settings.max_upload_bytes:
            raise ValidationFailed(
                f"File exceeds {settings.max_upload_bytes // (1024 * 1024)} MB", field="file"
            )

        suffix = Path(suggested_name).suffix.lower()
        if not _SAFE_SUFFIX.match(suffix):
            suffix = ".bin"

        digest = file_hash(payload)
        name = f"{digest[:16]}-{new_token(8)}{suffix}"

        safe_subdir = re.sub(r"[^a-z0-9_-]", "", subdir.lower()) or "misc"
        target_dir = self.root / safe_subdir
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / name

        # Write to a temporary name and rename. A crash mid-write must not leave
        # a truncated file that hashes to something nobody recorded — on a proof
        # of approval, that is a file whose integrity check will fail forever
        # with no way to tell whether it was tampered with or merely interrupted.
        tmp = target.with_suffix(target.suffix + ".part")
        tmp.write_bytes(payload)
        os.replace(tmp, target)

        reference = f"{safe_subdir}/{name}"
        log.info("upload.stored", reference=reference, bytes=len(payload), sha256=digest)
        return reference

    def read(self, reference: str) -> bytes:
        root = self.root
        candidate = (root / reference).resolve()

        if not candidate.is_relative_to(root):
            # Traversal attempt, or a corrupted reference. Either way, not a read.
            log.error("upload.path_escape", reference=reference)
            raise NotFound("File")

        if not candidate.is_file():
            raise NotFound("File")

        return candidate.read_bytes()

    def delete(self, reference: str) -> bool:
        root = self.root
        candidate = (root / reference).resolve()
        if not candidate.is_relative_to(root) or not candidate.is_file():
            return False
        candidate.unlink()
        log.info("upload.deleted", reference=reference)
        return True
