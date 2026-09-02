# Backend structure — a module-oriented proposal

Measured against the fifteen architecture rules, with the current layout as the
starting point.

> **This is a proposal, not a description.** [`COMPASS-LLD.md`](COMPASS-LLD.md)
> describes what exists today. Nothing here has been applied.

---

## The short version

The backend is organised by **technical layer** today — `api/`, `domain/`,
`db/repositories/` — and each layer contains one file per business area. Rule 1
inverts that: the business area becomes the folder, and the layers become files
inside it.

That is a real change of direction, not a gap being filled. The current layering
is deliberate and documented across four files in `docs/architecture/`, and its
dependency graph is enforced. Any move should keep what that bought — a directed
import graph — while changing what it costs: reading one feature currently means
opening three folders.

**Two findings from measuring the code matter more than the folder shape**, and
they are set out in the next section, because they change what the target should
be.

---

## 1. What the code actually looks like

Lines of Python per business area, by the layer they currently live in:

| Area | api | domain | db | total | reads as |
|---|---:|---:|---:|---:|---|
| projects | 848 | 1176 | 1192 | **3216** | a module |
| notices | 725 | 1605 | 465 | **2795** | a module |
| exchange | 524 | 722 | 794 | **2040** | a module |
| consent | 239 | 605 | 673 | **1517** | a module |
| registry | 784 | **10** | 495 | **1289** | rules live in the router |
| audit | 131 | 316 | 274 | **721** | a module |
| users | 366 | **11** | 315 | **692** | rules live in the router |
| dashboard | 479 | 0 | 0 | **479** | a read model |
| delegations | 145 | 191 | 138 | **474** | a module |
| consents *(router)* | 428 | 0 | 0 | **428** | see naming, below |
| me | 325 | 0 | 0 | **325** | a read model |
| auth | 270 | 0 | 0 | **270** | belongs to identity |
| system | 266 | 0 | 0 | **266** | platform, not business |
| rights | 148 | 0 | 0 | **148** | belongs to identity |

### Finding 1 — two areas have almost no domain layer

`registry` has **784 lines of HTTP and 10 lines of domain**. `users` has 366 and
11. Their business rules are not in a domain module; they are inside the request
handlers, which is a standing breach of rules 3 and 5.

**Restructuring will not fix this — it will expose it.** Moving
`api/routers/v1/registry.py` into `modules/registry/api.py` produces a module
whose `domain/` is empty and whose `api.py` is 784 lines. That is worse than
today, because the shape now claims a separation that is not there.

So those two are not folder moves. They are *extractions*, and they should be
scheduled as such.

### Finding 2 — five areas are not modules at all

`dashboard`, `me`, `auth`, `rights` and `system` have no domain and no
repository. They are **read models and entry points that compose other modules**.
Giving each a `domain/`, `application/` and `infrastructure/` folder would create
eleven empty directories and directly violate rule 10.

### A naming split worth closing

The domain and repository call it `consent`; the router calls it `consents`. One
concept, two spellings, and a grep for either finds half the code.

---

## 2. The target structure

