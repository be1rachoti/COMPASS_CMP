"""Exports and imports.

Data leaving and data arriving, and the two have opposite risks.

An **export** is a disclosure: it writes an `export_line` per person so s.11(1)(b)
- who has my data been shared with - is answerable. Generating and downloading
are separate steps, because regenerating to re-download would write duplicate
lines and corrupt the disclosure record.

An **import** is untrusted input from a third-party capture tool. It is validated
before anything is written, idempotent on (source, source_reference) so a re-sent
file writes nothing, and it reports `partial` honestly rather than pretending a
half-landed batch succeeded.
"""

from cmp.domain.exchange.service import (
    generate,
    import_manifest,
    parse_manifest,
    render,
    validate,
    validate_rows,
)

__all__ = [
    "generate",
    "import_manifest",
    "parse_manifest",
    "render",
    "validate",
    "validate_rows",
]
