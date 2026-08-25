"""Baseline schema - 22 tables, PostgreSQL 16+.

Transcribed from DATA-MODEL.md, which is authoritative. Where this file and that
document disagree, that document wins and this file is the bug.

Creation order is forced by foreign keys, not preference (see CMP_module_order):
accounts -> audit -> registry -> projects -> notices -> consent -> exchange, then
the three circular keys are added last.

Revision ID: 0001
"""

from __future__ import annotations

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


ENUMS = """
CREATE TYPE user_role       AS ENUM ('dpo','dco','rnd_user','admin','data_subject');
CREATE TYPE person_type     AS ENUM ('external','employee','ex_employee','vendor');
CREATE TYPE user_status     AS ENUM ('pending','active','suspended','deactivated');
CREATE TYPE project_status  AS ENUM ('in_draft','under_process','pending_approval','approved','closed');
CREATE TYPE purpose_status  AS ENUM ('draft','pending_approval','active','retired');
CREATE TYPE notice_status   AS ENUM ('draft','approved','published','superseded');
CREATE TYPE lawful_basis    AS ENUM ('consent_s6','legitimate_use_s7');
CREATE TYPE s7_clause       AS ENUM ('s7_a_voluntary','s7_i_employment','s7_other');
CREATE TYPE retention_basis AS ENUM ('statutory','contractual','business_policy');
CREATE TYPE erasure_trigger AS ENUM ('withdrawal','purpose_served','period_elapsed','inactivity');
CREATE TYPE lapse_behaviour AS ENUM ('quarantine','erase','none');
CREATE TYPE change_class    AS ENUM ('material','superficial');
CREATE TYPE language_code   AS ENUM ('english','hindi','marathi','tamil','telugu','kannada','bengali','gujarati');
CREATE TYPE processor_type  AS ENUM ('lab','tool','other');
CREATE TYPE record_status   AS ENUM ('active','suspended','terminated');
CREATE TYPE approval_type   AS ENUM ('security','legal','other');
CREATE TYPE link_status     AS ENUM ('active','expired','revoked');
CREATE TYPE action_type     AS ENUM ('checkbox_click','button_press','signature');
CREATE TYPE export_type     AS ENUM ('collection_pack','consented_list');
CREATE TYPE source_role     AS ENUM ('identity','collection','both');
CREATE TYPE exchange_mode   AS ENUM ('file_export','file_import','manual_upload','api');
CREATE TYPE batch_status    AS ENUM ('received','validating','accepted','partial','rejected');
CREATE TYPE asset_type      AS ENUM ('image','video','audio','sensor','document','other');
CREATE TYPE subject_role    AS ENUM ('consented','incidental','unidentified');
CREATE TYPE disposition     AS ENUM ('active','redacted','erased','quarantined');
"""

# ---------------------------------------------------------------- 1. accounts
ACCOUNTS = """
CREATE TABLE auth_user (
  id                      serial PRIMARY KEY,
  uuid                    uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  username                varchar(120) UNIQUE,
  full_name               varchar(200) NOT NULL,
  email                   varchar(255) NOT NULL UNIQUE,
  mobile                  varchar(20)  UNIQUE,
  organization_id         varchar(60)  UNIQUE,
  role                    user_role   NOT NULL DEFAULT 'data_subject',
  person_type             person_type,
  status                  user_status NOT NULL DEFAULT 'pending',
  registered_via_link_id  int,
  password_hash           varchar(255),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE person_type_history (
  history_id    serial PRIMARY KEY,
  history_uuid  uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  auth_user_id  int NOT NULL REFERENCES auth_user(id),
  from_type     person_type,
  to_type       person_type NOT NULL,
  reason        text,
  changed_by    int NOT NULL REFERENCES auth_user(id),
  changed_at    timestamptz NOT NULL DEFAULT now()
);
"""

