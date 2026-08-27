"""The database's vocabulary, in Python.

Twenty-five PostgreSQL enum types define what values the columns will accept.
This module mirrors them so the application can name a value without spelling it
as a string literal in forty places — and so a typo is an `AttributeError` at
import rather than a constraint violation at 3am.

**The database is the authority.** Every member here corresponds to a label in
the corresponding `CREATE TYPE`, in the same order. If the two disagree, this
file is wrong and the fix is here, not a migration. `tests/unit/core/test_enums.py`
asserts the correspondence against a live server so the drift cannot go unnoticed.

`StrEnum` throughout: the members compare equal to their labels, so a value read
from a row or bound into a query needs no conversion, and `use_enum_values=True`
on the response bases serialises them as the plain string a client expects.
"""

from __future__ import annotations

from enum import StrEnum


# ============================================================== identity ====
class UserRole(StrEnum):
    """Authorisation. Distinct from `PersonType`, which is identity.

    A DPO who becomes an ex-employee keeps her permissions until somebody
    changes her role — the two are deliberately not coupled.
    """

    DPO = "dpo"
    DCO = "dco"
    RND_USER = "rnd_user"
    ADMIN = "admin"
    DATA_SUBJECT = "data_subject"
    #: Routes projects collected by a third party, and holds a DCO's authority
    #: across all of them rather than over an assigned set.
    DCO_ADMIN = "dco_admin"
    #: R&D Collection Owner. A DCO's accountability, for collection the R&D team
    #: does itself - where there is no external processor to route to.
    RCO = "rco"


class PersonType(StrEnum):
    """Who someone is to the organisation. Never consulted for permission."""

    EXTERNAL = "external"
    EMPLOYEE = "employee"
    EX_EMPLOYEE = "ex_employee"
    VENDOR = "vendor"


class UserStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DEACTIVATED = "deactivated"


# =============================================================== projects ====
class ProjectStatus(StrEnum):
    """Four reachable states, walked in one direction.

    `CLOSED` is where the machine stops, not a fifth step — a project is not
    meant to end up there, it is where one goes when it is over.

    `UNDER_PROCESS` is a fifth *label* and not a fifth state. It was merged into
    `IN_DRAFT` and nothing transitions to it; the value survives because
    `project_status_history` rows still name it. See
    `cmp.domain.projects.state_machine`.
    """

    IN_DRAFT = "in_draft"
    UNDER_PROCESS = "under_process"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    CLOSED = "closed"


class ProcessorRequestStatus(StrEnum):
    """Where a project-to-processor link stands.

    Only `APPROVED` counts as one of the project's processors. A `PENDING` one
    is a request and collects nothing; a `REJECTED` one is kept rather than
    deleted, because "we asked and were told no" is a fact somebody will need
    and a deleted row takes the reason with it.
    """

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ApprovalType(StrEnum):
    SECURITY = "security"
    LEGAL = "legal"
    OTHER = "other"


# =============================================================== registry ====
class PurposeStatus(StrEnum):
    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    ACTIVE = "active"
    RETIRED = "retired"


class LawfulBasis(StrEnum):
    """s.6 consent, or s.7 legitimate use.

    The two are not interchangeable: an s.7 purpose must name the clause it
    relies on, and an s.6 purpose must not carry one. The database enforces
    both directions.
    """

    CONSENT_S6 = "consent_s6"
    LEGITIMATE_USE_S7 = "legitimate_use_s7"


class S7Clause(StrEnum):
    VOLUNTARY = "s7_a_voluntary"
    EMPLOYMENT = "s7_i_employment"
    OTHER = "s7_other"


class RetentionBasis(StrEnum):
    STATUTORY = "statutory"
    CONTRACTUAL = "contractual"
    BUSINESS_POLICY = "business_policy"


class ErasureTrigger(StrEnum):
    WITHDRAWAL = "withdrawal"
    PURPOSE_SERVED = "purpose_served"
    PERIOD_ELAPSED = "period_elapsed"
    INACTIVITY = "inactivity"


class LapseBehaviour(StrEnum):
    """What happens when consent validity runs out.

    `QUARANTINE` rather than `ERASE` is the safer default: data that is
    unreachable can still be restored if the lapse was a mistake, and data that
    is gone cannot.
    """

    QUARANTINE = "quarantine"
    ERASE = "erase"
    NONE = "none"


class ProcessorType(StrEnum):
    LAB = "lab"
    TOOL = "tool"
    OTHER = "other"


class SourceRole(StrEnum):
    IDENTITY = "identity"
    COLLECTION = "collection"
    BOTH = "both"


class ExchangeMode(StrEnum):
    FILE_EXPORT = "file_export"
    FILE_IMPORT = "file_import"
    MANUAL_UPLOAD = "manual_upload"
    API = "api"


class RecordStatus(StrEnum):
    """For registry rows — processors, sources, sites.

    `TERMINATED` is not a delete. A processor that handled personal data last
    year is still part of the answer to "who has our data", and removing the row
    would remove the evidence along with it.
    """

    ACTIVE = "active"
    SUSPENDED = "suspended"
    TERMINATED = "terminated"


