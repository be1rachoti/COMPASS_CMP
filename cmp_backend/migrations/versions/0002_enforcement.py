"""Enforcement in the database - the last line, not the only line.

The application already refuses these operations. This migration makes the
database refuse them too, because "the application always calls the service
layer" is a claim about a codebase, and a codebase changes. A trigger is a claim
about the data.

What is enforced here:

* `audit_log` is append-only, and every row carries a hash of its predecessor.
  A DPO who can edit her own audit trail makes it worthless as evidence, so no
  role - not the application role, not the DPO - can UPDATE or DELETE a row.
  GET /audit/verify walks the chain; a deleted or edited row breaks it at that
  point and every row after it.
* Consent evidence is append-only. Withdrawal is a new artefact that supersedes
  the old one, never an edit of the old one. The supersession chain is the
  record; rewriting history in place destroys it.
* A published notice is frozen. Its text and its hash are what the data subject
  saw, and INV-4 depends on them staying that way. Edits create a new version.
* Disclosure records are append-only. An export_line that can be deleted cannot
  answer s.11(1)(b).
* `updated_at` maintains itself. An application that forgets to set it produces
  a column nobody can trust, which is worse than not having one.

Revision ID: 0002
"""

from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


TOUCH_UPDATED_AT = """
CREATE OR REPLACE FUNCTION cmp_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
"""

TOUCH_TRIGGERS = """
CREATE TRIGGER trg_auth_user_touch       BEFORE UPDATE ON auth_user
  FOR EACH ROW EXECUTE FUNCTION cmp_touch_updated_at();
CREATE TRIGGER trg_purpose_touch         BEFORE UPDATE ON purpose
  FOR EACH ROW EXECUTE FUNCTION cmp_touch_updated_at();
CREATE TRIGGER trg_project_touch         BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION cmp_touch_updated_at();
CREATE TRIGGER trg_notice_touch          BEFORE UPDATE ON notice
  FOR EACH ROW EXECUTE FUNCTION cmp_touch_updated_at();
CREATE TRIGGER trg_notice_language_touch BEFORE UPDATE ON notice_language
  FOR EACH ROW EXECUTE FUNCTION cmp_touch_updated_at();
"""

# --------------------------------------------------------------- append-only
APPEND_ONLY_FN = """
CREATE OR REPLACE FUNCTION cmp_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    USING MESSAGE = format('%s is append-only: % is refused', TG_TABLE_NAME, TG_OP),
          ERRCODE = '42501';
END;
$$;
"""

APPEND_ONLY_TRIGGERS = """
-- Evidence. Nothing edits these, including a superuser going through the app.
CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION cmp_append_only();

CREATE TRIGGER trg_consent_append_only
  BEFORE UPDATE OR DELETE ON consent_artefact
  FOR EACH STATEMENT EXECUTE FUNCTION cmp_append_only();

CREATE TRIGGER trg_grant_append_only
  BEFORE UPDATE OR DELETE ON consent_purpose_grant
  FOR EACH STATEMENT EXECUTE FUNCTION cmp_append_only();

-- Disclosure record: what was shared, with whom, when.
CREATE TRIGGER trg_export_log_append_only
  BEFORE UPDATE OR DELETE ON export_log
  FOR EACH STATEMENT EXECUTE FUNCTION cmp_append_only();

CREATE TRIGGER trg_export_line_append_only
  BEFORE UPDATE OR DELETE ON export_line
  FOR EACH STATEMENT EXECUTE FUNCTION cmp_append_only();

-- History tables are the answer to "how did it get into this state".
CREATE TRIGGER trg_project_history_append_only
  BEFORE UPDATE OR DELETE ON project_status_history
  FOR EACH STATEMENT EXECUTE FUNCTION cmp_append_only();

CREATE TRIGGER trg_person_type_history_append_only
  BEFORE UPDATE OR DELETE ON person_type_history
  FOR EACH STATEMENT EXECUTE FUNCTION cmp_append_only();

-- Approval proof is the precondition for pending_approval. It does not change.
CREATE TRIGGER trg_approval_append_only
  BEFORE UPDATE OR DELETE ON project_approval
  FOR EACH STATEMENT EXECUTE FUNCTION cmp_append_only();
"""

