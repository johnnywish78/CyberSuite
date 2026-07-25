from pydantic import BaseModel
from enum import Enum


class ReportFormat(str, Enum):
    PDF = "pdf"
    HTML = "html"
    JSON = "json"
    CSV = "csv"


class ReportSections(BaseModel):
    system_info: bool = True
    network_info: bool = True
    performance_stats: bool = True
    active_connections: bool = True
    top_processes: bool = True
    disk_usage: bool = True


class GenerateReportRequest(BaseModel):
    format: ReportFormat = ReportFormat.PDF
    sections: ReportSections = ReportSections()
    title: str = "CyberSuite X System Report"
    include_charts: bool = True


class ReportMeta(BaseModel):
    id: str
    title: str
    format: str
    created_at: str
    file_size: int
    sections: list[str]
    filename: str = ""          # on-disk stem incl. extension, e.g. report_20260722_..._ab12.pdf