# ================================================================ notices ====
class NoticeAudience(StrEnum):
    """Who a notice addresses.

    Deliberately separate from `PersonType`: that records what somebody *is*,
    this records who a document *speaks to*, and the two answer different
    questions even where the words overlap. A notice carries exactly one — a
    document written for employees and for the public at once is two documents
    with different obligations wearing one name.
    """

    DATA_SUBJECT = "data_subject"
    EMPLOYEE = "employee"
    EX_EMPLOYEE = "ex_employee"
    OTHERS = "others"


class NoticeStatus(StrEnum):
    """`SUPERSEDED` is not a failure — it means a newer version exists."""

    DRAFT = "draft"
    APPROVED = "approved"
    PUBLISHED = "published"
    SUPERSEDED = "superseded"


class ChangeClass(StrEnum):
    """Whether a notice change needs fresh consent.

    A material change alters what somebody agreed to, so their consent no longer
    covers it. A superficial one — a typo, a reformatted address — does not.
    The DPO classifies; the system records the classification.
    """

    MATERIAL = "material"
    SUPERFICIAL = "superficial"


class LanguageCode(StrEnum):
    """Rule 5: the notice must be available in English and the Eighth Schedule
    languages. These are the eight the platform renders today."""

    ENGLISH = "english"
    HINDI = "hindi"
    MARATHI = "marathi"
    TAMIL = "tamil"
    TELUGU = "telugu"
    KANNADA = "kannada"
    BENGALI = "bengali"
    GUJARATI = "gujarati"


# ================================================================ consent ====
class LinkStatus(StrEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"


class ActionType(StrEnum):
    """How the affirmative action was taken.

    Recorded because s.6(1) requires consent to be a clear affirmative action,
    and "which button did she press" is part of showing that it was.
    """

    CHECKBOX_CLICK = "checkbox_click"
    BUTTON_PRESS = "button_press"
    SIGNATURE = "signature"


class ConsentStatus(StrEnum):
    """Derived on every read from the grants, never stored.

    A stored status is a second copy of the truth, and the copy goes stale the
    first time a grant changes without it.
    """

    CONSENTED = "consented"
    PARTIAL = "partial"
    DECLINED = "declined"
    WITHDRAWN = "withdrawn"


# =============================================================== exchange ====
class ExportType(StrEnum):
    #: Retained because `export_log` rows name them, and an export is a
    #: disclosure record: renaming what it says was disclosed would falsify the
    #: one table that exists to be trusted. Neither is reachable.
    COLLECTION_PACK = "collection_pack"
    CONSENTED_LIST = "consented_list"
    #: The only reachable value. Last because `ALTER TYPE ... ADD VALUE` appends,
    #: and the parity test holds this file to the database's own order.
    PROJECT_EXPORT = "project_export"


class BatchStatus(StrEnum):
    """`PARTIAL` is the one that needs a person.

    Accepted and rejected are both unambiguous. Partial means some rows landed
    and some did not, which is the only outcome that leaves the dataset in a
    state nobody chose.
    """

    RECEIVED = "received"
    VALIDATING = "validating"
    ACCEPTED = "accepted"
    PARTIAL = "partial"
    REJECTED = "rejected"


class AssetType(StrEnum):
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    SENSOR = "sensor"
    DOCUMENT = "document"
    OTHER = "other"


class SubjectRole(StrEnum):
    """How a person appears in a collected asset.

    `INCIDENTAL` is the bystander case — somebody in frame who never consented.
    The row exists precisely so they can be found and dealt with; pretending
    they are not in the picture is how an unlawful state stays invisible.
    """

    CONSENTED = "consented"
    INCIDENTAL = "incidental"
    UNIDENTIFIED = "unidentified"


class Disposition(StrEnum):
    ACTIVE = "active"
    REDACTED = "redacted"
    ERASED = "erased"
    QUARANTINED = "quarantined"


#: Every enum in this module, keyed by its PostgreSQL type name. Used by the
#: reference endpoint that feeds the frontend's dropdowns, and by the test that
#: asserts this file has not drifted from the schema.
BY_PG_TYPE: dict[str, type[StrEnum]] = {
    "action_type": ActionType,
    "approval_type": ApprovalType,
    "asset_type": AssetType,
    "batch_status": BatchStatus,
    "change_class": ChangeClass,
    "disposition": Disposition,
    "erasure_trigger": ErasureTrigger,
    "exchange_mode": ExchangeMode,
    "export_type": ExportType,
    "language_code": LanguageCode,
    "lapse_behaviour": LapseBehaviour,
    "lawful_basis": LawfulBasis,
    "link_status": LinkStatus,
    "processor_request_status": ProcessorRequestStatus,
    "notice_audience": NoticeAudience,
    "notice_status": NoticeStatus,
    "person_type": PersonType,
    "processor_type": ProcessorType,
    "project_status": ProjectStatus,
    "purpose_status": PurposeStatus,
    "record_status": RecordStatus,
    "retention_basis": RetentionBasis,
    "s7_clause": S7Clause,
    "source_role": SourceRole,
    "subject_role": SubjectRole,
    "user_role": UserRole,
    "user_status": UserStatus,
}