# ------------------------------------------------------------------- 2. audit
AUDIT = """
CREATE TABLE audit_log (
  log_id          bigserial PRIMARY KEY,
  log_uuid        uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type      varchar(80) NOT NULL,
  actor_user_id   int REFERENCES auth_user(id),
  subject_user_id int REFERENCES auth_user(id),
  entity_type     varchar(60) NOT NULL,
  entity_id       int NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  detail_json     jsonb
);
"""

# ---------------------------------------------------------------- 3. registry
REGISTRY = """
CREATE TABLE processor (
  processor_id          serial PRIMARY KEY,
  processor_uuid        uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  legal_name            varchar(255) NOT NULL,
  type                  processor_type NOT NULL,
  contract_ref          varchar(120) NOT NULL,
  security_confirmed_at date NOT NULL,
  status                record_status NOT NULL DEFAULT 'active',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE data_source (
  source_id            serial PRIMARY KEY,
  source_uuid          uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source_code          varchar(60) NOT NULL UNIQUE,
  name                 varchar(200) NOT NULL,
  source_role          source_role NOT NULL,
  exchange_mode        exchange_mode NOT NULL,
  id_scheme            varchar(120),
  processor_id         int REFERENCES processor(processor_id),
  site_id              int,
  is_authoritative_for text[] NOT NULL DEFAULT '{}',
  status               record_status NOT NULL DEFAULT 'active',
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purpose (
  purpose_id              serial PRIMARY KEY,
  purpose_uuid            uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  purpose_code            varchar(80) NOT NULL UNIQUE,
  version                 int NOT NULL DEFAULT 1,
  status                  purpose_status NOT NULL DEFAULT 'draft',
  name                    varchar(200) NOT NULL,
  description             text NOT NULL,
  uses                    text NOT NULL,
  lawful_basis            lawful_basis NOT NULL,
  s7_clause               s7_clause,
  data_categories         text[] NOT NULL,
  retention_period        interval NOT NULL,
  retention_basis         retention_basis NOT NULL,
  erasure_trigger         erasure_trigger NOT NULL,
  consent_validity_period interval,
  cross_border_permitted  boolean NOT NULL DEFAULT false,
  permitted_for_minors    boolean NOT NULL DEFAULT false,
  lapse_behaviour         lapse_behaviour NOT NULL DEFAULT 'quarantine',
  created_by              int NOT NULL REFERENCES auth_user(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT s7_clause_required CHECK (
    (lawful_basis = 'legitimate_use_s7' AND s7_clause IS NOT NULL) OR
    (lawful_basis = 'consent_s6'        AND s7_clause IS NULL)),
  CONSTRAINT categories_not_empty CHECK (array_length(data_categories, 1) >= 1)
);
"""

# ---------------------------------------------------------------- 4. projects
PROJECTS = """
CREATE TABLE project (
  project_id            serial PRIMARY KEY,
  project_uuid          uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  project_name          varchar(200) NOT NULL,
  internal_project_name varchar(200),
  description           text,
  requesting_team       varchar(120),
  project_status        project_status NOT NULL DEFAULT 'in_draft',
  current_notice_id     int,
  created_by            int NOT NULL REFERENCES auth_user(id),
  dco_user_id           int REFERENCES auth_user(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_status_history (
  history_id     serial PRIMARY KEY,
  history_uuid   uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  project_id     int NOT NULL REFERENCES project(project_id),
  from_status    project_status,
  to_status      project_status NOT NULL,
  reason         text,
  actor_user_id  int NOT NULL REFERENCES auth_user(id),
  occurred_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_approval (
  approval_id     serial PRIMARY KEY,
  approval_uuid   uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  project_id      int NOT NULL REFERENCES project(project_id),
  approval_type   approval_type NOT NULL,
  reference_no    varchar(120) NOT NULL,
  approved_on     date NOT NULL,
  proof_file_ref  text NOT NULL,
  proof_file_hash text NOT NULL,
  uploaded_by     int NOT NULL REFERENCES auth_user(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_site (
  site_id      serial PRIMARY KEY,
  site_uuid    uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  project_id   int NOT NULL REFERENCES project(project_id),
  processor_id int REFERENCES processor(processor_id),
  site_label   varchar(160) NOT NULL,
  location     varchar(200),
  status       record_status NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now()
);
"""

