"""Adapters to everything outside this process.

Email, SMS, file storage and outbound HTTP. Each is a seam: a protocol the rest
of the system codes against, and one or more implementations chosen by
configuration.

The layering rule that keeps this useful — **nothing in here imports from
`domain`, `auth` or `api`.** Infrastructure is called by those layers; it does
not know they exist. An email transport that reaches back into a service is a
circular import today and an untestable module tomorrow.
"""
