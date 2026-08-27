"""Development seed.

Creates one coherent world so the API can be exercised end to end: a user per
role, the processors and data sources routing is defined against, two
purposes, and a project carried through the
whole state machine to `approved` with a published notice and a live consent link.

Refuses to run outside local/test. A seed that can run in production is a
production database with known passwords in it.

    uv run python scripts/seed.py
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, date, datetime, timedelta

from cmp.core.config import settings
from cmp.core.context import RequestContext, use_context
from cmp.core.logging import configure_logging, get_logger
from cmp.core.security import content_hash, hash_password, new_token, token_fingerprint
from cmp.db.pool import close_pool, open_pool, transaction
from cmp.db.redis import close_redis, open_redis
from cmp.db.sql import fetch_one

log = get_logger("cmp.seed")

PASSWORD = "SeedPassw0rd!2026"  # noqa: S105 - development only, guarded below

USERS = [
    ("Priya Menon", "dpo@cmp.local", "dpo", "employee", "ORG-DPO-001"),
    ("Arun Shetty", "dco@cmp.local", "dco", "employee", "ORG-DCO-001"),
    ("Kavya Rao", "rnd@cmp.local", "rnd_user", "employee", "ORG-RND-001"),
    ("System Admin", "admin@cmp.local", "admin", "employee", "ORG-ADM-001"),
    ("Nikhil Bose", "dcoadmin@cmp.local", "dco_admin", "employee", "ORG-DCA-001"),
    ("Meera Iyer", "rco@cmp.local", "rco", "employee", "ORG-RCO-001"),
]

# The two processors the routing rules are written against, and they differ in
# exactly one way that matters: who is doing the collecting.
#
# SEED is somebody else. An approved project naming it goes to a DCO Admin, who
# picks the data sources - and because a source carries its own owner, picking
# the sources is what decides which DCO ends up with the work.
#
# SRIB is us. Nothing leaves the building and there is no DCO to route to, so an
# approved project goes back to the R&D owner, who names the sources and an RCO.
#
# Neither rule reads a name. `is_in_house` is the flag, so a third in-house team
# tomorrow is a row and not a code change.
COLLECTION = [
    (
        "SEED",
        False,
        "lab",
        "CTR-2026-0114",
        [("SRC-SEED-CIT", "CIT"), ("SRC-SEED-VIT", "VIT")],
    ),
    (
        "SRIB",
        True,
        "other",
        # No contract reference: an in-house team has no contract with itself.
        # The column is NOT NULL, so it says why rather than sitting empty.
        "in-house - no processor contract",
        [("SRC-SRIB-SE", "SE"), ("SRC-SRIB-VOICE", "Voice")],
    ),
]

NOTICE_TEXT = """\
NOTICE UNDER SECTION 5, DIGITAL PERSONAL DATA PROTECTION ACT 2023

Who is asking. Bharat Research Labs, acting as Data Fiduciary.

What we will collect. Your name, mobile number, and a facial image and short
gait video recorded at the collection site.

Why. To build and evaluate machine-learning models for gait-based
identification, and to verify the quality of the recordings we collect.

How long we keep it. Three years from the date of collection, after which the
recordings are erased.

Who else sees it. The recipients named at the end of this notice.

Your rights. You may ask for a summary of your data, ask us to correct or erase
it, nominate someone to act for you, and withdraw your consent. Withdrawing is
as easy as giving consent was. Withdrawal stops future processing; it does not
by itself delete recordings already made - ask for erasure if that is what you
want.

If you are not satisfied. Contact our Data Protection Officer first. You may
also complain to the Data Protection Board of India, independently of us.
"""

HINDI_TEXT = """\
धारा 5, डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम 2023 के अंतर्गत सूचना

कौन पूछ रहा है। भारत रिसर्च लैब्स, डेटा फ़िड्यूशियरी के रूप में।

हम क्या एकत्र करेंगे। आपका नाम, मोबाइल नंबर, तथा संग्रह स्थल पर रिकॉर्ड किया गया
चेहरे का चित्र और चाल का लघु वीडियो।

क्यों। चाल-आधारित पहचान के लिए मशीन लर्निंग मॉडल बनाने और उनका मूल्यांकन करने हेतु।

