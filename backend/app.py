import logging
import os
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.api.v1.bpb import router as bpb_router
from backend.api.v1.cloudflare import router as cloudflare_router
from backend.api.v1.network import router as network_router
from backend.api.v1.railway import router as railway_router
from backend.settings import (
    backend_host,
    backend_port,
    cors_origins,
    data_dir,
    service_version,
    setup_logging,
)

logger = logging.getLogger("cloudpilot.backend")

STARTED_AT = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Backend startup/shutdown lifecycle.

    Startup prepares the writable data directory and configures
    logging. Uptime is derived from the real process start time and is
    never fabricated.
    """
    setup_logging()
    data_dir().mkdir(parents=True, exist_ok=True)
    logger.info("CloudPilot backend starting (pid=%s)", os.getpid())
    logger.info(
        "version=%s host=%s port=%s",
        service_version(),
        backend_host(),
        backend_port(),
    )

    yield

    logger.info("CloudPilot backend shutting down")


app = FastAPI(
    title="CloudPilot Backend",
    version=service_version(),
    description="CloudPilot local control-plane backend",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cloudflare_router)
app.include_router(bpb_router)
app.include_router(network_router)
app.include_router(railway_router)


@app.get("/api/health")
async def health():
    uptime = int(time.time() - STARTED_AT)

    return {
        "status": "ok",
        "service": "cloudpilot-backend",
        "version": service_version(),
        "pid": os.getpid(),
        "uptime_seconds": uptime,
        "started_at": time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime(STARTED_AT)
        ),
    }