# ------------------------------------------------------------ audit chaining
AUDIT_CHAIN_FN = """
CREATE OR REPLACE FUNCTION cmp_audit_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prev_hash text;
  payload   text;
BEGIN
  -- Serialise chain construction. Two concurrent inserts that both read the same
  -- predecessor would produce two rows claiming the same position, and the chain
  -- would verify against neither.
  PERFORM pg_advisory_xact_lock(hashtext('cmp_audit_chain'));

  SELECT detail_json ->> '_hash' INTO prev_hash
  FROM audit_log ORDER BY log_id DESC LIMIT 1;

  payload := concat_ws('|',
    NEW.event_type,
    coalesce(NEW.actor_user_id::text, ''),
    coalesce(NEW.subject_user_id::text, ''),
    NEW.entity_type,
    NEW.entity_id::text,
    to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF'),
    coalesce(NEW.detail_json - '_hash' - '_prev', '{}'::jsonb)::text
  );

  NEW.detail_json := coalesce(NEW.detail_json, '{}'::jsonb)
    || jsonb_build_object(
         '_prev', prev_hash,
         '_hash', encode(digest(concat_ws('|', coalesce(prev_hash, ''), payload), 'sha256'), 'hex')
       );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION cmp_audit_chain();
"""

AUDIT_VERIFY_FN = """
-- Recomputes the chain and returns the first row that does not verify.
-- Backs GET /audit/verify. Returns zero rows when the trail is intact.
CREATE OR REPLACE FUNCTION cmp_audit_verify(from_log_id bigint DEFAULT 0)
RETURNS TABLE (log_id bigint, log_uuid uuid, occurred_at timestamptz, reason text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r          record;
  prev_hash  text;
  payload    text;
  expected   text;
  seeded     boolean := false;
BEGIN
  FOR r IN
    SELECT * FROM audit_log a WHERE a.log_id >= from_log_id ORDER BY a.log_id
  LOOP
    IF NOT seeded THEN
      prev_hash := r.detail_json ->> '_prev';
      seeded := true;
    END IF;

    IF (r.detail_json ->> '_prev') IS DISTINCT FROM prev_hash THEN
      log_id := r.log_id; log_uuid := r.log_uuid; occurred_at := r.occurred_at;
      reason := 'predecessor hash does not match the previous row';
      RETURN NEXT;
      RETURN;
    END IF;

    payload := concat_ws('|',
      r.event_type,
      coalesce(r.actor_user_id::text, ''),
      coalesce(r.subject_user_id::text, ''),
      r.entity_type,
      r.entity_id::text,
      to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF'),
      coalesce(r.detail_json - '_hash' - '_prev', '{}'::jsonb)::text
    );
    expected := encode(
      digest(concat_ws('|', coalesce(prev_hash, ''), payload), 'sha256'), 'hex');

    IF (r.detail_json ->> '_hash') IS DISTINCT FROM expected THEN
      log_id := r.log_id; log_uuid := r.log_uuid; occurred_at := r.occurred_at;
      reason := 'row content does not match its recorded hash';
      RETURN NEXT;
      RETURN;
    END IF;

    prev_hash := expected;
  END LOOP;
END;
$$;
"""

