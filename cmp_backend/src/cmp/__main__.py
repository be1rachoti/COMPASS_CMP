"""Development entrypoint: `uv run python -m cmp`.

Exists because of one platform detail that would otherwise make the API
Linux-only in development.

psycopg's async mode cannot run on Windows' `ProactorEventLoop`; it needs a
`SelectorEventLoop`. Setting the event loop *policy* used to be enough, but
uvicorn 0.36+ creates its loop through a `loop_factory`, and a factory bypasses
the policy completely - which is why the policy-based fix looks correct, runs,
and changes nothing.

So on Windows this module drives uvicorn's `Server.serve()` inside a loop it
creates itself, and the factory is ours. Elsewhere it is a plain `uvicorn.run`.

Production does not use this: it runs gunicorn with uvicorn workers (see the
Dockerfile), where `--reload` is absent and the worker count is explicit.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from cmp.core.config import settings

IS_WINDOWS = sys.platform == "win32"


def main() -> None:
    parser = argparse.ArgumentParser(prog="cmp", description="Run the CMP API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--reload", action="store_true",
        help="Auto-reload on change. Never use this in production.",
    )
    args = parser.parse_args()

    if args.reload and settings.is_production:
        sys.exit("--reload must not be used in production.")

    import uvicorn

    config = uvicorn.Config(
        "cmp.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        # Our own structured access log comes from AccessLogMiddleware; uvicorn's
        # would be a second one in a different format.
        access_log=False,
        log_config=None,
        loop="asyncio",
    )

    if not IS_WINDOWS:
        uvicorn.Server(config).run()
        return

    if args.reload:
        # The reloader spawns a subprocess and controls its loop; we cannot hand
        # it a factory. Say so rather than starting something that will fail at
        # the first query.
        sys.exit(
            "--reload cannot be combined with the Windows selector loop.\n"
            "Run without --reload, or develop against the container:\n"
            "    docker compose up api"
        )

    asyncio.run(
        uvicorn.Server(config).serve(),
        loop_factory=asyncio.SelectorEventLoop,
    )


if __name__ == "__main__":
    main()
