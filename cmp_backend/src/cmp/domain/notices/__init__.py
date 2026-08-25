"""Notice authoring and publication.

Publication is the moment the platform makes a promise it must keep. In one
transaction it validates every Rule 3 element, generates the recipients line from
the project sites, computes a SHA-256 per language rendition, and marks the
notice published.

After that the text is immutable. The database refuses an edit (migration 0002)
and this package offers no path to one - a correction is a new version, which is
what keeps "show me what she agreed to" answerable from the artefact alone.
"""

from cmp.domain.notices.service import (
    approve_language,
    attach_purpose,
    checklist,
    copy_from,
    create,
    detach_purpose,
    generate_code,
    preview,
    publish,
    publish_current,
    set_language,
    update,
)

__all__ = [
    "approve_language",
    "attach_purpose",
    "checklist",
    "copy_from",
    "create",
    "detach_purpose",
    "generate_code",
    "preview",
    "publish",
    "publish_current",
    "set_language",
    "update",
]