# ----------------------------------------------------------------- 5. notices
NOTICES = """
CREATE TABLE notice (
  notice_id           serial PRIMARY KEY,
  notice_uuid         uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  notice_code         varchar(80) NOT NULL,
  project_id          int NOT NULL REFERENCES project(project_id),
  version             int NOT NULL DEFAULT 1,
  withdraw_url        text NOT NULL,
  exercise_rights_url text NOT NULL,
  board_complaint_url text NOT NULL,
  dpo_contact         varchar(255) NOT NULL,
  recipients_text     text,
  status              notice_status NOT NULL DEFAULT 'draft',
  change_class        change_class,
  approved_by         int REFERENCES auth_user(id),
  published_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_code, version),
  CONSTRAINT publishable CHECK (
    status <> 'published' OR (recipients_text IS NOT NULL AND published_at IS NOT NULL))
);

CREATE TABLE notice_purpose (
  notice_purpose_id serial PRIMARY KEY,
  notice_id         int NOT NULL REFERENCES notice(notice_id),
  purpose_id        int NOT NULL REFERENCES purpose(purpose_id),
  display_order     int NOT NULL DEFAULT 0,
  is_mandatory      boolean NOT NULL DEFAULT false,
  UNIQUE (notice_id, purpose_id)
);

CREATE TABLE notice_language (
  notice_language_id   serial PRIMARY KEY,
  notice_language_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  notice_id            int NOT NULL REFERENCES notice(notice_id),
  language_code        language_code NOT NULL,
  rendered_text        text NOT NULL,
  content_hash         text NOT NULL,
  created_by           int NOT NULL REFERENCES auth_user(id),
  approved_by          int REFERENCES auth_user(id),
  approved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_id, language_code)
);
"""

# ----------------------------------------------------------------- 6. consent
CONSENT = """
CREATE TABLE consent_link (
  link_id     serial PRIMARY KEY,
  link_uuid   uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  notice_id   int NOT NULL REFERENCES notice(notice_id),
  site_id     int NOT NULL REFERENCES project_site(site_id),
  token       varchar(64) NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  max_uses    int,
  use_count   int NOT NULL DEFAULT 0,
  status      link_status NOT NULL DEFAULT 'active',
  created_by  int NOT NULL REFERENCES auth_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by  int REFERENCES auth_user(id),
  revoked_at  timestamptz
);

CREATE TABLE consent_artefact (
  consent_id            serial PRIMARY KEY,
  consent_uuid          uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  auth_user_id          int NOT NULL REFERENCES auth_user(id),
  notice_id             int NOT NULL REFERENCES notice(notice_id),
  notice_language_id    int NOT NULL REFERENCES notice_language(notice_language_id),
  notice_content_hash   text NOT NULL,
  link_id               int NOT NULL REFERENCES consent_link(link_id),
  served_at             timestamptz NOT NULL,
  affirmative_action_at timestamptz NOT NULL,
  action_type           action_type NOT NULL,
  ip_address            inet,
  is_withdrawal         boolean NOT NULL DEFAULT false,
  supersedes_consent_id int REFERENCES consent_artefact(consent_id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT served_before_action CHECK (served_at <= affirmative_action_at)
);

CREATE TABLE consent_purpose_grant (
  grant_id   serial PRIMARY KEY,
  consent_id int NOT NULL REFERENCES consent_artefact(consent_id),
  purpose_id int NOT NULL REFERENCES purpose(purpose_id),
  granted    boolean NOT NULL,
  UNIQUE (consent_id, purpose_id)
);
"""

