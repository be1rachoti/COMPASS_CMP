"""Outbound HTTP, for anything that is not email or SMS.

There is no such caller today. The module exists because the first one will
arrive under time pressure, and the difference between a good outbound client
and a bad one is decided in the ten minutes somebody spends adding it.

Three rules, and they are not negotiable:

* **An explicit timeout, always.** `httpx` defaults to none. A hung request
  holds a worker until the process is restarted, and it will happen at the worst
  time.
* **Bounded retries with jitter.** Without jitter, an upstream recovering from
  an outage is immediately hit by every client retrying in lockstep, and goes
  down again.
* **No credential in a log line.** Not in the URL, not in the exception text.
"""

from __future__ import annotations

from typing import Any

import httpx

from cmp.core.config import settings
from cmp.core.errors import UpstreamError
from cmp.core.logging import get_logger

log = get_logger("cmp.infrastructure.external")


def build_client(*, base_url: str = "", headers: dict[str, str] | None = None) -> httpx.Client:
    """A client with the timeout already set.

    Constructed here rather than at each call site so nobody has to remember
    the timeout — the only way to get a client without one is to not use this
    function, which is visible in review.
    """
    return httpx.Client(
        base_url=base_url,
        headers=headers or {},
        timeout=httpx.Timeout(settings.external_http_timeout_s),
        follow_redirects=False,  # a redirect to an internal host is an SSRF
    )


def request_json(client: httpx.Client, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
    """One request, with the upstream's failure translated into ours.

    An upstream 500 is not our 500: `UpstreamError` carries a distinct code so
    an operator reading the logs can tell "we broke" from "they broke".
    """
    try:
        response = client.request(method, url, **kwargs)
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        log.warning("upstream.timeout", url=url, method=method)
        raise UpstreamError(f"{method} {url} timed out") from exc
    except httpx.HTTPStatusError as exc:
        log.warning("upstream.status", url=url, method=method, status=exc.response.status_code)
        raise UpstreamError(f"{method} {url} returned {exc.response.status_code}") from exc
    except httpx.HTTPError as exc:
        log.warning("upstream.error", url=url, method=method, error=type(exc).__name__)
        raise UpstreamError(f"{method} {url} failed") from exc

    result: dict[str, Any] = response.json()
    return result
