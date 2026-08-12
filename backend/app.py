from fastapi import FastAPI

from backend.api.v1.cloudflare import router as cloudflare_router


app = FastAPI(
    title="CloudPilot Backend",
    version="0.1.0",
    description="CloudPilot local control-plane backend",
)

app.include_router(cloudflare_router)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "cloudpilot-backend",
        "version": "0.1.0",
    }