# --------------------------------------------------- published notice freeze
NOTICE_FREEZE = """
CREATE OR REPLACE FUNCTION cmp_notice_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' THEN
    -- superseded is the one permitted transition out of published: a new version
    -- replaces this one, and this row records that it was replaced.
    IF NEW.status = 'superseded'
       AND NEW.notice_code       = OLD.notice_code
       AND NEW.version           = OLD.version
       AND NEW.withdraw_url      = OLD.withdraw_url
       AND NEW.exercise_rights_url = OLD.exercise_rights_url
       AND NEW.board_complaint_url = OLD.board_complaint_url
       AND NEW.dpo_contact       = OLD.dpo_contact
       AND NEW.recipients_text   IS NOT DISTINCT FROM OLD.recipients_text
       AND NEW.published_at      IS NOT DISTINCT FROM OLD.published_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      USING MESSAGE = 'A published notice is immutable; publish a new version instead',
            ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notice_freeze
  BEFORE UPDATE ON notice
  FOR EACH ROW EXECUTE FUNCTION cmp_notice_freeze();

CREATE OR REPLACE FUNCTION cmp_notice_language_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status notice_status;
BEGIN
  SELECT status INTO parent_status FROM notice WHERE notice_id = OLD.notice_id;
  IF parent_status IN ('published', 'superseded')
     AND (NEW.rendered_text <> OLD.rendered_text
          OR NEW.content_hash <> OLD.content_hash) THEN
    RAISE EXCEPTION
      USING MESSAGE = 'The text a data subject was shown cannot be edited (INV-4)',
            ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notice_language_freeze
  BEFORE UPDATE ON notice_language
  FOR EACH ROW EXECUTE FUNCTION cmp_notice_language_freeze();

CREATE OR REPLACE FUNCTION cmp_notice_purpose_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_notice int;
  parent_status notice_status;
BEGIN
  target_notice := CASE TG_OP WHEN 'DELETE' THEN OLD.notice_id ELSE NEW.notice_id END;
  SELECT status INTO parent_status FROM notice WHERE notice_id = target_notice;
  IF parent_status IN ('published', 'superseded') THEN
    RAISE EXCEPTION
      USING MESSAGE = 'Purposes cannot change on a published notice; publish a new version',
            ERRCODE = '42501';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_notice_purpose_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON notice_purpose
  FOR EACH ROW EXECUTE FUNCTION cmp_notice_purpose_freeze();
"""

# ------------------------------------------------------- consent guard rails
CONSENT_GUARDS = """
-- A consent artefact must point at a language rendition of the notice it claims,
-- and must carry that rendition's hash as it stood at capture (INV-4).
-- The FK cannot express "same notice"; this can.
CREATE OR REPLACE FUNCTION cmp_consent_coherent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lang_notice int;
  lang_hash   text;
  lnk_notice  int;
  n_status    notice_status;
BEGIN
  SELECT nl.notice_id, nl.content_hash INTO lang_notice, lang_hash
  FROM notice_language nl WHERE nl.notice_language_id = NEW.notice_language_id;

  IF lang_notice IS DISTINCT FROM NEW.notice_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'notice_language belongs to a different notice', ERRCODE = '23514';
  END IF;

  IF NEW.notice_content_hash IS DISTINCT FROM lang_hash THEN
    RAISE EXCEPTION USING
      MESSAGE = 'notice_content_hash must be the hash of the text served (INV-4)',
      ERRCODE = '23514';
  END IF;

  SELECT cl.notice_id INTO lnk_notice FROM consent_link cl WHERE cl.link_id = NEW.link_id;
  IF lnk_notice IS DISTINCT FROM NEW.notice_id THEN
    RAISE EXCEPTION USING
      MESSAGE = 'consent link belongs to a different notice', ERRCODE = '23514';
  END IF;

  SELECT status INTO n_status FROM notice WHERE notice_id = NEW.notice_id;
  IF n_status NOT IN ('published', 'superseded') THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Consent cannot be recorded against an unpublished notice (s.5(1))',
      ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_consent_coherent
  BEFORE INSERT ON consent_artefact
  FOR EACH ROW EXECUTE FUNCTION cmp_consent_coherent();

-- One artefact may be superseded once. Two rows claiming the same predecessor
-- fork the chain, and v_current_consent would return neither.
CREATE UNIQUE INDEX uq_artefact_supersedes_once
  ON consent_artefact (supersedes_consent_id)
  WHERE supersedes_consent_id IS NOT NULL;

-- A grant may only name a purpose that is attached to the notice consented to.
CREATE OR REPLACE FUNCTION cmp_grant_in_notice() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM consent_artefact ca
    JOIN notice_purpose np ON np.notice_id = ca.notice_id
    WHERE ca.consent_id = NEW.consent_id AND np.purpose_id = NEW.purpose_id
  ) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Purpose is not part of the notice this consent was given against',
      ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_grant_in_notice
  BEFORE INSERT ON consent_purpose_grant
  FOR EACH ROW EXECUTE FUNCTION cmp_grant_in_notice();
"""