# ---------------------------------------------------------------- 7. exchange
EXCHANGE = """
CREATE TABLE export_log (
  export_id   serial PRIMARY KEY,
  export_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  project_id  int NOT NULL REFERENCES project(project_id),
  site_id     int NOT NULL REFERENCES project_site(site_id),
  export_type export_type NOT NULL,
  exported_by int NOT NULL REFERENCES auth_user(id),
  exported_at timestamptz NOT NULL DEFAULT now(),
  row_count   int NOT NULL,
  file_hash   text NOT NULL
);

CREATE TABLE export_line (
  line_id      serial PRIMARY KEY,
  export_id    int NOT NULL REFERENCES export_log(export_id),
  auth_user_id int NOT NULL REFERENCES auth_user(id),
  consent_id   int NOT NULL REFERENCES consent_artefact(consent_id)
);

CREATE TABLE import_batch (
  batch_id      serial PRIMARY KEY,
  batch_uuid    uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source_id     int NOT NULL REFERENCES data_source(source_id),
  project_id    int REFERENCES project(project_id),
  file_name     varchar(255) NOT NULL,
  file_hash     text NOT NULL,
  declared_rows int NOT NULL,
  accepted_rows int NOT NULL DEFAULT 0,
  rejected_rows int NOT NULL DEFAULT 0,
  status        batch_status NOT NULL DEFAULT 'received',
  error_report  text,
  imported_by   int NOT NULL REFERENCES auth_user(id),
  received_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collection (
  collection_id         serial PRIMARY KEY,
  collection_uuid       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source_id             int NOT NULL REFERENCES data_source(source_id),
  source_collection_ref varchar(120) NOT NULL,
  project_id            int NOT NULL REFERENCES project(project_id),
  site_id               int REFERENCES project_site(site_id),
  batch_id              int NOT NULL REFERENCES import_batch(batch_id),
  agent_ref             varchar(120),
  collected_on          date NOT NULL,
  declared_asset_count  int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_collection_ref)
);

CREATE TABLE data_asset (
  asset_id              serial PRIMARY KEY,
  asset_uuid            uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source_id             int NOT NULL REFERENCES data_source(source_id),
  source_asset_ref      varchar(160) NOT NULL,
  collection_id         int NOT NULL REFERENCES collection(collection_id),
  asset_type            asset_type NOT NULL,
  storage_ref           text,
  has_unmapped_subjects boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_asset_ref)
);

CREATE TABLE asset_consent (
  asset_consent_id serial PRIMARY KEY,
  asset_id         int NOT NULL REFERENCES data_asset(asset_id),
  consent_id       int REFERENCES consent_artefact(consent_id),
  subject_role     subject_role NOT NULL,
  disposition      disposition,
  disposition_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_matches_role CHECK (
    (subject_role = 'consented' AND consent_id IS NOT NULL) OR
    (subject_role <> 'consented' AND consent_id IS NULL))
);
"""

# -------------------------------------------------- 8. circular foreign keys
CIRCULAR_FKS = """
ALTER TABLE auth_user   ADD CONSTRAINT fk_user_link
  FOREIGN KEY (registered_via_link_id) REFERENCES consent_link(link_id);
ALTER TABLE data_source ADD CONSTRAINT fk_source_site
  FOREIGN KEY (site_id) REFERENCES project_site(site_id);
ALTER TABLE project     ADD CONSTRAINT fk_project_notice
  FOREIGN KEY (current_notice_id) REFERENCES notice(notice_id);
"""

VIEW = """
CREATE VIEW v_current_consent AS
SELECT ca.* FROM consent_artefact ca
WHERE NOT EXISTS (
  SELECT 1 FROM consent_artefact s WHERE s.supersedes_consent_id = ca.consent_id);
"""

# Indexes that carry an obligation. Each answers a statutory question; none of
# them is performance tuning that can be dropped when a table gets large.
INDEXES = """
CREATE INDEX idx_artefact_user_notice  ON consent_artefact (auth_user_id, notice_id, affirmative_action_at DESC);
CREATE INDEX idx_artefact_supersedes   ON consent_artefact (supersedes_consent_id);
CREATE INDEX idx_export_line_user      ON export_line (auth_user_id);
CREATE INDEX idx_audit_subject         ON audit_log (subject_user_id, occurred_at DESC);
CREATE INDEX idx_audit_entity          ON audit_log (entity_type, entity_id);
CREATE INDEX idx_asset_consent_asset   ON asset_consent (asset_id);
CREATE INDEX idx_asset_consent_consent ON asset_consent (consent_id);
CREATE INDEX idx_user_via_link         ON auth_user (registered_via_link_id);
"""

