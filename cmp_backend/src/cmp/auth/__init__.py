"""Authentication and authorisation.

The layer between the HTTP edge and the domain. It answers three questions, in
this order, and keeping them apart is what makes each one reviewable:

1. **Who is this?** — `identity` and `authentication`. A session cookie resolves
   to a `Principal`, or the request is 401.
2. **May they do this?** — `authorization`. The permission matrix decides, the
   denial is logged, and the reason reaches the audit trail.
3. **How often may they try?** — `rate_limit`. Bounded attempts, account
   lockout, and the locks that keep both correct across processes.

Nothing here imports from `domain` or `api`. The domain calls *into* this layer
for the current principal; it is never called back.
"""