```
src/cmp/
│
├── core/                       # vocabulary. Imports nothing local. Unchanged.
│   ├── config.py  constants.py  context.py  enums.py
│   ├── errors.py  logging.py    pagination.py
│   ├── permissions.py           # the MATRIX — see rule 8
│   ├── result.py  security.py
│
├── platform/                   # technology with no business meaning
│   ├── db/                     # pool, transaction, sql helpers
│   ├── email/  sms/  storage/  external/
│   ├── telemetry/              # logging setup, metrics
│   └── validation/             # contacts, files, urls, strings…
│
├── modules/                    # ← one folder per business area
│   │
│   ├── projects/               # the full shape, because it earns it
│   │   ├── api.py              # HTTP only: routing, status, response model
│   │   ├── application.py      # use-case orchestration, transaction boundary
│   │   ├── domain/
│   │   │   ├── state_machine.py
│   │   │   ├── routing.py      # processor → source → owner
│   │   │   └── rules.py
│   │   ├── schemas.py          # request/response models
│   │   ├── repository.py       # SQL only. No decisions.
│   │   └── tests/
│   │       ├── test_state_machine.py
│   │       ├── test_routing.py
│   │       └── test_api.py
│   │
│   ├── notices/                # api · application · domain/ · schemas
│   │   ├── domain/             │   · repository · tests
│   │   │   ├── document.py     # parse an uploaded .docx
│   │   │   ├── importer.py     # decide what to write
│   │   │   └── publication.py  # checklist, freeze, hash
│   │   └── …
│   │
│   ├── consent/                # renamed from consent/consents split
│   ├── exchange/
│   ├── delegations/
│   ├── audit/
│   │
│   ├── registry/               # ← domain/ starts empty and is filled by
│   │   ├── api.py              #   extraction, not by a move. See finding 1.
│   │   ├── domain/
│   │   ├── repository.py
│   │   └── tests/
│   │
│   ├── identity/               # users + auth + sessions + rights + me
│   │   ├── api/
│   │   │   ├── auth.py         # sign in, MFA, password
│   │   │   ├── users.py        # administration
│   │   │   ├── me.py           # the signed-in user's own surface
│   │   │   └── rights.py       # the data principal's DPDP rights
│   │   ├── application.py
│   │   ├── domain/
│   │   │   ├── authentication.py
│   │   │   ├── authorization.py
│   │   │   └── sessions.py
│   │   ├── repository.py
│   │   └── tests/
│   │
│   └── reporting/              # read models. No domain, and no empty folder
│       ├── api.py              #   pretending there is one.
│       ├── queries.py          # cross-module SQL, read-only
│       └── tests/
│
├── tasks/                      # Celery. Thin — calls into modules.
│   ├── app.py  dispatch.py
│   └── maintenance/  notifications/  exchange/
│
├── bootstrap/                  # wiring. Imports every module; nothing imports it.
│   ├── application.py  container.py  dependencies.py
│   ├── lifespan.py     middleware.py  routers.py
│
└── shared/                     # only what more than one module genuinely needs
    └── audit.py                # the hash-chained write every module calls
```

### The single most important convention

**The module template is a maximum, not a minimum.** A module contains only the
parts it actually has:

| Module | api | application | domain/ | repository | why |
|---|:-:|:-:|:-:|:-:|---|
| projects | ✓ | ✓ | ✓ | ✓ | state machine, routing, ownership |
| notices | ✓ | ✓ | ✓ | ✓ | parsing, publication, Rule 3 |
| consent | ✓ | ✓ | ✓ | ✓ | grant, withdraw, artefact |
| exchange | ✓ | ✓ | ✓ | ✓ | import, export, retention |
| identity | ✓ | ✓ | ✓ | ✓ | authn, authz, sessions |
| audit | ✓ | — | ✓ | ✓ | chain invariants; no orchestration |
| delegations | ✓ | — | ✓ | ✓ | small enough that application.py would be a pass-through |
| registry | ✓ | ✓ | ✓ | ✓ | *after* extraction; see finding 1 |
| reporting | ✓ | — | — | ✓ | a read model has no invariants |

A pass-through `application.py` that only forwards to the repository is a folder
created for appearance. Rule 10 forbids it; so does rule 11.

---

## 3. Rule by rule

| # | Rule | How the structure meets it | Deviation |
|---|---|---|---|
| 1 | Organise by business module | `modules/<area>/` replaces the api/domain/db split | — |
| 2 | Modules own api, application, domain, schemas, infra, tests | Each module folder holds all six *that it has* | Tests: see rule 14 |
| 3 | API files contain HTTP concerns only | `api.py` does routing, status codes, response models; it may not touch SQL | `registry` and `users` breach this **today** and must be extracted |
| 4 | Application contains use-case orchestration | `application.py` owns the transaction boundary and calls domain then repository | Omitted where it would be a pass-through |
| 5 | Domain contains rules and invariants | `domain/` holds the state machine, routing, publication checklist. No SQL, no HTTP, no framework imports | — |
| 6 | Infrastructure is technology-specific | `platform/` for shared adapters; `repository.py` per module | — |
| 7 | Repositories make no business decisions | `repository.py` is SQL and mapping. **Row-scope predicates stay** — they are authorization compiled into `WHERE`, and moving them out means fetching rows the caller may not see | Argued below |
| 8 | Shared code must be genuinely shared | `shared/` holds only the audit write. `core/permissions.py` keeps the MATRIX because four repositories read it | — |
| 9 | No circular dependencies | Modules import `core`, `platform`, `shared` — never each other. Cross-module composition happens in `bootstrap` or `reporting` | — |
| 10 | No folders for appearance | The template is a maximum; `reporting` gets no `domain/` | — |
| 11 | Introduce complexity incrementally | Migration is per module, one at a time, each behind a green suite | See §5 |
| 12 | State transitions need explicit validation and authorization | `domain/state_machine.py` validates; the role gate authorizes at `api.py`; row scope authorizes in the predicate | — |
| 13 | Production mutations need audit | Every mutating use case calls `shared/audit.py`, which writes to the hash-chained log | — |
| 14 | Tests accompany new functionality | Module tests live in `modules/<area>/tests/` | **Cross-cutting suites stay central** — see below |
| 15 | A module is independently understandable | One folder holds the HTTP surface, the rules and the SQL for one area | — |

