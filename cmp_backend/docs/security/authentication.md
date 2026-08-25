# Authentication

Two populations, two mechanisms, and the difference is deliberate.

## Staff

Password sign-in, Argon2id. The privileged roles — DPO and admin — step up with a
second factor.

A **partial session** exists between password verification and MFA. It authorises
exactly one route, the verify endpoint; every other endpoint answers 401 with
`mfa_required` until it is promoted. It is a distinct dependency type
(`PartialUser`) rather than a flag on the full one, because a flag is one missed
`if` away from an MFA bypass.

## Data subjects

**No password at all.** `password_hash` is nullable for exactly this reason. A
data subject signs in with a one-time code sent to the contact they registered
with.

The reasoning: a data subject who could set a password would have an account
worth phishing, and would reuse a password they use elsewhere. One who receives a
code per sign-in has nothing worth stealing between sessions.

## Passwords

| Property | Value | Why |
|---|---|---|
| Algorithm | Argon2id | Memory-hard; a GPU farm is a poor investment against it |
| Minimum length | 12 | Length beats composition rules — people remember a passphrase and write down `P@ss1!` |
| Maximum length | 128 | Argon2 is deliberately expensive; unbounded input is unbounded work per request |
| Salt | per hash | Identical passwords must not be visibly identical in the table |
| Rehash | on sign-in | Cost parameters rise; existing hashes upgrade on next successful use |

`verify_password` returns `False` on a malformed hash rather than raising. A
corrupted row should be a failed sign-in, not a 500 with the hash in the
traceback.

## One-time codes

Six digits, ten minutes, five verify attempts, five requests per contact per
hour. The attempt cap is what makes six digits strong enough: unbounded, a
million guesses is minutes of scripted work.

Stored as a **keyed hash, scoped to their purpose** — never in plaintext, and a
code issued for staff MFA cannot be replayed against the consent flow. Whoever
can read Redis should not thereby be able to complete somebody else's sign-in.

## Lockout

Five failures in thirty minutes locks the account for thirty minutes.

Keyed on the **account, not the address**. An attacker rotates addresses; a
legitimate user behind a corporate NAT should not be locked out because a
colleague mistyped their password.

## What is never logged

The code, the password, the session token, the consent link token. What *is*
logged is that a delivery happened and an obscured recipient — enough to answer
"did it go out", not enough to be a contact list.
