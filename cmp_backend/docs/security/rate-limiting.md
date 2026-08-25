# Rate limiting

Three surfaces, three reasons.

| Surface | Bound | Keyed on | Why |
|---|---|---|---|
| Sign-in | 5 attempts / 30 min, 30 min lockout | **account** | An attacker rotates addresses; a NAT'd office should not be locked out by one typo |
| OTP verify | 5 attempts per code | code | The cap is what makes six digits strong enough |
| OTP request | 5 / hour per contact, 20 / hour per link | contact | Otherwise the form is an SMS pump aimed at someone else's number |
| Public link | 60 / minute | address | Unauthenticated, and there is no account to key on |

## Why Redis and not memory

A counter in process memory is not a rate limit when there are four workers — it
is a limit four times looser than it claims, and nobody notices until the fifth
worker is added.

The same applies to lockout: an attacker who can reach any worker gets five
attempts *per worker*.

## Locks

`ratelimit.lock` provides a distributed lock for the operations that must not run
twice concurrently — publishing a notice, generating an export. Redis-backed for
the same reason.

## What a client sees

429 with `Retry-After`. The header is exposed through CORS, so a browser client
can actually read it and back off rather than hammering.
