"""Create the first administrator.

The bootstrap problem: provisioning accounts requires an admin, and a fresh
deployment has none. This is the one way to make the first one, and it is
deliberately a script rather than an endpoint — an endpoint that creates
administrators is an endpoint somebody will eventually reach.

    uv run python scripts/create_admin.py --email you@org.example --name "Your Name"

The password is read from the `CMP_ADMIN_PASSWORD` environment variable, or
prompted for. It is never a command-line argument: arguments appear in shell
history, in `ps` output, and in a container's process list.

Refuses to create a second administrator. Once one exists, the rest are
provisioned through the API, where the act is audited and attributable — which
is the point.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys

sys.path.insert(0, "src")

MIN_PASSWORD_LENGTH = 12


async def create(email: str, full_name: str, password: str) -> int:
    from cmp.core.security import hash_password
    from cmp.db.pool import close_pool, open_pool, transaction

    await open_pool()
    try:
        async with transaction() as conn:
            cur = await conn.execute("SELECT count(*) AS n FROM auth_user WHERE role = 'admin'")
            if (await cur.fetchone())["n"] > 0:
                sys.stderr.write(
                    "An administrator already exists.\n\n"
                    "Provision further accounts through the API, where the act is "
                    "audited and attributable to whoever performed it. That is the "
                    "reason this script refuses.\n"
                )
                return 1

            cur = await conn.execute(
                "SELECT 1 FROM auth_user WHERE lower(email) = lower(%s)", (email,)
            )
            if await cur.fetchone():
                sys.stderr.write(f"An account already exists for {email}.\n")
                return 1

            cur = await conn.execute(
                """INSERT INTO auth_user
                     (full_name, email, username, role, person_type, status, password_hash)
                   VALUES (%s, %s, %s, 'admin', 'employee', 'active', %s)
                   RETURNING uuid""",
                (full_name, email, email.split("@")[0], hash_password(password)),
            )
            created = await cur.fetchone()

            # Audited like any other provisioning, with a null actor — nobody was
            # signed in, and recording a fictional actor would be worse than
            # recording none. The detail says how it happened.
            await conn.execute(
                """INSERT INTO audit_log (event_type, entity_type, entity_id, detail_json)
                   SELECT 'user.created', 'auth_user', id,
                          jsonb_build_object('role', 'admin', 'via', 'scripts/create_admin.py',
                                             'bootstrap', true)
                   FROM auth_user WHERE uuid = %s""",
                (created["uuid"],),
            )

        sys.stdout.write(f"Administrator created: {email}  ({created['uuid']})\n")
        return 0
    finally:
        await close_pool()


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the first administrator.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True, help="full name, as it should appear")
    args = parser.parse_args()

    password = os.environ.get("CMP_ADMIN_PASSWORD") or getpass.getpass(
        f"Password for {args.email} (min {MIN_PASSWORD_LENGTH} chars): "
    )

    if len(password) < MIN_PASSWORD_LENGTH:
        sys.stderr.write(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters.\n"
            "Length beats composition rules — a passphrase you can remember beats "
            "a short one you write down.\n"
        )
        return 1

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    return asyncio.run(create(args.email, args.name, password))


if __name__ == "__main__":
    raise SystemExit(main())
