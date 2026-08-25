"""Rules that belong to more than one aggregate.

Kept small on purpose. A `shared` package is where cohesion goes to die if
anything is allowed in - the test for admission is that a rule is genuinely used
by two or more aggregates and would otherwise be copy-pasted between them, not
that somebody could not decide where it went.
"""
