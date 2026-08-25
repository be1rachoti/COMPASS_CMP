"""Validation primitives.

The types every request model is built from, and the shared checks that are not
about a single field.

Imported from `cmp.validation` rather than from the individual modules, so a
schema reads as a list of what its fields *are* rather than a list of where its
types live:

    from cmp.validation import CodeText, Email, HttpUrl, LongText

This package depends on `cmp.core` and nothing else. It must never import from
`api`, `domain`, `auth` or `db` — a validation type that knows about a service
is a circular import waiting for the next person to add a field.
"""

from __future__ import annotations

from cmp.validation.common import (
    normalise_login,
    reject_unknown_keys,
    require_aware,
    require_future,
    require_non_empty,
)
from cmp.validation.contacts import Contact, Email, Mobile
from cmp.validation.files import MANIFEST, PROOF, UploadRules, check_upload, safe_suffix
from cmp.validation.identifiers import InternalId, LinkToken, OrganizationId, Uuid
from cmp.validation.pagination import Cursor, PageLimit, SearchTerm, SortSpec
from cmp.validation.security import OtpCode, Password, ResetToken, Sha256Hex
from cmp.validation.strings import CodeText, LongText, ReasonText, RefText, ShortText
from cmp.validation.urls import HttpUrl, StorageRef

__all__ = [
    "MANIFEST",
    "PROOF",
    "CodeText",
    "Contact",
    "Cursor",
    "Email",
    "HttpUrl",
    "InternalId",
    "LinkToken",
    "LongText",
    "Mobile",
    "OrganizationId",
    "OtpCode",
    "PageLimit",
    "Password",
    "ReasonText",
    "RefText",
    "ResetToken",
    "SearchTerm",
    "Sha256Hex",
    "ShortText",
    "SortSpec",
    "StorageRef",
    "UploadRules",
    "Uuid",
    "check_upload",
    "normalise_login",
    "reject_unknown_keys",
    "require_aware",
    "require_future",
    "require_non_empty",
    "safe_suffix",
]
