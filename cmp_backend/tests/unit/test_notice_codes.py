"""Generated notice codes.

A notice code appears on printed consent records and is the identifier a person
uses to talk about "that notice". It has to be readable, and it has to satisfy
the same character rule a hand-typed one does — a generator that emits something
the API would reject if a human typed it is a generator that will fail on some
project name nobody thought about.
"""

from __future__ import annotations

import re

import pytest

from cmp.domain.notices.service import _slug

#: The rule `CodeText` enforces on a notice_code the DPO supplies by hand.
CODE_RULE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


@pytest.mark.parametrize(
    ("project_name", "expected"),
    [
        ("Gait Identification Study 2026", "GAIT-IDENTIFICATION"),
        ("Fix Verification Study", "FIX-VERIFICATION"),
        ("Pune Motion Capture", "PUNE-MOTION-CAPTURE"),
        # Digits lead perfectly well; the rule only forbids a leading separator.
        ("2026 Trial", "2026-TRIAL"),
    ],
)
def test_slug_cuts_on_word_boundaries(project_name: str, expected: str) -> None:
    """Truncation mid-word reads as a bug on a document a data subject receives."""
    assert _slug(project_name) == expected


@pytest.mark.parametrize(
    "project_name",
    [
        "",
        "   ",
        "!!!",
        "…",
        "—-—",
    ],
)
def test_slug_never_produces_an_invalid_code(project_name: str) -> None:
    """A name with nothing usable in it still has to yield a valid code.

    Returning "" or "-" here would surface as a constraint violation at INSERT,
    which the DPO would read as "the system is broken" rather than "your project
    name is punctuation".
    """
    slug = _slug(project_name)
    assert slug == "NOTICE"
    assert CODE_RULE.match(f"NTC-{slug}-2026")


def test_slug_caps_a_single_very_long_word() -> None:
    """One long word is the only case where cutting mid-word is the lesser evil."""
    slug = _slug("Supercalifragilisticexpialidocious Project")
    assert slug == "SUPERCALIFRAGILISTIC"
    assert len(slug) == 20


@pytest.mark.parametrize(
    "project_name",
    [
        "Gait Identification Study 2026",
        "R&D: Phase II (pilot)",
        "café — résumé study",
        "a/b test",
        "100% coverage",
        "under_process naming",
    ],
)
def test_generated_code_always_satisfies_the_hand_typed_rule(project_name: str) -> None:
    """Whatever the project is called, the code it produces would pass validation.

    This is the property that matters. The generator is not held to a nicer
    standard than a human — it is held to exactly the same one.
    """
    code = f"NTC-{_slug(project_name)}-2026"
    assert CODE_RULE.match(code), code
    assert len(code) <= 80
