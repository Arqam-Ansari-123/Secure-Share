"""Local dev server.

Exists because of one Windows detail: psycopg's async mode refuses to run on the
ProactorEventLoop that Python selects by default on Windows, and the uvicorn CLI
passes its own loop_factory to asyncio.run(), so an event-loop policy set at
import time is ignored. Driving uvicorn's Server.serve() ourselves lets us choose
the loop.

    python run_dev.py            # http://127.0.0.1:8000

No auto-reload here (that needs uvicorn's supervisor, which would spawn a fresh
process with the default loop again) — restart after editing. In Docker the
normal `uvicorn main:app` command is used and none of this applies.
"""

import asyncio
import selectors
import sys

import uvicorn

from main import app


def main() -> None:
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=8000, access_log=False, log_config=None)
    )
    if sys.platform == "win32":
        asyncio.run(
            server.serve(),
            loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()),
        )
    else:
        asyncio.run(server.serve())


if __name__ == "__main__":
    main()