हम इसे कितने समय तक रखेंगे। संग्रह की तिथि से तीन वर्ष।

आपके अधिकार। आप अपने डेटा का सारांश मांग सकते हैं, सुधार या मिटाने के लिए कह सकते
हैं, किसी को नामित कर सकते हैं, और अपनी सहमति वापस ले सकते हैं।
"""


async def demo_project(
    conn, ids: dict[str, int], processor: dict, source: dict, purposes: list[dict]
) -> dict:
    """One project carried the whole way, so the API has something real to answer with.

    Separate from the reference data above because the two want opposite things
    from a second run. Users, processors, sources and purposes should be brought
    back into line every time. A project should not: re-running the seed is how a
    developer repairs a database, and it should not leave them with a second Gait
    study, a second published notice and a second live consent link.
    """
    # -------------------------------------------------------- project
    project = await fetch_one(
        conn,
        """INSERT INTO project (project_name, internal_project_name, description,
                                requesting_team, created_by, dco_user_id,
                                project_status)
           VALUES ('Gait Identification Study 2026', 'GAIT-2026',
                   'Collection of gait video and facial images for model training.',
                   'Computer Vision', %s, %s, 'in_draft')
           RETURNING project_id, project_uuid""",
        (ids["rnd_user"], ids["dco"]),
    )
    await fetch_one(
        conn,
        """INSERT INTO project_status_history (project_id, to_status, actor_user_id)
           VALUES (%s, 'in_draft', %s) RETURNING history_id""",
        (project["project_id"], ids["rnd_user"]),
    )

    # The rig belongs to somebody, and the site deploys it. Without this the
    # seed asserted a project owner directly while leaving the source unowned -
    # two answers to "who runs Pune", and the derivation says the source wins.
    # The DCO could then open the project and not the site standing in it.
    await conn.execute(
        "UPDATE data_source SET owner_user_id = %s WHERE source_id = %s",
        (ids["dco"], source["source_id"]),
    )

    site = await fetch_one(
        conn,
        """INSERT INTO project_site (project_id, processor_id, source_id, site_label, location)
           VALUES (%s, %s, %s, 'Pune Motion Lab', 'Pune, Maharashtra')
           RETURNING site_id, site_uuid""",
        (project["project_id"], processor["processor_id"], source["source_id"]),
    )

    # --------------------------------------------------------- notice
    notice = await fetch_one(
        conn,
        """INSERT INTO notice (notice_code, project_id, version, withdraw_url,
                               exercise_rights_url, board_complaint_url, dpo_contact)
           VALUES ('NTC-GAIT-2026', %s, 1,
                   'https://cmp.local/withdraw',
                   'https://cmp.local/rights',
                   'https://dpb.gov.in/complaint',
                   'privacy@bharatresearch.example')
           RETURNING notice_id, notice_uuid""",
        (project["project_id"],),
    )
    for order, p in enumerate(purposes):
        await fetch_one(
            conn,
            """INSERT INTO notice_purpose (notice_id, purpose_id, display_order)
               VALUES (%s, %s, %s) RETURNING notice_purpose_id""",
            (notice["notice_id"], p["purpose_id"], order),
        )

    for lang, text in (("english", NOTICE_TEXT), ("hindi", HINDI_TEXT)):
        await fetch_one(
            conn,
            """INSERT INTO notice_language (notice_id, language_code, rendered_text,
                                            content_hash, created_by, approved_by,
                                            approved_at)
               VALUES (%s, %s::language_code, %s, %s, %s, %s, now())
               RETURNING notice_language_id""",
            (notice["notice_id"], lang, text, content_hash(text), ids["dpo"], ids["dpo"]),
        )

    # Publish, then walk the project to approved through its real states.
    recipients = "Pune Motion Lab (operated by Pune Motion Lab Pvt Ltd), Pune, Maharashtra"
    await conn.execute(
        """UPDATE notice SET status = 'published', recipients_text = %s,
                  approved_by = %s, published_at = now() WHERE notice_id = %s""",
        (recipients, ids["dpo"], notice["notice_id"]),
    )
    await conn.execute(
        "UPDATE project SET current_notice_id = %s WHERE project_id = %s",
        (notice["notice_id"], project["project_id"]),
    )

    await conn.execute(
        """INSERT INTO project_approval (project_id, approval_type, reference_no,
                                         approved_on, proof_file_ref,
                                         proof_file_hash, uploaded_by)
           VALUES (%s, 'security', 'SEC-2026-0142', %s,
                   'approvals/seed-proof.pdf', %s, %s)""",
        (
            project["project_id"],
            date(2026, 2, 10),
            content_hash("seed proof document"),
            ids["rnd_user"],
        ),
    )

    # in_draft covers the whole of assembly. The R&D User attaches the
    # notice, the purposes and the approval and then submits, so the two
    # states that used to split that are one and the DPO is not asked to
    # act in the middle of somebody else's work.
    for frm, to, actor in [
        ("in_draft", "pending_approval", ids["rnd_user"]),
        ("pending_approval", "approved", ids["dpo"]),
    ]:
        await conn.execute(
            "UPDATE project SET project_status = %s::project_status WHERE project_id = %s",
            (to, project["project_id"]),
        )
        await conn.execute(
            """INSERT INTO project_status_history
                      (project_id, from_status, to_status, actor_user_id)
               VALUES (%s, %s::project_status, %s::project_status, %s)""",
            (project["project_id"], frm, to, actor),
        )

    # ----------------------------------------------------- consent link
    raw_token = new_token(32)
    await fetch_one(
        conn,
        """INSERT INTO consent_link (notice_id, site_id, token, expires_at,
                                     max_uses, created_by)
           VALUES (%s, %s, %s, %s, 500, %s)
           RETURNING link_id, link_uuid""",
        (
            notice["notice_id"],
            site["site_id"],
            token_fingerprint(raw_token)[:64],
            datetime.now(UTC) + timedelta(days=60),
            ids["dco"],
        ),
    )

    await conn.execute(
        """INSERT INTO audit_log (event_type, actor_user_id, entity_type,
                                  entity_id, detail_json)
           VALUES ('project.created', %s, 'project', %s, '{"seed": true}'::jsonb)""",
        (ids["rnd_user"], project["project_id"]),
    )

    return {
        "project_uuid": project["project_uuid"],
        "notice_uuid": notice["notice_uuid"],
        "site_uuid": site["site_uuid"],
        "raw_token": raw_token,
    }


async def seed() -> None:
    if settings.environment not in ("local", "test"):
        log.error("seed.refused", environment=settings.environment)
        sys.exit(f"Refusing to seed a {settings.environment} database.")

    await open_pool()
    await open_redis()

    with use_context(RequestContext(request_id="seed", ip_address="127.0.0.1")):
        async with transaction() as conn:
            ids: dict[str, int] = {}

            # -------------------------------------------------------- accounts
            for full_name, email, role, person_type, org in USERS:
                row = await fetch_one(
                    conn,
                    """INSERT INTO auth_user (full_name, email, role, person_type, status,
                                              organization_id, username, password_hash)
                       VALUES (%s, %s, %s::user_role, %s::person_type, 'active', %s, %s, %s)
                       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
                       RETURNING id, uuid, role""",
                    (
                        full_name,
                        email,
                        role,
                        person_type,
                        org,
                        email.split("@")[0],
                        hash_password(PASSWORD),
                    ),
                )
                ids[role] = row["id"]
                log.info("seed.user", role=role, email=email)

            # -------------------------------------------------------- registry
            # Every insert below is written to survive a second run. The seed is
            # the fastest way to repair a development database, and one that only
            # works against an empty one is no use at the moment it is wanted.
            processor = await fetch_one(
                conn,
                """WITH existing AS (
                     SELECT processor_id, processor_uuid FROM processor
                      WHERE legal_name = 'Pune Motion Lab Pvt Ltd'
                   ), created AS (
                     INSERT INTO processor (legal_name, type, contract_ref,
                                            security_confirmed_at)
                     SELECT 'Pune Motion Lab Pvt Ltd', 'lab', 'CTR-2026-0091', %s
                      WHERE NOT EXISTS (SELECT 1 FROM existing)
                     RETURNING processor_id, processor_uuid
                   )
                   SELECT * FROM created UNION ALL SELECT * FROM existing""",
                (date(2026, 1, 15),),
            )
            source = await fetch_one(
                conn,
                """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                            id_scheme, processor_id, is_authoritative_for)
                   VALUES ('SRC-PUNE-01', 'Pune Motion Lab capture rig', 'collection',
                           'file_import', 'lab-local', %s, ARRAY['facial_image','gait_video'])
                   ON CONFLICT (source_code) DO UPDATE
                      SET processor_id = EXCLUDED.processor_id
                   RETURNING source_id, source_uuid""",
                (processor["processor_id"],),
            )

            # ------------------------------------------- collection model
            for legal_name, in_house, kind, contract, sources in COLLECTION:
                # Idempotent on legal_name, which carries no unique constraint -
                # two organisations may genuinely share a name, and the seed
                # should not be the thing that decides they cannot.
                proc = await fetch_one(
                    conn,
                    """WITH existing AS (
                         -- Updated, not merely found. Reference data is meant to
                         -- come back into line on every run, and a row that is
                         -- created correctly once but never corrected drifts the
                         -- moment anything changes it - which is exactly what a
                         -- migration down-and-up does to is_in_house.
                         UPDATE processor SET is_in_house = %s
                          WHERE legal_name = %s
                         RETURNING processor_id
                       ), created AS (
                         INSERT INTO processor (legal_name, type, contract_ref,
                                                security_confirmed_at, is_in_house)
                         SELECT %s, %s::processor_type, %s, %s, %s
                          WHERE NOT EXISTS (SELECT 1 FROM existing)
                         RETURNING processor_id
                       )
                       SELECT processor_id FROM created
                       UNION ALL
                       SELECT processor_id FROM existing""",
                    (
                        in_house,
                        legal_name,
                        legal_name,
                        kind,
                        contract,
                        date(2026, 1, 15),
                        in_house,
                    ),
                )
                for code, name in sources:
                    await fetch_one(
                        conn,
                        """INSERT INTO data_source (source_code, name, source_role,
                                                    exchange_mode, processor_id)
                           VALUES (%s, %s, 'collection', 'manual_upload', %s)
                           ON CONFLICT (source_code) DO UPDATE
                              SET processor_id = EXCLUDED.processor_id,
                                  name         = EXCLUDED.name
                           RETURNING source_id""",
                        (code, name, proc["processor_id"]),
                    )
                log.info(
                    "seed.processor",
                    name=legal_name,
                    in_house=in_house,
                    sources=len(sources),
                )

            purposes = []
            for code, name, desc, uses, cats, days, _mandatory in [
                (
                    "PUR-GAIT-TRAIN",
                    "Gait model training",
                    "Building and evaluating gait-based identification models.",
                    "Train, validate and benchmark models. No decisions are made about you.",
                    ["facial_image", "gait_video", "name", "mobile"],
                    1095,
                    False,
                ),
                (
                    "PUR-QUALITY",
                    "Recording quality assurance",
                    "Checking that recordings are usable before they enter the dataset.",
                    "Manual and automated review of recording quality.",
                    ["facial_image", "gait_video"],
                    365,
                    False,
                ),
            ]:
                p = await fetch_one(
                    conn,
                    """INSERT INTO purpose (purpose_code, name, description, uses,
                                            lawful_basis, data_categories, retention_period,
                                            retention_basis, erasure_trigger,
                                            consent_validity_period, lapse_behaviour,
                                            status, created_by)
                       VALUES (%s, %s, %s, %s, 'consent_s6', %s, %s::interval,
                               'business_policy', 'withdrawal', %s::interval,
                               'quarantine', 'active', %s)
                       ON CONFLICT (purpose_code) DO UPDATE
                          SET name = EXCLUDED.name, description = EXCLUDED.description
                       RETURNING purpose_id, purpose_uuid, name""",
                    (
                        code,
                        name,
                        desc,
                        uses,
                        cats,
                        timedelta(days=days),
                        timedelta(days=730),
                        ids["dpo"],
                    ),
                )
                purposes.append(p)
                log.info("seed.purpose", code=code)

            # ------------------------------------------------ data principal
            # The population the product exists to serve, and the seed had none.
            # Every staff role was seeded and she was not, so anything that
            # needed to drive her console - the end-to-end suite, a look at what
            # her notifications actually link to - had to borrow an account left
            # behind by manual testing.
            #
            # She signs in with a one-time code and has no password, which is
            # why she is created here rather than in USERS: `password_hash` is
            # nullable for exactly her.
            subject = await fetch_one(
                conn,
                """INSERT INTO auth_user (full_name, email, mobile, role, person_type,
                                          status, organization_id)
                   VALUES ('Anjali Verma', 'subject@cmp.local', '+919000000001',
                           'data_subject', 'external', 'active', 'ORG-SUB-001')
                   ON CONFLICT (email) DO UPDATE SET status = 'active'
                   RETURNING id, uuid""",
            )
            log.info("seed.subject", email="subject@cmp.local")

            # One event about herself, so her feed is not empty. This is the
            # exact shape that produced the reported bug: an `auth_user` entity,
            # which resolved to the administrator's account register for every
            # reader until the resolver learned who was asking.
            await conn.execute(
                """INSERT INTO audit_log (event_type, actor_user_id, subject_user_id,
                                          entity_type, entity_id, detail_json)
                   SELECT 'subject.registered', %(id)s, %(id)s, 'auth_user', %(id)s,
                          '{"seed": true}'::jsonb
                    WHERE NOT EXISTS (
                      SELECT 1 FROM audit_log
                       WHERE subject_user_id = %(id)s AND event_type = 'subject.registered'
                    )""",
                {"id": subject["id"]},
            )

            # ---------------------------------------------------- demo project
            demo = await fetch_one(
                conn,
                """SELECT p.project_uuid, n.notice_uuid, s.site_uuid
                     FROM project p
                     LEFT JOIN notice n      ON n.project_id = p.project_id
                     LEFT JOIN project_site s ON s.project_id = p.project_id
                    WHERE p.internal_project_name = 'GAIT-2026'
                    ORDER BY n.notice_id, s.site_id
                    LIMIT 1""",
            )
            if demo:
                # The consent token is a keyed digest in the database and cannot
                # be read back, so a run that finds the project already there has
                # no link to print. Saying so beats printing a stale URL.
                demo["raw_token"] = None
                log.info("seed.project.exists", internal_name="GAIT-2026")
            else:
                demo = await demo_project(conn, ids, processor, source, purposes)

    print("\n" + "=" * 72)
    print("  SEED COMPLETE")
    print("=" * 72)
    print(f"  Password for every staff account: {PASSWORD}")
    for full_name, email, role, _, _ in USERS:
        print(f"    {role:12} {email:20} {full_name}")
    print(f"    {'data_subject':12} {'subject@cmp.local':20} Anjali Verma")
    print("      (no password — she signs in with a one-time code from this outbox)")
    print(f"\n  Project     : Gait Identification Study 2026  ({demo['project_uuid']})")
    print(f"  Notice      : NTC-GAIT-2026 v1 (published)      ({demo['notice_uuid']})")
    print(f"  Site        : Pune Motion Lab                   ({demo['site_uuid']})")
    print(f"  Data source : SRC-PUNE-01                       ({source['source_uuid']})")
    for legal_name, in_house, _, _, sources in COLLECTION:
        whose = "collected in-house" if in_house else "collected by a third party"
        named = ", ".join(name for _, name in sources)
        print(f"  Processor   : {legal_name:12} {whose:26} ({named})")

    if demo["raw_token"]:
        print("\n  Public consent link (the token is not recoverable from the database):")
        print(f"    http://localhost:8000/c/{demo['raw_token']}")
    else:
        print("\n  The demo project was already there, so no new consent link was minted.")
        print("  The stored token is a keyed digest, so the existing URL cannot be")
        print("  read back - mint a fresh link from the console if you need one.")
    print("=" * 72 + "\n")

    await close_redis()
    await close_pool()


if __name__ == "__main__":
    import sys as _sys

    if _sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    configure_logging()
    asyncio.run(seed())
