"""The permission matrix and the paging conventions.

Both are cross-cutting: every route reads one and every list route reads the
other, so a mistake here is a mistake everywhere at once.
"""

from __future__ import annotations

import pytest

from cmp.core.errors import BadRequest
from cmp.core.pagination import Cursor, build_page, parse_page
from cmp.core.permissions import (
    NAV_BY_ROLE,
    Role,
    Scope,
    can_read,
    can_write,
    nav_for,
    scope_of,
)


class TestPermissionMatrix:
    def test_audit_is_read_only_for_every_role(self) -> None:
        """No role has write on the audit trail.

        The Privacy Office is audited by that table; a DPO who can edit her own
        audit trail makes it worthless as evidence. This is enforced in three
        places - the matrix, the grants, and a trigger - and this test pins the
        first.
        """
        for role in Role:
            assert can_write("audit", role) is False

    def test_only_dpo_and_admin_read_the_audit_trail(self) -> None:
        assert can_read("audit", Role.DPO) is True
        assert can_read("audit", Role.ADMIN) is True
        assert can_read("audit", Role.DCO) is False
        assert can_read("audit", Role.RND_USER) is False
        assert can_read("audit", Role.DATA_SUBJECT) is False

    def test_project_scope_by_role(self) -> None:
        """Scope is what turns into a WHERE clause. Widening one of these silently
        widens what a role can see across every project route."""
        assert scope_of("project", Role.DPO) is Scope.ALL
        assert scope_of("project", Role.DCO) is Scope.SCOPED
        assert scope_of("project", Role.RND_USER) is Scope.OWN
        assert scope_of("project", Role.ADMIN) is Scope.NONE

    def test_admin_manages_accounts_not_collections(self) -> None:
        """Separation of duties: the person who can create accounts must not also
        be able to read the personal data those accounts collect."""
        assert scope_of("project", Role.ADMIN) is Scope.NONE
        assert scope_of("consent", Role.ADMIN) is Scope.NONE
        assert can_write("user", Role.ADMIN) is True

    def test_dpo_reads_the_user_register_but_does_not_provision(self) -> None:
        assert can_read("user", Role.DPO) is True
        assert can_write("user", Role.DPO) is False

    def test_only_dpo_writes_purposes(self) -> None:
        assert can_write("purpose", Role.DPO) is True
        for role in (Role.DCO, Role.RND_USER, Role.ADMIN):
            assert can_write("purpose", role) is False
            assert can_read("purpose", role) is True

    def test_data_subject_reaches_nothing_but_their_own_records(self) -> None:
        for resource in ("project", "notice", "consent", "audit", "user", "export"):
            assert can_read(resource, Role.DATA_SUBJECT) is False
        assert scope_of("me", Role.DATA_SUBJECT) is Scope.OWN

    def test_unknown_resource_or_role_denies(self) -> None:
        assert can_read("nonexistent", Role.DPO) is False
        assert can_read("project", "not_a_role") is False
        assert scope_of("project", "not_a_role") is Scope.NONE

    def test_every_nav_entry_is_backed_by_a_real_role(self) -> None:
        for role in NAV_BY_ROLE:
            assert isinstance(role, Role)
            assert nav_for(role)

    def test_nav_for_unknown_role_is_empty_not_an_error(self) -> None:
        assert nav_for("nonsense") == []


class TestCursorPagination:
    def test_round_trip(self) -> None:
        cursor = Cursor(sort_value="2026-01-01T00:00:00+00:00", row_id=42)
        assert Cursor.decode(cursor.encode()) == cursor

    def test_cursor_is_opaque(self) -> None:
        """Nobody should be able to read a cursor and start hand-crafting one."""
        encoded = Cursor(sort_value="2026-01-01", row_id=7).encode()
        assert "2026-01-01" not in encoded
        assert "7" not in encoded.replace("=", "")

    def test_tampered_cursor_is_rejected(self) -> None:
        """A cursor is interpolated into the next query's comparison. An unsigned
        one is an injection vector; a signed one either verifies or is a 400."""
        encoded = Cursor(sort_value="2026-01-01", row_id=7).encode()
        with pytest.raises(BadRequest) as exc:
            Cursor.decode(encoded[:-4] + "AAAA")
        assert exc.value.code == "bad_cursor"

    @pytest.mark.parametrize("bad", ["", "not-base64!!", "YQ", "!!!!"])
    def test_malformed_cursors_are_rejected(self, bad: str) -> None:
        with pytest.raises(BadRequest):
            Cursor.decode(bad)

    def test_unknown_sort_field_is_rejected(self) -> None:
        """Sort fields are interpolated as identifiers, so the allow-list is a
        security boundary and not merely a nicety."""
        with pytest.raises(BadRequest) as exc:
            parse_page(
                limit=10,
                cursor=None,
                sort="password_hash",
                allowed_sorts=["created_at"],
                default_sort="created_at",
            )
        assert exc.value.code == "bad_sort"

    def test_descending_prefix(self) -> None:
        req = parse_page(
            limit=10,
            cursor=None,
            sort="-created_at",
            allowed_sorts=["created_at"],
            default_sort="created_at",
        )
        assert req.descending is True
        assert req.sort_field == "created_at"

    @pytest.mark.parametrize("limit", [0, -1, 10_000])
    def test_limit_bounds_are_enforced(self, limit: int) -> None:
        with pytest.raises(BadRequest) as exc:
            parse_page(
                limit=limit,
                cursor=None,
                sort=None,
                allowed_sorts=["created_at"],
                default_sort="created_at",
            )
        assert exc.value.code == "bad_limit"

    def test_fetch_limit_probes_one_extra_row(self) -> None:
        """One extra row answers "is there a next page?" without a second query."""
        req = parse_page(
            limit=25,
            cursor=None,
            sort=None,
            allowed_sorts=["created_at"],
            default_sort="created_at",
        )
        assert req.fetch_limit == 26

    def test_build_page_trims_probe_and_mints_cursor(self) -> None:
        req = parse_page(
            limit=2,
            cursor=None,
            sort="-created_at",
            allowed_sorts=["created_at"],
            default_sort="-created_at",
        )
        rows = [
            {"_row_id": 3, "created_at": "2026-01-03", "name": "c"},
            {"_row_id": 2, "created_at": "2026-01-02", "name": "b"},
            {"_row_id": 1, "created_at": "2026-01-01", "name": "a"},  # the probe
        ]
        items, next_cursor = build_page(rows, req)

        assert len(items) == 2
        assert next_cursor is not None
        # The int primary key never leaves the process.
        assert all("_row_id" not in row for row in items)
        # The cursor points at the last kept row, not the probe.
        assert Cursor.decode(next_cursor).row_id == 2

    def test_no_next_cursor_on_the_last_page(self) -> None:
        req = parse_page(
            limit=5,
            cursor=None,
            sort="-created_at",
            allowed_sorts=["created_at"],
            default_sort="-created_at",
        )
        rows = [{"_row_id": 1, "created_at": "2026-01-01"}]
        items, next_cursor = build_page(rows, req)
        assert len(items) == 1
        assert next_cursor is None
