# Dependency rules

The import graph, and how to keep it acyclic.

## Direction

```
bootstrap
    ↓
   api  ──────────────┐
    ↓                 │
   auth               │
    ↓                 │
  domain              │
    ↓                 ↓
    db          infrastructure
    ↓                 ↓
        core (imports nothing local)
```

Everything may import `core`. Nothing may be imported by `core`.

## The three rules that are easy to break

### 1. `core` imports nothing from this codebase

If it did, the module that half the tree depends on would drag its dependency in
behind it, and the graph would lose its direction.

This is why `MATRIX` lives in `core/permissions.py` rather than in
`auth/authorization/`. Four repositories read a scope out of it to build their
predicates; moving it up would make `db` import from a layer above it. `core`
holds the vocabulary and the table — static data with no behaviour — and `auth`
holds everything you *do* with it: evaluating with a reason, raising, logging the
denial, feeding the audit trail.

### 2. `infrastructure` does not import `domain` or `auth`

Adapters are called by those layers; they do not call back.

### 3. A private name does not cross a module boundary

`_helper` in one module imported by another is a lie about the contract. When a
helper is shared, it loses the underscore — see `safe_path`, `clean_request_id`
and `client_ip`, which were private to the old single-file middleware and became
public when it was split.

## Local imports, and when they are legitimate

A function-level import is usually a smell. There are two cases where it is
correct here:

* **A genuine cycle at module scope that is not one at call time.** The project
  service imports the notice service inside `transition()`, because publication
  is a side effect of one transition and the notice service imports the project
  repository.
* **An optional dependency.** `_install_metrics` imports the Prometheus
  instrumentator inside a `try`, because an exporter that fails to import must
  not stop the API from serving.

Anything else at function scope is deferring a problem rather than solving it.

## How this is enforced

By review, and by the structure making a violation obvious. Two mechanical
checks catch the cases that matter most:

* `auth/authorization/permissions.py` asserts at import that the resource roster
  and the matrix agree in both directions.
* `api/errors/mapping.py` asserts at import that every domain exception declares
  a status and a code.

Both fail the process at startup rather than producing a silent 403 or a 500
that reads as an outage.