# ------------------------------------------------------------- link integrity
LINK_GUARDS = """
-- A link must belong to a site of the project the notice belongs to. Without
-- this a link can be minted that hands one project's notice to another project's
-- population, and the consent it produces is unattributable.
CREATE OR REPLACE FUNCTION cmp_link_coherent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  notice_project int;
  site_project   int;
  proj_status    project_status;
BEGIN
  SELECT project_id INTO notice_project FROM notice      WHERE notice_id = NEW.notice_id;
  SELECT project_id INTO site_project   FROM project_site WHERE site_id  = NEW.site_id;

  IF notice_project IS DISTINCT FROM site_project THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Consent link site and notice belong to different projects',
      ERRCODE = '23514';
  END IF;

  SELECT project_status INTO proj_status FROM project WHERE project_id = notice_project;
  IF proj_status <> 'approved' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'A consent link may only exist for a project in approved',
      ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_link_coherent
  BEFORE INSERT ON consent_link
  FOR EACH ROW EXECUTE FUNCTION cmp_link_coherent();

CREATE OR REPLACE FUNCTION cmp_link_use_count_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.max_uses IS NOT NULL AND NEW.use_count > NEW.max_uses THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Consent link use cap exceeded', ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_link_use_count_guard
  BEFORE UPDATE ON consent_link
  FOR EACH ROW EXECUTE FUNCTION cmp_link_use_count_guard();
"""

DROP_SQL = """
DROP TRIGGER IF EXISTS trg_link_use_count_guard ON consent_link;
DROP TRIGGER IF EXISTS trg_link_coherent ON consent_link;
DROP TRIGGER IF EXISTS trg_grant_in_notice ON consent_purpose_grant;
DROP INDEX IF EXISTS uq_artefact_supersedes_once;
DROP TRIGGER IF EXISTS trg_consent_coherent ON consent_artefact;
DROP TRIGGER IF EXISTS trg_notice_purpose_freeze ON notice_purpose;
DROP TRIGGER IF EXISTS trg_notice_language_freeze ON notice_language;
DROP TRIGGER IF EXISTS trg_notice_freeze ON notice;
DROP TRIGGER IF EXISTS trg_audit_chain ON audit_log;
DROP TRIGGER IF EXISTS trg_approval_append_only ON project_approval;
DROP TRIGGER IF EXISTS trg_person_type_history_append_only ON person_type_history;
DROP TRIGGER IF EXISTS trg_project_history_append_only ON project_status_history;
DROP TRIGGER IF EXISTS trg_export_line_append_only ON export_line;
DROP TRIGGER IF EXISTS trg_export_log_append_only ON export_log;
DROP TRIGGER IF EXISTS trg_grant_append_only ON consent_purpose_grant;
DROP TRIGGER IF EXISTS trg_consent_append_only ON consent_artefact;
DROP TRIGGER IF EXISTS trg_audit_append_only ON audit_log;
DROP TRIGGER IF EXISTS trg_notice_language_touch ON notice_language;
DROP TRIGGER IF EXISTS trg_notice_touch ON notice;
DROP TRIGGER IF EXISTS trg_project_touch ON project;
DROP TRIGGER IF EXISTS trg_purpose_touch ON purpose;
DROP TRIGGER IF EXISTS trg_auth_user_touch ON auth_user;
DROP FUNCTION IF EXISTS cmp_link_use_count_guard();
DROP FUNCTION IF EXISTS cmp_link_coherent();
DROP FUNCTION IF EXISTS cmp_grant_in_notice();
DROP FUNCTION IF EXISTS cmp_consent_coherent();
DROP FUNCTION IF EXISTS cmp_notice_purpose_freeze();
DROP FUNCTION IF EXISTS cmp_notice_language_freeze();
DROP FUNCTION IF EXISTS cmp_notice_freeze();
DROP FUNCTION IF EXISTS cmp_audit_verify(bigint);
DROP FUNCTION IF EXISTS cmp_audit_chain();
DROP FUNCTION IF EXISTS cmp_append_only();
DROP FUNCTION IF EXISTS cmp_touch_updated_at();
"""


def upgrade() -> None:
    op.execute(TOUCH_UPDATED_AT)
    op.execute(TOUCH_TRIGGERS)
    op.execute(APPEND_ONLY_FN)
    op.execute(APPEND_ONLY_TRIGGERS)
    op.execute(AUDIT_CHAIN_FN)
    op.execute(AUDIT_VERIFY_FN)
    op.execute(NOTICE_FREEZE)
    op.execute(CONSENT_GUARDS)
    op.execute(LINK_GUARDS)


def downgrade() -> None:
    op.execute(DROP_SQL)
