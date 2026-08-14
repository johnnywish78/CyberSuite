import time

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.api.v1.bpb import router as bpb_router
from backend.api.v1.cloudflare import router as cloudflare_router
from backend.api.v1.network import router as network_router
from backend.api.v1.railway import router as railway_router
from backend.settings import (
    cors_origins,
    service_version,
)


STARTED_AT = time.time()


app = FastAPI(
    title="CloudPilot Backend",
    version=service_version(),
    description="CloudPilot local control-plane backend",
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
        "uptime_seconds": uptime,
        "started_at": time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime(STARTED_AT)
        ),
    }
