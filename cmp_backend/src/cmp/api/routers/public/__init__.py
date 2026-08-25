"""Unauthenticated routes.

Everything here is reachable without a session, which makes it the surface an
attacker reaches first. Three properties hold across both modules:

* **Rate limited per address.** The consent link resolves 60 times a minute and
  a code can be requested five times an hour per contact. Without that, the
  token space is walkable and the SMS bill is somebody else's problem.
* **No individual is revealed.** An invalid link says only that it is invalid —
  never whether it expired, was revoked, or never existed, because
  distinguishing those tells a token-guesser which guesses were structurally
  valid.
* **Capability tokens never reach a log.** The access-log middleware scrubs
  `/c/{token}` to `/c/[token]`, because a link in a log file is a credential in
  a file that gets shipped to an aggregator.

Registered *before* the authenticated routers, so `/c/{token}` can never be
shadowed by another router's path parameter.
"""

from cmp.api.routers.public.consent import router as consent_router
from cmp.api.routers.public.rights import router as rights_router

__all__ = ["consent_router", "rights_router"]
