"""
CloudPilot — backend process entry point.

Used by the PyInstaller build (and usable directly) to run the FastAPI
application programmatically. Host/port are read from the centralized
settings (env-overridable) so the Electron shell and the backend always
agree.
"""

import uvicorn

from backend.app import app
from backend.settings import backend_host, backend_port, setup_logging


def main() -> None:
    setup_logging()
    uvicorn.run(
        app,
        host=backend_host(),
        port=backend_port(),
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()