"""Account provisioning and person type.

Thin by design: most of what could live here is authentication, which belongs to
`cmp.auth`, or the permission matrix, which belongs to `core`. What is left is
the lifecycle of the account row itself.

The distinction this package exists to keep visible: **role is authorisation,
person type is identity.** Changing somebody from employee to ex-employee records
a `person_type_history` row and changes nothing about what they may do. Revoking
access is a separate, deliberate act.
"""
