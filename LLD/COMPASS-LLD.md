# COMPASS — Low-Level Design

Consent Management Platform for the Digital Personal Data Protection Act, 2023.

> **This file is generated.** Every route, gate, table and path below is read out
> of the running application object, the PostgreSQL catalogue and the filesystem.
> Regenerate it after any change to routing or schema rather than editing it by
> hand — a hand-maintained LLD is wrong within a week and nobody can tell which
> half.

## Contents

1. [Shape of the system](#1-shape-of-the-system)
2. [How access is decided](#2-how-access-is-decided)
3. [CRUD by entity](#3-crud-by-entity)
4. [Full endpoint reference](#4-full-endpoint-reference)
5. [Database tables](#5-database-tables)
6. [File tree — backend](#6-file-tree--backend)
7. [File tree — frontend](#7-file-tree--frontend)

## 1. Shape of the system

Two deployables against one database.

```
  browser
     │  Next.js 16 · React 19 · TanStack Query
     ▼
  nginx ──► FastAPI 0.141  (uvicorn under gunicorn)
     │         │
     │         ├── api/routers/v1   HTTP shape, role gate, response model
     │         ├── domain/…         the rules; no SQL, no HTTP
     │         └── db/repositories  raw SQL; scope compiled into WHERE
     │                  │
     │                  ▼
     │            PostgreSQL 17     triggers · hash chain · derived owners
     │                  ▲
     └── Celery worker ─┘           exports, retention, chain verification
                 │
               Redis                broker · rate-limit counters
```

**164 endpoints** — 93 GET · 53 POST · 12 PUT · 4 DELETE · 2 PATCH — across **15 areas**, over **25 tables**.

## 2. How access is decided

Two things gate every request, and they are separate on purpose.

**The role gate** is a FastAPI dependency, named in the endpoint signature. It
answers *may this kind of user call this endpoint at all* and produces 403.

**Row scope** is a SQL predicate compiled into the `WHERE` clause of the query
itself — never a filter applied to rows already fetched. It answers *which rows
does this user have*, and its failure is **404, not 403**: telling somebody a
project exists but is not theirs confirms it exists to anyone probing uuids.

| Gate | Endpoints | Means |
|---|---:|---|
| `unauthenticated` | 22 | No session. Health probes, public consent pages, `/meta`. |
| `CurrentUser` | 21 | Any signed-in user; the endpoint scopes rows itself. |
| `ProjectReader` | 20 | Any role that may see projects, narrowed by row scope. |
| `RequireDataSubject` | 12 | The data principal's own surface only. |
| `NoticeAuthor` | 10 | DPO anywhere, R&D User on their own projects. |
| `RequireDPOorAdmin` | 9 | DPO or platform administrator. |
| `RequireDPO` | 9 | The Data Protection Officer alone. |
| `NoticeReader` | 9 | Anyone who may read the notice. |
| `RequireAdmin` | 7 | Platform administrator alone. |
| `LinkReader` | 6 | Roles that may see consent links. |
| `ConsentReader` | 6 | Roles that may see consent artefacts. |
| `CollectionReader` | 6 | Roles that may see collections and assets. |
| `ExportReader` | 5 | Roles that may see exports. |
| `data source, write` | 4 | Write access to a specific data source. |
| `RequireStaff` | 3 | Any internal staff role, derived from the matrix. |
| `processor, write` | 3 | Write access to a specific processor. |
| `ImportActor` | 3 | Roles that may submit a manifest. |
| `PartialUser` | 2 | A half-authenticated session, mid-MFA. |
| `ReadRegistry` | 2 | Read the processor / source / purpose registry. |
| `processor, read` | 2 | Read access to a specific processor. |
| `data source, read` | 2 | Read access to a specific data source. |
| `ExportActor` | 1 | Roles that may generate an export. |

## 3. CRUD by entity

Grouped by the tables each area owns. `C`/`R`/`U`/`D` mark which operations the
HTTP surface actually exposes — several tables are deliberately **read-only over**
**HTTP** and written only by the domain or a trigger.

### System

*8 endpoints · no tables of its own · R*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/` | unauthenticated | — |
| `GET` | `/health` | unauthenticated | Liveness |
| `GET` | `/health/live` | unauthenticated | — |
| `GET` | `/health/ready` | unauthenticated | — |
| `GET` | `/meta/data-categories` | unauthenticated | Controlled vocabulary |
| `GET` | `/meta/enums` | unauthenticated | All enum values for dropdowns |
| `GET` | `/meta/version` | unauthenticated | — |
| `GET` | `/ready` | unauthenticated | Readiness |

### Authentication

*12 endpoints · no tables of its own · CRD*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `POST` | `/auth/login` | unauthenticated | Staff sign-in |
| `POST` | `/auth/logout` | CurrentUser | End this session |
| `GET` | `/auth/me` | CurrentUser | Who is signed in |
| `POST` | `/auth/mfa/resend` | PartialUser | Resend the MFA code |
| `POST` | `/auth/mfa/verify` | PartialUser | Complete stepped-up sign-in |
| `POST` | `/auth/otp/request` | unauthenticated | Data-subject sign-in code |
| `POST` | `/auth/otp/verify` | unauthenticated | Data-subject sign-in |
| `POST` | `/auth/password/change` | CurrentUser | — |
| `POST` | `/auth/password/reset/confirm` | unauthenticated | — |
| `POST` | `/auth/password/reset/request` | unauthenticated | — |
| `GET` | `/auth/sessions` | CurrentUser | Your active sessions |
| `DELETE` | `/auth/sessions/{session_uuid}` | CurrentUser | Revoke one of your sessions |

### Public consent

*6 endpoints · no tables of its own · CR*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/c/{token}` | unauthenticated | Validate the link |
| `POST` | `/c/{token}/consent` | unauthenticated | — |
| `GET` | `/c/{token}/notice` | unauthenticated | Render the notice - stamps served_at |
| `POST` | `/c/{token}/otp` | unauthenticated | 6-digit code, 10 minutes |
| `POST` | `/c/{token}/otp/verify` | unauthenticated | 5 attempts, then the code is discarded |
| `POST` | `/c/{token}/register` | unauthenticated | — |

### Public information

*2 endpoints · no tables of its own · R*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/notice/{notice_uuid}` | unauthenticated | Public notice viewer |
| `GET` | `/rights` | unauthenticated | How to make a rights request - Rule 9, Rule 14(1) |

### Users

*11 endpoints · `auth_user` · CRUD*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/users` | RequireDPOorAdmin | The staff and subject register |
| `POST` | `/users` | RequireAdmin | — |
| `GET` | `/users/collection-owners` | RequireStaff | Active DCOs and RCOs, for source ownership |
| `GET` | `/users/{user_uuid}` | RequireDPOorAdmin | — |
| `PATCH` | `/users/{user_uuid}` | RequireAdmin | — |
| `POST` | `/users/{user_uuid}/deactivate` | RequireAdmin | — |
| `POST` | `/users/{user_uuid}/mfa/reset` | RequireAdmin | — |
| `GET` | `/users/{user_uuid}/person-type-history` | RequireDPOorAdmin | — |
| `POST` | `/users/{user_uuid}/reactivate` | RequireAdmin | — |
| `POST` | `/users/{user_uuid}/role` | RequireAdmin | Change a role |
| `DELETE` | `/users/{user_uuid}/sessions` | RequireAdmin | Force logout |

### The signed-in user

*13 endpoints · no tables of its own · CRU*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/me` | RequireDataSubject | — |
| `PATCH` | `/me` | RequireDataSubject | — |
| `GET` | `/me/consents` | RequireDataSubject | — |
| `GET` | `/me/consents/{consent_uuid}` | RequireDataSubject | — |
| `GET` | `/me/consents/{consent_uuid}/grants` | RequireDataSubject | — |
| `GET` | `/me/consents/{consent_uuid}/history` | RequireDataSubject | The supersession chain |
| `GET` | `/me/consents/{consent_uuid}/notice` | RequireDataSubject | The words she actually saw |
| `GET` | `/me/consents/{consent_uuid}/trail` | RequireDataSubject | What was recorded about this consent |
| `POST` | `/me/consents/{consent_uuid}/withdraw` | RequireDataSubject | — |
| `POST` | `/me/contact/verify` | RequireDataSubject | — |
| `GET` | `/me/disclosures` | RequireDataSubject | Who was my data shared with (s.11(1)(b)) |
| `GET` | `/me/notifications` | RequireDataSubject | — |
| `POST` | `/me/person-type` | CurrentUser | — |

### Delegations

*5 endpoints · `delegation` · CRD*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/delegations` | RequireDPOorAdmin | Every live arrangement |
| `POST` | `/delegations` | RequireStaff | Arrange cover |
| `GET` | `/delegations/held` | CurrentUser | Cover I am providing |
| `GET` | `/delegations/mine` | CurrentUser | Cover I have arranged |
| `DELETE` | `/delegations/{delegation_uuid}` | RequireStaff | End cover now |

### Registry

*20 endpoints · `processor`, `data_source`, `purpose` · CRU*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/processors` | processor, read | — |
| `POST` | `/processors` | processor, write | — |
| `GET` | `/processors/{processor_uuid}` | processor, read | — |
| `PUT` | `/processors/{processor_uuid}` | processor, write | — |
| `POST` | `/processors/{processor_uuid}/suspend` | processor, write | — |
| `GET` | `/purposes` | ReadRegistry | — |
| `POST` | `/purposes` | RequireDPO | — |
| `GET` | `/purposes/{purpose_uuid}` | ReadRegistry | — |
| `PUT` | `/purposes/{purpose_uuid}` | RequireDPO | Draft only |
| `POST` | `/purposes/{purpose_uuid}/activate` | RequireDPO | — |
| `POST` | `/purposes/{purpose_uuid}/retire` | RequireDPO | — |
| `GET` | `/purposes/{purpose_uuid}/usage` | RequireDPOorAdmin | Notices referencing this purpose |
| `GET` | `/purposes/{purpose_uuid}/versions` | RequireDPOorAdmin | — |
| `GET` | `/sources` | data source, read | — |
| `POST` | `/sources` | data source, write | — |
| `GET` | `/sources/{source_uuid}` | data source, read | — |
| `PUT` | `/sources/{source_uuid}` | data source, write | — |
| `GET` | `/sources/{source_uuid}/batches` | CurrentUser | — |
| `PUT` | `/sources/{source_uuid}/owner` | data source, write | Assign the person accountable for a source |
| `POST` | `/sources/{source_uuid}/suspend` | data source, write | — |

### Projects

*27 endpoints · `project`, `project_approval`, `project_processor`, `project_site`, `project_status_history` · CRU*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/approvals` | ProjectReader | All approvals in scope |
| `GET` | `/approvals/{approval_uuid}` | ProjectReader | — |
| `GET` | `/approvals/{approval_uuid}/proof` | ProjectReader | Download the proof file |
| `GET` | `/projects` | ProjectReader | — |
| `POST` | `/projects` | CurrentUser | — |
| `GET` | `/projects/{project_uuid}` | ProjectReader | — |
| `PUT` | `/projects/{project_uuid}` | CurrentUser | Draft only |
| `GET` | `/projects/{project_uuid}/approvals` | ProjectReader | — |
| `POST` | `/projects/{project_uuid}/approvals` | CurrentUser | Upload an approval - proof is mandatory (INV-8) |
| `POST` | `/projects/{project_uuid}/close` | ProjectReader | — |
| `GET` | `/projects/{project_uuid}/history` | ProjectReader | — |
| `GET` | `/projects/{project_uuid}/processors` | ProjectReader | — |
| `POST` | `/projects/{project_uuid}/processors` | ProjectReader | — |
| `PUT` | `/projects/{project_uuid}/processors` | ProjectReader | Draft only — replaces the set |
| `POST` | `/projects/{project_uuid}/processors/{processor_uuid}/decision` | RequireDPO | — |
| `GET` | `/projects/{project_uuid}/sites` | ProjectReader | — |
| `POST` | `/projects/{project_uuid}/sites` | ProjectReader | — |
| `GET` | `/projects/{project_uuid}/summary` | ProjectReader | Everything a dashboard needs, in one call |
| `POST` | `/projects/{project_uuid}/transition` | ProjectReader | — |
| `GET` | `/projects/{project_uuid}/transitions` | ProjectReader | What may happen next, and why not |
| `GET` | `/sites` | ProjectReader | All sites in scope |
| `GET` | `/sites/{site_uuid}` | ProjectReader | — |
| `PUT` | `/sites/{site_uuid}` | ProjectReader | — |
| `POST` | `/sites/{site_uuid}/agent` | ProjectReader | Assign the Field Agent and mint the link |
| `POST` | `/sites/{site_uuid}/deactivate` | RequireDPO | — |
| `PUT` | `/sites/{site_uuid}/owner` | CurrentUser | Name who runs this site, overriding its source |
| `PUT` | `/sites/{site_uuid}/source` | CurrentUser | Attach the data source that stands here |

### Notices

*22 endpoints · `notice`, `notice_language`, `notice_purpose` · CRUD*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/notices` | NoticeReader | All notices in scope |
| `GET` | `/notices/import/template` | NoticeReader | The notice document to fill in |
| `GET` | `/notices/{notice_uuid}` | NoticeReader | — |
| `PUT` | `/notices/{notice_uuid}` | NoticeAuthor | Draft only |
| `GET` | `/notices/{notice_uuid}/checklist` | NoticeReader | — |
| `GET` | `/notices/{notice_uuid}/languages` | NoticeReader | — |
| `POST` | `/notices/{notice_uuid}/languages` | NoticeAuthor | — |
| `PUT` | `/notices/{notice_uuid}/languages/{code}` | NoticeAuthor | Draft only |
| `POST` | `/notices/{notice_uuid}/languages/{code}/approve` | RequireDPO | — |
| `GET` | `/notices/{notice_uuid}/preview` | NoticeReader | — |
| `POST` | `/notices/{notice_uuid}/publish` | RequireDPO | — |
| `GET` | `/notices/{notice_uuid}/purposes` | NoticeReader | — |
| `POST` | `/notices/{notice_uuid}/purposes` | NoticeAuthor | — |
| `POST` | `/notices/{notice_uuid}/purposes/activate` | RequireDPO | Activate every draft purpose on this notice |
| `DELETE` | `/notices/{notice_uuid}/purposes/{purpose_uuid}` | NoticeAuthor | Draft only |
| `PUT` | `/notices/{notice_uuid}/purposes/{purpose_uuid}` | NoticeAuthor | Narrow Rule 3(b) for this notice |
| `GET` | `/notices/{notice_uuid}/versions` | NoticeReader | — |
| `GET` | `/projects/{project_uuid}/notices` | NoticeReader | — |
| `POST` | `/projects/{project_uuid}/notices` | NoticeAuthor | — |
| `POST` | `/projects/{project_uuid}/notices/copy` | NoticeAuthor | Copy an existing notice into this project |
| `POST` | `/projects/{project_uuid}/notices/import` | NoticeAuthor | Create the notice and its purposes from an uploaded document |
| `POST` | `/projects/{project_uuid}/notices/import/validate` | NoticeAuthor | Dry run - reports what the document says, writes nothing |

### Consent

*12 endpoints · `consent_artefact`, `consent_link`, `consent_purpose_grant`, `person_type_history` · CR*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/consents` | ConsentReader | All consents in scope |
| `GET` | `/consents/{consent_uuid}` | ConsentReader | — |
| `GET` | `/consents/{consent_uuid}/assets` | ConsentReader | Which assets contain this person |
| `GET` | `/consents/{consent_uuid}/grants` | ConsentReader | — |
| `GET` | `/links` | LinkReader | All links in scope |
| `GET` | `/links/{link_uuid}` | LinkReader | — |
| `POST` | `/links/{link_uuid}/remint` | LinkReader | Replace a link with a fresh one |
| `POST` | `/links/{link_uuid}/revoke` | LinkReader | — |
| `GET` | `/links/{link_uuid}/stats` | LinkReader | — |
| `GET` | `/projects/{project_uuid}/consents` | ConsentReader | — |
| `GET` | `/projects/{project_uuid}/consents/summary` | ConsentReader | — |
| `GET` | `/projects/{project_uuid}/links` | LinkReader | — |

### Collection and exchange

*19 endpoints · `collection`, `data_asset`, `asset_consent`, `import_batch`, `export_log`, `export_line` · CR*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/assets/{asset_uuid}` | CollectionReader | — |
| `GET` | `/assets/{asset_uuid}/subjects` | CurrentUser | One row per subject, bystanders included |
| `GET` | `/collections` | CollectionReader | All collections, with their reconciliation gap |
| `GET` | `/collections/{collection_uuid}` | CollectionReader | — |
| `GET` | `/collections/{collection_uuid}/assets` | CollectionReader | — |
| `GET` | `/collections/{collection_uuid}/exceptions` | CollectionReader | Declared against mapped - the control that makes direct collection workable |
| `GET` | `/exports` | ExportReader | The disclosure register |
| `GET` | `/exports/{export_uuid}` | ExportReader | — |
| `GET` | `/exports/{export_uuid}/download` | ExportReader | — |
| `GET` | `/exports/{export_uuid}/lines` | ExportReader | Who was in this file (s.11(1)(b)) |
| `GET` | `/imports` | CurrentUser | — |
| `POST` | `/imports` | ImportActor | — |
| `GET` | `/imports/template` | ImportActor | A manifest file to fill in |
| `POST` | `/imports/validate` | ImportActor | Dry run - nothing is written |
| `GET` | `/imports/{batch_uuid}` | CurrentUser | — |
| `GET` | `/imports/{batch_uuid}/errors` | CurrentUser | — |
| `GET` | `/projects/{project_uuid}/collections` | CollectionReader | — |
| `GET` | `/projects/{project_uuid}/exports` | ExportReader | — |
| `POST` | `/projects/{project_uuid}/exports` | ExportActor | — |

### Audit

*3 endpoints · `audit_log` · R*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/audit` | RequireDPOorAdmin | Search the trail |
| `GET` | `/audit/verify` | RequireDPOorAdmin | Verify the hash chain |
| `GET` | `/audit/{log_uuid}` | RequireDPOorAdmin | — |

### Dashboard

*3 endpoints · no tables of its own · CR*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/dashboard` | CurrentUser | Role-aware aggregate |
| `GET` | `/notifications` | CurrentUser | — |
| `POST` | `/notifications/{log_uuid}/resend` | CurrentUser | — |

### Other

*1 endpoints · no tables of its own · R*

| | Endpoint | Gate | Does |
|---|---|---|---|
| `GET` | `/metrics` | unauthenticated | — |

### Supporting tables

No CRUD surface of their own — written by the domain, by a trigger, or by Alembic.

- `alembic_version` — 1 row

## 4. Full endpoint reference

Every route, in registration order within its area.

| | Endpoint | Area | Gate |
|---|---|---|---|
| `GET` | `/` | system | unauthenticated |
| `GET` | `/health` | system | unauthenticated |
| `GET` | `/health/live` | system | unauthenticated |
| `GET` | `/ready` | system | unauthenticated |
| `GET` | `/health/ready` | system | unauthenticated |
| `GET` | `/meta/version` | system | unauthenticated |
| `GET` | `/meta/enums` | system | unauthenticated |
| `GET` | `/meta/data-categories` | system | unauthenticated |
| `POST` | `/auth/login` | auth | unauthenticated |
| `POST` | `/auth/mfa/verify` | auth | PartialUser |
| `POST` | `/auth/mfa/resend` | auth | PartialUser |
| `POST` | `/auth/otp/request` | auth | unauthenticated |
| `POST` | `/auth/otp/verify` | auth | unauthenticated |
| `POST` | `/auth/logout` | auth | CurrentUser |
| `GET` | `/auth/me` | auth | CurrentUser |
| `POST` | `/auth/password/change` | auth | CurrentUser |
| `POST` | `/auth/password/reset/request` | auth | unauthenticated |
| `POST` | `/auth/password/reset/confirm` | auth | unauthenticated |
| `GET` | `/auth/sessions` | auth | CurrentUser |
| `DELETE` | `/auth/sessions/{session_uuid}` | auth | CurrentUser |
| `GET` | `/c/{token}` | public consent | unauthenticated |
| `POST` | `/c/{token}/register` | public consent | unauthenticated |
| `POST` | `/c/{token}/otp` | public consent | unauthenticated |
| `POST` | `/c/{token}/otp/verify` | public consent | unauthenticated |
| `GET` | `/c/{token}/notice` | public consent | unauthenticated |
| `POST` | `/c/{token}/consent` | public consent | unauthenticated |
| `GET` | `/notice/{notice_uuid}` | public information | unauthenticated |
| `GET` | `/rights` | public information | unauthenticated |
| `GET` | `/users/collection-owners` | users | RequireStaff |
| `GET` | `/users` | users | RequireDPOorAdmin |
| `POST` | `/users` | users | RequireAdmin |
| `GET` | `/users/{user_uuid}` | users | RequireDPOorAdmin |
| `PATCH` | `/users/{user_uuid}` | users | RequireAdmin |
| `POST` | `/users/{user_uuid}/role` | users | RequireAdmin |
| `POST` | `/users/{user_uuid}/deactivate` | users | RequireAdmin |
| `POST` | `/users/{user_uuid}/reactivate` | users | RequireAdmin |
| `DELETE` | `/users/{user_uuid}/sessions` | users | RequireAdmin |
| `POST` | `/users/{user_uuid}/mfa/reset` | users | RequireAdmin |
| `GET` | `/users/{user_uuid}/person-type-history` | users | RequireDPOorAdmin |
| `GET` | `/me` | me | RequireDataSubject |
| `PATCH` | `/me` | me | RequireDataSubject |
| `POST` | `/me/contact/verify` | me | RequireDataSubject |
| `POST` | `/me/person-type` | me | CurrentUser |
| `GET` | `/me/consents` | me | RequireDataSubject |
| `GET` | `/me/consents/{consent_uuid}` | me | RequireDataSubject |
| `GET` | `/me/consents/{consent_uuid}/notice` | me | RequireDataSubject |
| `GET` | `/me/consents/{consent_uuid}/grants` | me | RequireDataSubject |
| `GET` | `/me/consents/{consent_uuid}/history` | me | RequireDataSubject |
| `GET` | `/me/consents/{consent_uuid}/trail` | me | RequireDataSubject |
| `POST` | `/me/consents/{consent_uuid}/withdraw` | me | RequireDataSubject |
| `GET` | `/me/disclosures` | me | RequireDataSubject |
| `GET` | `/me/notifications` | me | RequireDataSubject |
| `POST` | `/delegations` | delegations | RequireStaff |
| `DELETE` | `/delegations/{delegation_uuid}` | delegations | RequireStaff |
| `GET` | `/delegations/mine` | delegations | CurrentUser |
| `GET` | `/delegations/held` | delegations | CurrentUser |
| `GET` | `/delegations` | delegations | RequireDPOorAdmin |
| `GET` | `/purposes` | registry | ReadRegistry |
| `POST` | `/purposes` | registry | RequireDPO |
| `GET` | `/purposes/{purpose_uuid}` | registry | ReadRegistry |
| `PUT` | `/purposes/{purpose_uuid}` | registry | RequireDPO |
| `POST` | `/purposes/{purpose_uuid}/activate` | registry | RequireDPO |
| `POST` | `/purposes/{purpose_uuid}/retire` | registry | RequireDPO |
| `GET` | `/purposes/{purpose_uuid}/versions` | registry | RequireDPOorAdmin |
| `GET` | `/purposes/{purpose_uuid}/usage` | registry | RequireDPOorAdmin |
| `GET` | `/processors` | registry | processor, read |
| `POST` | `/processors` | registry | processor, write |
| `GET` | `/processors/{processor_uuid}` | registry | processor, read |
| `PUT` | `/processors/{processor_uuid}` | registry | processor, write |
| `POST` | `/processors/{processor_uuid}/suspend` | registry | processor, write |
| `GET` | `/sources` | registry | data source, read |
| `POST` | `/sources` | registry | data source, write |
| `GET` | `/sources/{source_uuid}` | registry | data source, read |
| `PUT` | `/sources/{source_uuid}` | registry | data source, write |
| `PUT` | `/sources/{source_uuid}/owner` | registry | data source, write |
| `POST` | `/sources/{source_uuid}/suspend` | registry | data source, write |
| `GET` | `/sources/{source_uuid}/batches` | registry | CurrentUser |
| `GET` | `/sites` | projects | ProjectReader |
| `GET` | `/approvals` | projects | ProjectReader |
| `GET` | `/projects` | projects | ProjectReader |
| `POST` | `/projects` | projects | CurrentUser |
| `GET` | `/projects/{project_uuid}` | projects | ProjectReader |
| `PUT` | `/projects/{project_uuid}` | projects | CurrentUser |
| `GET` | `/projects/{project_uuid}/transitions` | projects | ProjectReader |
| `POST` | `/projects/{project_uuid}/transition` | projects | ProjectReader |
| `GET` | `/projects/{project_uuid}/history` | projects | ProjectReader |
| `GET` | `/projects/{project_uuid}/summary` | projects | ProjectReader |
| `GET` | `/projects/{project_uuid}/processors` | projects | ProjectReader |
| `PUT` | `/projects/{project_uuid}/processors` | projects | ProjectReader |
| `POST` | `/projects/{project_uuid}/processors` | projects | ProjectReader |
| `POST` | `/projects/{project_uuid}/processors/{processor_uuid}/decision` | projects | RequireDPO |
| `POST` | `/projects/{project_uuid}/close` | projects | ProjectReader |
| `GET` | `/projects/{project_uuid}/approvals` | projects | ProjectReader |
| `POST` | `/projects/{project_uuid}/approvals` | projects | CurrentUser |
| `GET` | `/approvals/{approval_uuid}` | projects | ProjectReader |
| `GET` | `/approvals/{approval_uuid}/proof` | projects | ProjectReader |
| `GET` | `/projects/{project_uuid}/sites` | projects | ProjectReader |
| `POST` | `/projects/{project_uuid}/sites` | projects | ProjectReader |
| `GET` | `/sites/{site_uuid}` | projects | ProjectReader |
| `PUT` | `/sites/{site_uuid}` | projects | ProjectReader |
| `PUT` | `/sites/{site_uuid}/source` | projects | CurrentUser |
| `PUT` | `/sites/{site_uuid}/owner` | projects | CurrentUser |
| `POST` | `/sites/{site_uuid}/deactivate` | projects | RequireDPO |
| `POST` | `/sites/{site_uuid}/agent` | projects | ProjectReader |
| `GET` | `/notices` | notices | NoticeReader |
| `GET` | `/projects/{project_uuid}/notices` | notices | NoticeReader |
| `POST` | `/projects/{project_uuid}/notices` | notices | NoticeAuthor |
| `POST` | `/projects/{project_uuid}/notices/copy` | notices | NoticeAuthor |
| `GET` | `/notices/{notice_uuid}` | notices | NoticeReader |
| `PUT` | `/notices/{notice_uuid}` | notices | NoticeAuthor |
| `GET` | `/notices/{notice_uuid}/versions` | notices | NoticeReader |
| `GET` | `/notices/{notice_uuid}/purposes` | notices | NoticeReader |
| `POST` | `/notices/{notice_uuid}/purposes` | notices | NoticeAuthor |
| `PUT` | `/notices/{notice_uuid}/purposes/{purpose_uuid}` | notices | NoticeAuthor |
| `DELETE` | `/notices/{notice_uuid}/purposes/{purpose_uuid}` | notices | NoticeAuthor |
| `GET` | `/notices/{notice_uuid}/languages` | notices | NoticeReader |
| `POST` | `/notices/{notice_uuid}/languages` | notices | NoticeAuthor |
| `PUT` | `/notices/{notice_uuid}/languages/{code}` | notices | NoticeAuthor |
| `POST` | `/notices/{notice_uuid}/languages/{code}/approve` | notices | RequireDPO |
| `GET` | `/notices/{notice_uuid}/checklist` | notices | NoticeReader |
| `GET` | `/notices/{notice_uuid}/preview` | notices | NoticeReader |
| `POST` | `/notices/{notice_uuid}/publish` | notices | RequireDPO |
| `POST` | `/projects/{project_uuid}/notices/import/validate` | notices | NoticeAuthor |
| `POST` | `/projects/{project_uuid}/notices/import` | notices | NoticeAuthor |
| `POST` | `/notices/{notice_uuid}/purposes/activate` | notices | RequireDPO |
| `GET` | `/notices/import/template` | notices | NoticeReader |
| `GET` | `/links` | consent | LinkReader |
| `GET` | `/consents` | consent | ConsentReader |
| `GET` | `/projects/{project_uuid}/links` | consent | LinkReader |
| `GET` | `/links/{link_uuid}` | consent | LinkReader |
| `GET` | `/links/{link_uuid}/stats` | consent | LinkReader |
| `POST` | `/links/{link_uuid}/remint` | consent | LinkReader |
| `POST` | `/links/{link_uuid}/revoke` | consent | LinkReader |
| `GET` | `/projects/{project_uuid}/consents` | consent | ConsentReader |
| `GET` | `/projects/{project_uuid}/consents/summary` | consent | ConsentReader |
| `GET` | `/consents/{consent_uuid}` | consent | ConsentReader |
| `GET` | `/consents/{consent_uuid}/grants` | consent | ConsentReader |
| `GET` | `/consents/{consent_uuid}/assets` | consent | ConsentReader |
| `GET` | `/exports` | exchange | ExportReader |
| `GET` | `/collections` | exchange | CollectionReader |
| `POST` | `/projects/{project_uuid}/exports` | exchange | ExportActor |
| `GET` | `/projects/{project_uuid}/exports` | exchange | ExportReader |
| `GET` | `/exports/{export_uuid}` | exchange | ExportReader |
| `GET` | `/exports/{export_uuid}/download` | exchange | ExportReader |
| `GET` | `/exports/{export_uuid}/lines` | exchange | ExportReader |
| `GET` | `/imports/template` | exchange | ImportActor |
| `POST` | `/imports/validate` | exchange | ImportActor |
| `POST` | `/imports` | exchange | ImportActor |
| `GET` | `/imports` | exchange | CurrentUser |
| `GET` | `/imports/{batch_uuid}` | exchange | CurrentUser |
| `GET` | `/imports/{batch_uuid}/errors` | exchange | CurrentUser |
| `GET` | `/projects/{project_uuid}/collections` | exchange | CollectionReader |
| `GET` | `/collections/{collection_uuid}` | exchange | CollectionReader |
| `GET` | `/collections/{collection_uuid}/assets` | exchange | CollectionReader |
| `GET` | `/collections/{collection_uuid}/exceptions` | exchange | CollectionReader |
| `GET` | `/assets/{asset_uuid}` | exchange | CollectionReader |
| `GET` | `/assets/{asset_uuid}/subjects` | exchange | CurrentUser |
| `GET` | `/audit` | audit | RequireDPOorAdmin |
| `GET` | `/audit/verify` | audit | RequireDPOorAdmin |
| `GET` | `/audit/{log_uuid}` | audit | RequireDPOorAdmin |
| `GET` | `/dashboard` | dashboard | CurrentUser |
| `GET` | `/notifications` | dashboard | CurrentUser |
| `POST` | `/notifications/{log_uuid}/resend` | dashboard | CurrentUser |
| `GET` | `/metrics` | other | unauthenticated |

## 5. Database tables

25 tables. Row counts are from the development database at generation
time and are indicative only.

| Table | Rows | Columns |
|---|---:|---|
| `alembic_version` | 1 | `version_num` |
| `asset_consent` | 5 | `asset_consent_id`, `asset_id`, `consent_id`, `subject_role`, `disposition`, `disposition_at`, `created_at` |
| `audit_log` | 1907 | `log_id`, `log_uuid`, `event_type`, `actor_user_id`, `subject_user_id`, `entity_type`, `entity_id`, `occurred_at` … +1 |
| `auth_user` | 24 | `id`, `uuid`, `username`, `full_name`, `email`, `mobile`, `organization_id`, `role` … +6 |
| `collection` | 2 | `collection_id`, `collection_uuid`, `source_id`, `source_collection_ref`, `project_id`, `site_id`, `batch_id`, `agent_ref` … +3 |
| `consent_artefact` | 12 | `consent_id`, `consent_uuid`, `auth_user_id`, `notice_id`, `notice_language_id`, `notice_content_hash`, `link_id`, `served_at` … +6 |
| `consent_link` | 21 | `link_id`, `link_uuid`, `notice_id`, `site_id`, `token`, `expires_at`, `max_uses`, `use_count` … +6 |
| `consent_purpose_grant` | 20 | `grant_id`, `consent_id`, `purpose_id`, `granted` |
| `data_asset` | 5 | `asset_id`, `asset_uuid`, `source_id`, `source_asset_ref`, `collection_id`, `asset_type`, `storage_ref`, `has_unmapped_subjects` … +1 |
| `data_source` | 9 | `source_id`, `source_uuid`, `source_code`, `name`, `source_role`, `exchange_mode`, `id_scheme`, `processor_id` … +5 |
| `delegation` | 0 | `delegation_id`, `delegation_uuid`, `delegator_user_id`, `delegate_user_id`, `reason`, `starts_at`, `ends_at`, `revoked_at` … +3 |
| `export_line` | 7 | `line_id`, `export_id`, `auth_user_id`, `consent_id` |
| `export_log` | 19 | `export_id`, `export_uuid`, `project_id`, `site_id`, `export_type`, `exported_by`, `exported_at`, `row_count` … +1 |
| `import_batch` | 2 | `batch_id`, `batch_uuid`, `source_id`, `project_id`, `file_name`, `file_hash`, `declared_rows`, `accepted_rows` … +5 |
| `notice` | 34 | `notice_id`, `notice_uuid`, `notice_code`, `project_id`, `version`, `withdraw_url`, `exercise_rights_url`, `board_complaint_url` … +10 |
| `notice_language` | 40 | `notice_language_id`, `notice_language_uuid`, `notice_id`, `language_code`, `rendered_text`, `content_hash`, `created_by`, `approved_by` … +3 |
| `notice_purpose` | 40 | `notice_purpose_id`, `notice_id`, `purpose_id`, `display_order`, `is_mandatory`, `data_categories_override`, `uses_override`, `overridden_by` … +1 |
| `person_type_history` | 0 | `history_id`, `history_uuid`, `auth_user_id`, `from_type`, `to_type`, `reason`, `changed_by`, `changed_at` |
| `processor` | 5 | `processor_id`, `processor_uuid`, `legal_name`, `type`, `contract_ref`, `security_confirmed_at`, `status`, `created_at` … +1 |
| `project` | 73 | `project_id`, `project_uuid`, `project_name`, `internal_project_name`, `description`, `requesting_team`, `project_status`, `current_notice_id` … +4 |
| `project_approval` | 14 | `approval_id`, `approval_uuid`, `project_id`, `approval_type`, `reference_no`, `approved_on`, `proof_file_ref`, `proof_file_hash` … +2 |
| `project_processor` | 49 | `project_processor_id`, `project_id`, `processor_id`, `added_by`, `added_at`, `status`, `decided_by`, `decided_at` … +1 |
| `project_site` | 21 | `site_id`, `site_uuid`, `project_id`, `processor_id`, `site_label`, `location`, `status`, `created_at` … +4 |
| `project_status_history` | 105 | `history_id`, `history_uuid`, `project_id`, `from_status`, `to_status`, `reason`, `actor_user_id`, `occurred_at` |
| `purpose` | 3 | `purpose_id`, `purpose_uuid`, `purpose_code`, `version`, `status`, `name`, `description`, `uses` … +13 |

## 6. File tree — backend

Generated artefacts are omitted: `.venv`, `node_modules`, `__pycache__`, `.next`, build output, test results, and anything holding secrets or uploads.

```
cmp_backend/
├── .github/
│   └── workflows/
│       └── ci.yml
├── docker/
│   ├── initdb/
│   ├── nginx/
│   │   ├── certs/
│   │   └── nginx.conf
│   ├── docker-compose.yml
│   └── Dockerfile
├── docs/
│   ├── architecture/
│   │   ├── dependency-rules.md
│   │   ├── layers.md
│   │   ├── overview.md
│   │   └── request-lifecycle.md
│   ├── database/
│   │   ├── migrations.md
│   │   ├── schema.md
│   │   └── transactions.md
│   ├── operations/
│   │   ├── configuration.md
│   │   ├── deployment.md
│   │   └── monitoring.md
│   └── security/
│       ├── audit.md
│       ├── authentication.md
│       ├── authorization.md
│       ├── csrf.md
│       ├── rate-limiting.md
│       └── sessions.md
├── migrations/
│   ├── versions/
│   │   ├── 0001_baseline_schema.py
│   │   ├── 0002_enforcement.py
│   │   ├── 0003_least_privilege.py
│   │   ├── 0004_constraint_fixes.py
│   │   ├── 0005_site_ownership_and_notice_overrides.py
│   │   ├── 0006_delegation.py
│   │   ├── 0007_collection_model.py
│   │   ├── 0008_site_owner_override.py
│   │   ├── 0009_processor_amendments.py
│   │   ├── 0010_single_project_export.py
│   │   └── 0011_recoverable_consent_links.py
│   ├── env.py
│   ├── README
│   └── script.py.mako
├── scripts/
│   ├── create_admin.py
│   ├── db.py
│   ├── healthcheck.py
│   ├── reset_dev.py
│   └── seed.py
├── src/
│   └── cmp/
│       ├── api/
│       │   ├── dependencies/
│       │   │   ├── __init__.py
│       │   │   ├── authentication.py
│       │   │   ├── authorization.py
│       │   │   ├── common.py
│       │   │   ├── csrf.py
│       │   │   ├── filters.py
│       │   │   ├── pagination.py
│       │   │   └── sessions.py
│       │   ├── errors/
│       │   │   ├── __init__.py
│       │   │   ├── handlers.py
│       │   │   ├── mapping.py
│       │   │   └── responses.py
│       │   ├── middleware/
│       │   │   ├── __init__.py
│       │   │   ├── access_log.py
│       │   │   ├── body_limit.py
│       │   │   ├── request_context.py
│       │   │   └── security_headers.py
│       │   ├── routers/
│       │   │   ├── public/
│       │   │   ├── v1/
│       │   │   └── __init__.py
│       │   ├── schemas/
│       │   │   ├── audit/
│       │   │   ├── auth/
│       │   │   ├── consents/
│       │   │   ├── dashboard/
│       │   │   ├── exchange/
│       │   │   ├── notices/
│       │   │   ├── projects/
│       │   │   ├── registry/
│       │   │   ├── system/
│       │   │   └── users/
│       │   └── __init__.py
│       ├── auth/
│       │   ├── authentication/
│       │   │   ├── __init__.py
│       │   │   ├── otp.py
│       │   │   └── service.py
│       │   ├── authorization/
│       │   │   ├── __init__.py
│       │   │   ├── evaluator.py
│       │   │   ├── permissions.py
│       │   │   ├── policy.py
│       │   │   ├── resources.py
│       │   │   ├── roles.py
│       │   │   └── scopes.py
│       │   ├── identity/
│       │   │   ├── __init__.py
│       │   │   └── principal.py
│       │   ├── rate_limit/
│       │   │   ├── __init__.py
│       │   │   └── service.py
│       │   ├── sessions/
│       │   │   ├── __init__.py
│       │   │   └── service.py
│       │   └── __init__.py
│       ├── bootstrap/
│       │   ├── __init__.py
│       │   ├── application.py
│       │   ├── container.py
│       │   ├── dependencies.py
│       │   ├── lifespan.py
│       │   ├── middleware.py
│       │   └── routers.py
│       ├── core/
│       │   ├── __init__.py
│       │   ├── config.py
│       │   ├── constants.py
│       │   ├── context.py
│       │   ├── enums.py
│       │   ├── errors.py
│       │   ├── logging.py
│       │   ├── pagination.py
│       │   ├── permissions.py
│       │   ├── result.py
│       │   └── security.py
│       ├── db/
│       │   ├── repositories/
│       │   │   ├── __init__.py
│       │   │   ├── audit.py
│       │   │   ├── consent.py
│       │   │   ├── delegations.py
│       │   │   ├── entities.py
│       │   │   ├── exchange.py
│       │   │   ├── notices.py
│       │   │   ├── projects.py
│       │   │   ├── registry.py
│       │   │   └── users.py
│       │   ├── __init__.py
│       │   ├── pool.py
│       │   ├── redis.py
│       │   └── sql.py
│       ├── domain/
│       │   ├── audit/
│       │   │   ├── __init__.py
│       │   │   └── service.py
│       │   ├── consent/
│       │   │   ├── __init__.py
│       │   │   └── service.py
│       │   ├── delegations/
│       │   │   ├── __init__.py
│       │   │   └── service.py
│       │   ├── exchange/
│       │   │   ├── __init__.py
│       │   │   └── service.py
│       │   ├── notices/
│       │   │   ├── assets/
│       │   │   ├── __init__.py
│       │   │   ├── document.py
│       │   │   ├── importer.py
│       │   │   └── service.py
│       │   ├── projects/
│       │   │   ├── __init__.py
│       │   │   ├── service.py
│       │   │   └── state_machine.py
│       │   ├── registry/
│       │   │   └── __init__.py
│       │   ├── shared/
│       │   │   └── __init__.py
│       │   ├── users/
│       │   │   └── __init__.py
│       │   └── __init__.py
│       ├── infrastructure/
│       │   ├── email/
│       │   │   ├── __init__.py
│       │   │   ├── service.py
│       │   │   ├── templates.py
│       │   │   └── transport.py
│       │   ├── external/
│       │   │   ├── __init__.py
│       │   │   └── clients.py
│       │   ├── sms/
│       │   │   ├── __init__.py
│       │   │   └── transport.py
│       │   ├── storage/
│       │   │   ├── __init__.py
│       │   │   ├── local.py
│       │   │   ├── object_store.py
│       │   │   └── service.py
│       │   └── __init__.py
│       ├── schemas/
│       │   ├── __init__.py
│       │   └── common.py
│       ├── tasks/
│       │   ├── authentication/
│       │   │   ├── __init__.py
│       │   │   └── otp.py
│       │   ├── exchange/
│       │   │   └── __init__.py
│       │   ├── maintenance/
│       │   │   ├── __init__.py
│       │   │   ├── assets.py
│       │   │   ├── audit.py
│       │   │   ├── consent_links.py
│       │   │   └── retention.py
│       │   ├── notifications/
│       │   │   ├── __init__.py
│       │   │   ├── batch.py
│       │   │   ├── consent.py
│       │   │   └── withdrawal.py
│       │   ├── __init__.py
│       │   ├── app.py
│       │   └── dispatch.py
│       ├── validation/
│       │   ├── __init__.py
│       │   ├── common.py
│       │   ├── contacts.py
│       │   ├── files.py
│       │   ├── identifiers.py
│       │   ├── pagination.py
│       │   ├── security.py
│       │   ├── strings.py
│       │   └── urls.py
│       ├── __init__.py
│       ├── __main__.py
│       └── main.py
├── tests/
│   ├── api/
│   │   └── __init__.py
│   ├── fixtures/
│   │   └── notice_filled.docx
│   ├── integration/
│   │   ├── auth/
│   │   │   └── __init__.py
│   │   ├── database/
│   │   │   ├── __init__.py
│   │   │   └── test_enum_parity.py
│   │   ├── enforcement/
│   │   │   ├── __init__.py
│   │   │   └── test_enforcement.py
│   │   ├── __init__.py
│   │   ├── test_notice_import.py
│   │   └── test_reported_fixes.py
│   ├── security/
│   │   ├── __init__.py
│   │   ├── test_authentication.py
│   │   ├── test_bfla.py
│   │   ├── test_bola.py
│   │   ├── test_collection_routing.py
│   │   ├── test_csrf.py
│   │   ├── test_mass_assignment.py
│   │   ├── test_matrix_integrity.py
│   │   ├── test_processor_amendments.py
│   │   ├── test_project_export.py
│   │   ├── test_rate_limits.py
│   │   ├── test_registry_boundaries.py
│   │   ├── test_site_boundary.py
│   │   ├── test_site_owner_override.py
│   │   ├── test_site_ownership.py
│   │   └── test_subject_surface.py
│   ├── unit/
│   │   ├── auth/
│   │   │   ├── __init__.py
│   │   │   └── test_permissions_and_paging.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   └── test_security.py
│   │   ├── domain/
│   │   │   ├── projects/
│   │   │   │   ├── __init__.py
│   │   │   │   └── test_state_machine.py
│   │   │   ├── __init__.py
│   │   │   └── test_notice_codes.py
│   │   ├── validation/
│   │   │   └── __init__.py
│   │   └── __init__.py
│   ├── __init__.py
│   └── conftest.py
├── .coverage
├── .dockerignore
├── .env
├── .env.example
├── .gitignore
├── .pre-commit-config.yaml
├── .python-version
├── alembic.ini
├── openapi.json
├── pyproject.toml
├── README.md
└── uv.lock
```

## 7. File tree — frontend

Generated artefacts are omitted: `.venv`, `node_modules`, `__pycache__`, `.next`, build output, test results, and anything holding secrets or uploads.

```
cmp_frontent/
├── e2e/
│   ├── support/
│   │   └── session.ts
│   ├── auth.setup.ts
│   ├── auth.spec.ts
│   ├── consent-flow.spec.ts
│   ├── detail-pages.spec.ts
│   ├── forms.spec.ts
│   ├── links.spec.ts
│   ├── nav-coverage.spec.ts
│   ├── notice-upload.spec.ts
│   ├── routing.spec.ts
│   ├── screenshot.css
│   ├── subject.spec.ts
│   └── visual.spec.ts
├── public/
│   ├── file.svg
│   ├── globe.svg
│   ├── next.svg
│   ├── vercel.svg
│   └── window.svg
├── src/
│   ├── app/
│   │   ├── (app)/
│   │   │   ├── account/
│   │   │   │   └── page.tsx
│   │   │   ├── approvals/
│   │   │   │   └── page.tsx
│   │   │   ├── audit/
│   │   │   │   └── page.tsx
│   │   │   ├── collections/
│   │   │   │   ├── [uuid]/
│   │   │   │   └── page.tsx
│   │   │   ├── consents/
│   │   │   │   ├── [uuid]/
│   │   │   │   └── page.tsx
│   │   │   ├── cover/
│   │   │   │   └── page.tsx
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx
│   │   │   ├── exports/
│   │   │   │   └── page.tsx
│   │   │   ├── imports/
│   │   │   │   ├── [uuid]/
│   │   │   │   └── page.tsx
│   │   │   ├── links/
│   │   │   │   └── page.tsx
│   │   │   ├── my-consents/
│   │   │   │   └── page.tsx
│   │   │   ├── notices/
│   │   │   │   ├── [uuid]/
│   │   │   │   └── page.tsx
│   │   │   ├── notifications/
│   │   │   │   └── page.tsx
│   │   │   ├── processors/
│   │   │   │   └── page.tsx
│   │   │   ├── projects/
│   │   │   │   ├── [uuid]/
│   │   │   │   └── page.tsx
│   │   │   ├── purposes/
│   │   │   │   ├── [uuid]/
│   │   │   │   └── page.tsx
│   │   │   ├── sites/
│   │   │   │   └── page.tsx
│   │   │   ├── sources/
│   │   │   │   └── page.tsx
│   │   │   ├── users/
│   │   │   │   └── page.tsx
│   │   │   └── layout.tsx
│   │   ├── c/
│   │   │   └── [token]/
│   │   │       └── page.tsx
│   │   ├── rights/
│   │   │   └── page.tsx
│   │   ├── sign-in/
│   │   │   ├── reset/
│   │   │   │   └── page.tsx
│   │   │   ├── verify/
│   │   │   │   └── page.tsx
│   │   │   └── page.tsx
│   │   ├── favicon.ico
│   │   ├── forms.test.ts
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── data-display/
│   │   │   ├── active-filters.tsx
│   │   │   ├── activity-feed.tsx
│   │   │   ├── audit-detail.tsx
│   │   │   ├── resource-list.test.tsx
│   │   │   └── resource-list.tsx
│   │   ├── feedback/
│   │   │   └── error-boundary.tsx
│   │   ├── forms/
│   │   │   └── index.tsx
│   │   ├── layout/
│   │   │   ├── app-shell.tsx
│   │   │   └── auth-layout.tsx
│   │   ├── security/
│   │   │   ├── can.tsx
│   │   │   ├── index.ts
│   │   │   ├── require-section.tsx
│   │   │   ├── security.test.tsx
│   │   │   └── session-warning.tsx
│   │   └── ui/
│   │       ├── charts.tsx
│   │       ├── dialog.tsx
│   │       ├── graphics.tsx
│   │       ├── primitives.tsx
│   │       └── status.tsx
│   ├── features/
│   │   ├── account/
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   ├── mutations.ts
│   │   │   └── queries.ts
│   │   ├── audit/
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   └── queries.ts
│   │   ├── auth/
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   └── schemas.ts
│   │   ├── consent/
│   │   │   ├── components/
│   │   │   │   ├── copy-link.tsx
│   │   │   │   ├── index.ts
│   │   │   │   └── replace-link.tsx
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   ├── mutations.ts
│   │   │   └── queries.ts
│   │   ├── dashboard/
│   │   │   ├── components/
│   │   │   │   ├── config.ts
│   │   │   │   ├── helpers.ts
│   │   │   │   ├── icons.tsx
│   │   │   │   ├── index.ts
│   │   │   │   ├── queue-card.tsx
│   │   │   │   ├── recent-card.tsx
│   │   │   │   └── skeleton.tsx
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   └── queries.ts
│   │   ├── delegations/
│   │   │   ├── components/
│   │   │   │   └── grant-cover-form.tsx
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   ├── mutations.ts
│   │   │   └── queries.ts
│   │   ├── exchange/
│   │   │   ├── components/
│   │   │   │   ├── export-form.tsx
│   │   │   │   ├── import-wizard.tsx
│   │   │   │   └── index.ts
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   ├── mutations.ts
│   │   │   ├── queries.ts
│   │   │   └── schemas.ts
│   │   ├── meta/
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   └── queries.ts
│   │   ├── my-consents/
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   ├── mutations.ts
│   │   │   └── queries.ts
│   │   ├── notices/
│   │   │   ├── components/
│   │   │   │   ├── index.ts
│   │   │   │   ├── language-form.tsx
│   │   │   │   ├── notice-copy-form.tsx
│   │   │   │   ├── notice-form.tsx
│   │   │   │   ├── notice-import.tsx
│   │   │   │   ├── notice-purposes-form.tsx
│   │   │   │   ├── notice-text.tsx
│   │   │   │   └── rule3-override.tsx
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   ├── mutations.ts
│   │   │   ├── queries.ts
│   │   │   └── schemas.ts
│   │   ├── notifications/
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   └── queries.ts
│   │   ├── projects/
│   │   │   ├── components/
│   │   │   │   ├── agent-form.tsx
│   │   │   │   ├── approval-form.test.tsx
│   │   │   │   ├── approval-form.tsx
│   │   │   │   ├── index.ts
│   │   │   │   ├── project-form.tsx
│   │   │   │   ├── project-processors.tsx
│   │   │   │   ├── site-dco.tsx
│   │   │   │   ├── site-form.tsx
│   │   │   │   ├── site-owner.tsx
│   │   │   │   └── transition-controls.tsx
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   ├── mutations.ts
│   │   │   ├── queries.test.tsx
│   │   │   ├── queries.ts
│   │   │   └── schemas.ts
│   │   ├── public-consent/
│   │   │   ├── components/
│   │   │   │   ├── done-step.tsx
│   │   │   │   ├── index.ts
│   │   │   │   ├── languages.ts
│   │   │   │   ├── notice-step.tsx
│   │   │   │   ├── purpose-choice.tsx
│   │   │   │   ├── register-step.tsx
│   │   │   │   ├── shell.tsx
│   │   │   │   ├── steps.tsx
│   │   │   │   └── verify-step.tsx
│   │   │   ├── api.ts
│   │   │   └── index.ts
│   │   ├── registry/
│   │   │   ├── components/
│   │   │   │   ├── forms.tsx
│   │   │   │   ├── purpose-form.tsx
│   │   │   │   └── source-owner.tsx
│   │   │   ├── api.ts
│   │   │   ├── index.ts
│   │   │   ├── mutations.ts
│   │   │   ├── queries.ts
│   │   │   └── schemas.ts
│   │   ├── rights/
│   │   │   ├── api.ts
│   │   │   └── index.ts
│   │   └── users/
│   │       ├── components/
│   │       │   └── forms.tsx
│   │       ├── api.ts
│   │       ├── index.ts
│   │       ├── mutations.ts
│   │       ├── queries.ts
│   │       └── schemas.ts
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts
│   │   │   └── index.ts
│   │   ├── config/
│   │   │   └── index.ts
│   │   ├── errors/
│   │   │   ├── api-error.test.ts
│   │   │   ├── api-error.ts
│   │   │   └── index.ts
│   │   ├── format/
│   │   │   ├── format.test.ts
│   │   │   └── index.ts
│   │   ├── permissions/
│   │   │   └── index.ts
│   │   ├── query/
│   │   │   ├── index.ts
│   │   │   ├── keys.ts
│   │   │   └── options.ts
│   │   └── security/
│   │       ├── index.ts
│   │       ├── sanitize.test.ts
│   │       ├── sanitize.ts
│   │       ├── session-timeout.ts
│   │       └── use-hydrated.ts
│   ├── providers/
│   │   ├── auth-provider.tsx
│   │   ├── index.tsx
│   │   ├── query-provider.tsx
│   │   ├── theme-provider.tsx
│   │   └── toast-provider.tsx
│   ├── schemas/
│   │   ├── contacts.ts
│   │   ├── files.ts
│   │   ├── index.ts
│   │   ├── primitives.ts
│   │   ├── schemas.test.ts
│   │   └── security.ts
│   ├── styles/
│   │   ├── base.css
│   │   ├── bridge.css
│   │   ├── print.css
│   │   ├── themes.css
│   │   ├── tokens.css
│   │   └── utilities.css
│   ├── test/
│   │   ├── fixtures.ts
│   │   ├── render.tsx
│   │   └── server.ts
│   ├── types/
│   │   ├── api-contract.test-d.ts
│   │   ├── api-schema.d.ts
│   │   ├── audit.ts
│   │   ├── consent.ts
│   │   ├── dashboard.ts
│   │   ├── enums.ts
│   │   ├── envelope.ts
│   │   ├── exchange.ts
│   │   ├── identity.ts
│   │   ├── index.ts
│   │   ├── meta.ts
│   │   ├── notices.ts
│   │   ├── primitives.ts
│   │   ├── projects.ts
│   │   ├── public.ts
│   │   └── registry.ts
│   └── proxy.ts
├── .dockerignore
├── .env.example
├── .env.local
├── .gitignore
├── .prettierignore
├── .prettierrc.json
├── AGENTS.md
├── CLAUDE.md
├── Dockerfile
├── eslint.config.mjs
├── next-env.d.ts
├── next.config.ts
├── package-lock.json
├── package.json
├── playwright.config.ts
├── postcss.config.mjs
├── README.md
├── tsconfig.json
├── tsconfig.tsbuildinfo
├── vitest.config.mts
└── vitest.setup.ts
```

---

**Generated from three sources**, and reproducible from them:

| Section | Read from |
|---|---|
| Endpoints and gates | the FastAPI application object — `app.routes`, walked through the included routers, taking each endpoint's `principal` annotation as the gate |
| Tables and columns | the PostgreSQL catalogue — `pg_tables` and `information_schema.columns` |
| File trees | the working tree, with generated and secret-bearing paths excluded |

Because the route table is read from the application object rather than from the
source, it cannot disagree with what the server actually serves. Row counts come
from the development database and are indicative only.
