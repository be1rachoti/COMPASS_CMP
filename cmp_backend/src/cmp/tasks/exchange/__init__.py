"""Background export and import work.

**Currently empty, and deliberately so.** Both operations run inline today:

* An **export** must be transactional with the `export_line` rows it writes — the
  disclosure record and the file have to agree, and a background job that wrote
  one without the other would leave a file in circulation with no record of who
  is in it.
* An **import** is validated and applied in one transaction so a manifest either
  lands or does not. Splitting it across a queue would make `partial` mean two
  different things.

The `documents` queue and the `cmp.exports.*` / `cmp.imports.*` routes are
already declared in `tasks.app`, so moving either here when the volumes justify
it is a decorator and a dispatch call, not a plumbing exercise.

The rule that would have to hold if that happens: the job may **generate** the
artefact in the background, but the row that records the disclosure is written in
the request that asked for it. What is recorded must never lag what left.
"""
