"""
Reports Center — FastAPI router (prefix /api/reports).

Generate rich system reports (PDF / HTML / JSON / CSV) with matplotlib charts,
list previously generated reports, download and delete them.

Backend engine lives in:
  - collector.py  — gathers system / network / performance / disk / process data
  - charts.py     — matplotlib PNG charts (cyber theme)
  - generator.py  — renders PDF (reportlab) / HTML (jinja2) / JSON / CSV
"""
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .models import GenerateReportRequest, ReportMeta
from .generator import generate_report, REPORTS_DIR

router = APIRouter(prefix="/api/reports", tags=["reports"])

_MEDIA = {
    "pdf": "application/pdf",
    "html": "text/html",
    "json": "application/json",
    "csv": "text/csv",
}


def _safe_report_path(filename: str) -> Path:
    """Resolve a report filename to a path inside REPORTS_DIR (blocks traversal)."""
    name = Path(filename).name              # strip any directory component
    if name != filename or not name:
        raise HTTPException(status_code=400, detail="invalid filename")
    path = (REPORTS_DIR / name).resolve()
    if REPORTS_DIR.resolve() not in path.parents:
        raise HTTPException(status_code=400, detail="invalid path")
    return path


@router.post("/generate", response_model=ReportMeta)
async def create_report(req: GenerateReportRequest):
    """Collect data + render a report in the requested format. Returns its metadata."""
    try:
        return await generate_report(req)
    except ModuleNotFoundError as e:
        raise HTTPException(
            status_code=501,
            detail=f"missing dependency for this format: {e.name}. "
                   f"Run: pip install -r backend/requirements.txt",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"report generation failed: {e}")


@router.get("", response_model=list[ReportMeta])
@router.get("/", response_model=list[ReportMeta])
def list_reports():
    """List all generated reports, newest first."""
    out: list[ReportMeta] = []
    for meta_file in REPORTS_DIR.glob("*.meta.json"):
        try:
            data = json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        # backfill filename for older metas that predate the field
        if not data.get("filename"):
            stem = meta_file.name[: -len(".meta.json")]
            data["filename"] = f"{stem}.{data.get('format', 'json')}"
        # skip metas whose data file is gone
        if not (REPORTS_DIR / data["filename"]).exists():
            continue
        try:
            out.append(ReportMeta(**data))
        except Exception:
            continue
    out.sort(key=lambda m: m.created_at, reverse=True)
    return out


@router.get("/{filename}/download")
def download_report(filename: str):
    """Download a report as an attachment."""
    path = _safe_report_path(filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="report not found")
    ext = path.suffix.lstrip(".").lower()
    return FileResponse(
        path,
        media_type=_MEDIA.get(ext, "application/octet-stream"),
        filename=path.name,
    )


@router.get("/{filename}/view")
def view_report(filename: str):
    """View a report inline (used for HTML preview in the app)."""
    path = _safe_report_path(filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="report not found")
    ext = path.suffix.lstrip(".").lower()
    return FileResponse(path, media_type=_MEDIA.get(ext, "text/plain"))


@router.delete("/{filename}")
def delete_report(filename: str):
    """Delete a report and its metadata sidecar."""
    path = _safe_report_path(filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="report not found")
    stem = path.name[: -(len(path.suffix))] if path.suffix else path.name
    meta = REPORTS_DIR / f"{stem}.meta.json"
    path.unlink(missing_ok=True)
    meta.unlink(missing_ok=True)
    return {"ok": True, "deleted": path.name}