# Operational indexes - performance, not obligation. Kept in a separate block so
# the distinction stays visible during review.
OPERATIONAL_INDEXES = """
CREATE INDEX idx_project_status        ON project (project_status, created_at DESC);
CREATE INDEX idx_project_created_by    ON project (created_by, created_at DESC);
CREATE INDEX idx_project_dco           ON project (dco_user_id, created_at DESC);
CREATE INDEX idx_notice_project        ON notice (project_id, version DESC);
CREATE INDEX idx_notice_purpose_notice ON notice_purpose (notice_id, display_order);
CREATE INDEX idx_link_notice           ON consent_link (notice_id);
CREATE INDEX idx_link_site             ON consent_link (site_id) WHERE status = 'active';
CREATE INDEX idx_site_project          ON project_site (project_id) WHERE status = 'active';
CREATE INDEX idx_approval_project      ON project_approval (project_id, uploaded_at DESC);
CREATE INDEX idx_status_hist_project   ON project_status_history (project_id, occurred_at DESC);
CREATE INDEX idx_ptype_hist_user       ON person_type_history (auth_user_id, changed_at DESC);
CREATE INDEX idx_grant_consent         ON consent_purpose_grant (consent_id);
CREATE INDEX idx_grant_purpose         ON consent_purpose_grant (purpose_id) WHERE granted;
CREATE INDEX idx_export_project        ON export_log (project_id, exported_at DESC);
CREATE INDEX idx_export_line_export    ON export_line (export_id);
CREATE INDEX idx_batch_source          ON import_batch (source_id, received_at DESC);
CREATE INDEX idx_batch_project         ON import_batch (project_id, received_at DESC);
CREATE INDEX idx_collection_project    ON collection (project_id, collected_on DESC);
CREATE INDEX idx_collection_batch      ON collection (batch_id);
CREATE INDEX idx_asset_collection      ON data_asset (collection_id);
CREATE INDEX idx_asset_unmapped        ON data_asset (collection_id) WHERE has_unmapped_subjects;
CREATE INDEX idx_audit_actor           ON audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_event           ON audit_log (event_type, occurred_at DESC);
CREATE INDEX idx_user_role_status      ON auth_user (role, status);
CREATE INDEX idx_user_email_lower      ON auth_user (lower(email));
CREATE INDEX idx_notice_lang_notice    ON notice_language (notice_id);
"""

DROP_TABLES = (
    "asset_consent", "data_asset", "collection", "import_batch",
    "export_line", "export_log",
    "consent_purpose_grant", "consent_artefact", "consent_link",
    "notice_language", "notice_purpose", "notice",
    "project_site", "project_approval", "project_status_history", "project",
    "purpose", "data_source", "processor",
    "audit_log", "person_type_history", "auth_user",
)

DROP_ENUMS = (
    "disposition", "subject_role", "asset_type", "batch_status", "exchange_mode",
    "source_role", "export_type", "action_type", "link_status", "approval_type",
    "record_status", "processor_type", "language_code", "change_class",
    "lapse_behaviour", "erasure_trigger", "retention_basis", "s7_clause",
    "lawful_basis", "notice_status", "purpose_status", "project_status",
    "user_status", "person_type", "user_role",
)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute(ENUMS)
    op.execute(ACCOUNTS)
    op.execute(AUDIT)
    op.execute(REGISTRY)
    op.execute(PROJECTS)
    op.execute(NOTICES)
    op.execute(CONSENT)
    op.execute(EXCHANGE)
    op.execute(CIRCULAR_FKS)
    op.execute(VIEW)
    op.execute(INDEXES)
    op.execute(OPERATIONAL_INDEXES)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS v_current_consent")
    for table in DROP_TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    for enum in DROP_ENUMS:
        op.execute(f"DROP TYPE IF EXISTS {enum}")
