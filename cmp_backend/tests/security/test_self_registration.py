"""Data-subject self-registration, and the date of birth it captures.

Sign-up is the only endpoint on this platform that creates an account without an
authenticated caller, which makes it the one place two failures are cheap to
introduce and expensive to find.

**Role escalation.** A body that carries a role, on an unauthenticated endpoint,
is how a sign-up form mints a DPO. The service writes the role itself; these
tests assert that a caller cannot influence it.

**Account enumeration.** A consent register's user list is close to "who is in
this study". A sign-up that answers differently for a known address turns the
form into a membership oracle, so registering an existing contact must be
indistinguishable from registering a new one.

The date of birth is not a profile field here. Section 9 of the DPDP Act treats
a person under eighteen as a child and requires verifiable parental consent, so
`dob` is the input to a statutory test - and `is_minor` being NULL for an unknown
date, rather than False, is the difference between "we do not know" and "we
checked and they are an adult".
"""

from __future__ import annotations

# `redis_conn` is requested by the tests that reach the rate limiter. It is
# function-scoped because a redis-py connection belongs to the event loop it was
# created on, and the limiter fails closed rather than open - so without it these
# tests fail with ServiceUnavailable rather than silently skipping the check.
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest

from cmp.auth.authentication import service as auth_service
from cmp.db.repositories import users as user_repo

pytestmark = pytest.mark.anyio


def _years_ago(n: int) -> str:
    today = datetime.now(UTC).date()
    return (today - timedelta(days=365 * n + n // 4)).isoformat()


async def _count(conn: Any) -> int:
    cur = await conn.execute("SELECT count(*) AS n FROM auth_user")
    return int((await cur.fetchone())["n"])


# --------------------------------------------------------------- the happy path


async def test_registration_creates_a_pending_data_subject(
    conn: Any, seeded: dict[str, Any], redis_conn: Any
) -> None:
    await auth_service.register_data_subject(
        conn,
        full_name="Asha Menon",
        email="asha.menon@example.org",
        dob=_years_ago(30),
        # Deliberately outside any range the seed uses: `auth_user.mobile` is
        # UNIQUE, and a collision here would look like a registration bug.
        mobile="+915550000042",
    )

    user = await user_repo.by_contact(conn, "asha.menon@example.org")
    assert user is not None
    assert user["role"] == "data_subject"
    # Pending, not active: the account is not usable until the code is verified.
    assert user["status"] == "pending"
    assert user["is_minor"] is False


async def test_a_minor_is_identified_as_one(
    conn: Any, seeded: dict[str, Any], redis_conn: Any
) -> None:
    """Section 9 turns on this, so it is asserted rather than assumed."""
    await auth_service.register_data_subject(
        conn, full_name="Child Account", email="child@example.org", dob=_years_ago(12)
    )

    user = await user_repo.by_contact(conn, "child@example.org")
    assert user["is_minor"] is True


async def test_someone_who_turns_eighteen_is_no_longer_a_minor(conn: Any) -> None:
    """The boundary, from both sides, computed by the database.

    Written against `cmp_is_minor` directly because the interesting property is
    that the answer changes with the date rather than with the row - a person
    becomes an adult without anything being written.
    """
    today = datetime.now(UTC).date()

    cur = await conn.execute(
        "SELECT cmp_is_minor(%s::date) AS a, cmp_is_minor(%s::date) AS b",
        (
            (today.replace(year=today.year - 18) + timedelta(days=1)).isoformat(),  # a day short
            (today.replace(year=today.year - 18) - timedelta(days=1)).isoformat(),  # a day over
        ),
    )
    row = await cur.fetchone()
    assert row["a"] is True, "one day short of eighteen is still a child"
    assert row["b"] is False, "one day past eighteen is not"


async def test_an_unknown_date_of_birth_is_not_an_adult(conn: Any, seeded: dict[str, Any]) -> None:
    """NULL means unknown. Rendering it as False would assert a check nobody ran."""
    existing = await user_repo.by_id(conn, seeded["users"]["dpo"]["id"])

    assert existing["dob"] is None
    assert existing["is_minor"] is None, "unknown must not collapse to False"


# ------------------------------------------------------------------- the guards


async def test_registration_cannot_choose_its_own_role(
    conn: Any, seeded: dict[str, Any], redis_conn: Any
) -> None:
    """The one that matters.

    `register_data_subject` takes no role parameter at all, which is the point -
    there is no field for a caller to influence. Asserted by signature so that
    adding one later fails here rather than in production.
    """
    import inspect

    params = set(inspect.signature(auth_service.register_data_subject).parameters)
    assert "role" not in params
    assert "status" not in params
    assert "person_type" not in params

    await auth_service.register_data_subject(
        conn, full_name="Not A DPO", email="notadpo@example.org", dob=_years_ago(40)
    )
    assert (await user_repo.by_contact(conn, "notadpo@example.org"))["role"] == "data_subject"


async def test_registering_a_known_contact_creates_nothing_and_does_not_say_so(
    conn: Any, seeded: dict[str, Any], redis_conn: Any
) -> None:
    """Sign-up must not become a membership oracle.

    The DPO's address already exists. Registering it must not create a second
    account, must not raise, and must not behave observably differently from
    registering a new one - the caller learns nothing either way.
    """
    before = await _count(conn)

    await auth_service.register_data_subject(
        conn, full_name="Impostor", email="dpo@test.local", dob=_years_ago(33)
    )

    assert await _count(conn) == before, "no account created for an existing contact"
    # And the existing account is untouched - not renamed, not demoted.
    dpo = await user_repo.by_contact(conn, "dpo@test.local")
    assert dpo["role"] == "dpo"
    assert dpo["full_name"] != "Impostor"


async def test_an_implausible_date_is_refused_by_the_database(
    conn: Any, seeded: dict[str, Any]
) -> None:
    """The API rejects these first; this asserts the floor underneath it.

    A validator can be bypassed by a future caller that does not use the schema.
    The CHECK cannot.
    """
    import psycopg

    with pytest.raises(psycopg.errors.CheckViolation):
        await user_repo.create(
            conn,
            full_name="Time Traveller",
            email="future@example.org",
            role="data_subject",
            dob=(datetime.now(UTC).date() + timedelta(days=1)).isoformat(),
        )


async def test_a_date_of_birth_can_be_corrected_later(conn: Any, seeded: dict[str, Any]) -> None:
    """Accounts made through a consent link were never asked, so it must be
    fillable afterwards - otherwise the section 9 test has no input for exactly
    the people the platform registered itself."""
    subject_id = seeded["subject"]["id"]
    assert (await user_repo.by_id(conn, subject_id))["dob"] is None

    updated = await user_repo.update_profile(conn, subject_id, dob=_years_ago(15))

    assert updated["dob"] == date.fromisoformat(_years_ago(15))
    assert updated["is_minor"] is True


async def test_omitting_the_date_on_a_profile_update_leaves_it_alone(
    conn: Any, seeded: dict[str, Any]
) -> None:
    """COALESCE semantics: a partial update must not blank a field it did not
    mention, least of all this one."""
    subject_id = seeded["subject"]["id"]
    await user_repo.update_profile(conn, subject_id, dob=_years_ago(20))

    after = await user_repo.update_profile(conn, subject_id, full_name="Renamed Only")

    assert after["full_name"] == "Renamed Only"
    assert after["dob"] is not None, "an unmentioned date of birth must survive"
