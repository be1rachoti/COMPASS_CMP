# Sessions

Server-side, in Redis. Not a JWT, and the difference matters.

## Why not a token

A signed token cannot be revoked. "Sign out everywhere" becomes a promise the
system cannot keep, and a compromised session stays valid until it expires. A
session held server-side is gone on the next request.

The cost is a Redis lookup per request. That is the right trade for a system
whose job is to be able to say what happened.

## Two cookies, deliberately different

| Cookie | HttpOnly | Why |
|---|---|---|
| `cmp_session` | **yes** | Script cannot read it, so an XSS bug cannot exfiltrate it |
| `cmp_csrf` | **no** | The page must read it to set the header — that is the mechanism |

Both are `Secure` outside local development, and production refuses to start if
`COOKIE_SECURE` is false.

## SameSite and the first-party proxy

`SameSite=Lax`. A browser on `localhost:3000` talking to an API on
`127.0.0.1:8000` is a **cross-site** request as far as the cookie is concerned,
and the cookie is silently dropped.

The symptom is specific and misleading: `POST /auth/login` returns 200, and the
next `GET /auth/me` returns 401 with no cookie stored. It looks like a broken
login. The console proxies `/api/*` to the API through `next.config.ts` so the
cookie stays first-party.

## Lifetime

| Setting | Default | Job |
|---|---|---|
| `session_ttl_s` | 8 hours | Absolute. An abandoned browser is not signed in all day |
| `session_idle_timeout_s` | 30 minutes | Sliding. A session used once an hour does not live forever |

Both, because either alone leaves a gap.

## Partial sessions

Between password and second factor. Authorises exactly one route. Promoted on
successful MFA rather than replaced, so the session id is stable across the
step-up and an operator following the audit trail sees one session, not two.

## Revocation

`revoke_by_sid` for one, `revoke_all` for every session a user holds. The second
is what makes "sign out everywhere" real, and it is also what an admin uses when
an account is suspended.