### Rule 7, argued

A repository that returns rows the caller is not entitled to, for the service to
filter afterwards, has moved an authorization decision into application code and
made every caller responsible for repeating it. One forgotten filter is a data
leak.

`scope_predicate(role, user_id)` returning a SQL fragment is therefore treated as
**infrastructure implementing an authorization rule defined in `core`**, not as a
business decision made in the repository. The rule lives in the MATRIX; the
repository only compiles it. Rule 7 holds.

### Rule 14, qualified

Rule 2 says modules own their tests. Most should move. But the security suite
does not assert about modules — it asserts about the things modules share.

`test_bfla.py` is 85 tests parametrised over every role in the permission matrix.
`test_bola.py` asserts the scope predicates directly against the repositories,
including the 404-not-403 rule. `test_matrix_integrity.py` parses the permission
table with `ast`, which is how a duplicate `Role.DCO_ADMIN` key that silently
dropped a write grant was caught.

None of those has a module to belong to. Their subject is `core/permissions.py`
and the predicates compiled from it, and splitting them across modules would
replace one statement about the whole matrix with eight partial ones. They stay
in `tests/security/`.

```
tests/                          # cross-cutting only
├── conftest.py                 # shared fixtures: db, redis, seeded world
├── security/                   # sweeps every endpoint — must stay whole
├── integration/                # multi-module journeys
└── contracts/                  # enum parity, migration reversibility
```

---

## 4. What not to do

**Do not create `modules/<area>/infrastructure/repository.py`.** A folder holding
one file adds a level of nesting and no information. `repository.py` at the
module root is the same thing, one line shorter to import.

**Do not move module-specific helpers into `shared/`** because two modules
happen to use them today. Rule 8. Duplicate first; extract on the third use, when
the shape is known.

**Do not let `reporting` grow rules.** It reads across modules, which is only
safe while it stays read-only. A write there would need invariants from modules
it does not own, and that is the first circular dependency.

**Do not migrate `registry` or `users` by moving files.** They need domain
extraction first, or the move produces an empty `domain/` next to an 800-line
`api.py` and encodes the breach into the structure.

---

## 5. Migration order

Rule 11: incrementally, one module at a time, each landing on a green suite.

| Step | Module | Why here | Risk |
|---|---|---|---|
| 1 | `delegations` | 474 lines, has all three layers already — proves the shape end to end at the smallest possible size | low |
| 2 | `audit` | Self-contained, heavily tested, no inbound business dependencies | low |
| 3 | `notices` | The best-formed large module (1605 domain lines); the payoff is visible immediately | medium |
| 4 | `consent` | Closes the `consent`/`consents` naming split at the same time | medium |
| 5 | `projects` | Largest, and the one others reference — do it once the pattern is settled | high |
| 6 | `exchange` | Depends on projects and consent being in place | medium |
| 7 | `identity` | A merge of four areas, not a move — needs its own design pass | high |
| 8 | `registry` | **Extraction, not migration.** Pull rules out of the 784-line router into `domain/` first, then move | high |

Steps 1 and 2 are worth doing on their own even if the rest is deferred: they
cost little and they answer whether the shape is right before anything expensive
depends on it.

---

## 6. Open decisions

**`application.py` or `application/`?** A single file until a module has more
than about three use cases, then a package. Deciding per module beats a blanket
rule, and rule 10 pushes against the package by default.

**Does `tasks/` stay separate or move into the modules?** A Celery task is an
entry point like an HTTP route, so `modules/exchange/tasks.py` is arguable. Kept
separate here because the Celery app registry wants one place to look, but this
is genuinely open.

**Where does `validation/` belong?** Placed under `platform/` above, as
technology-facing string, URL and file checks. If any of it encodes a business
rule — what a valid consent reference looks like, say — that part belongs to the
module that owns the concept, not to `platform`.

---

Measured from `src/cmp` on the current branch. Line counts are Python source
lines per area, summed across the layers each area is currently spread over.
