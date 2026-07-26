import json
import csv
import uuid
import base64
from io import BytesIO, StringIO
from pathlib import Path
from datetime import datetime

from jinja2 import Environment, FileSystemLoader

from .models import ReportFormat, GenerateReportRequest, ReportMeta, ReportSections
from .collector import collect_all
from .charts import (
    generate_cpu_ram_gauge,
    generate_disk_chart,
    generate_network_io_chart,
    generate_process_chart,
)

REPORTS_DIR = Path.home() / ".config" / "Johnny CyberSuite X" / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
TEMPLATES_DIR = Path(__file__).parent / "templates"


async def generate_report(request: GenerateReportRequest) -> ReportMeta:
    data = await collect_all(request.sections)
    report_id = str(uuid.uuid4())[:8]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"report_{timestamp}_{report_id}"

    charts = {}
    if request.include_charts and request.format in (ReportFormat.PDF, ReportFormat.HTML):
        if "performance_stats" in data:
            charts["cpu_ram"] = generate_cpu_ram_gauge(
                data["performance_stats"]["cpu_percent"],
                data["performance_stats"]["ram_percent"],
            )
        if "disk_usage" in data and data["disk_usage"]:
            charts["disk"] = generate_disk_chart(data["disk_usage"])
        if "network_info" in data and data["network_info"].get("interfaces"):
            charts["network_io"] = generate_network_io_chart(
                data["network_info"]["interfaces"]
            )
        if "top_processes" in data and data["top_processes"]:
            charts["processes"] = generate_process_chart(data["top_processes"])

    if request.format == ReportFormat.PDF:
        filepath = _render_pdf(filename, request.title, data, charts)
    elif request.format == ReportFormat.HTML:
        filepath = _render_html(filename, request.title, data, charts)
    elif request.format == ReportFormat.JSON:
        filepath = _render_json(filename, data)
    else:
        filepath = _render_csv(filename, data)

    file_size = filepath.stat().st_size
    sections_included = [k for k in data if k not in ("generated_at", "hostname")]

    meta = ReportMeta(
        id=report_id,
        title=request.title,
        format=request.format.value,
        created_at=data["generated_at"],
        file_size=file_size,
        sections=sections_included,
        filename=filepath.name,
    )
    meta_path = REPORTS_DIR / f"{filename}.meta.json"
    meta_path.write_text(meta.model_dump_json(), encoding="utf-8")
    return meta


def _render_html(filename: str, title: str, data: dict, charts: dict) -> Path:
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))
    template = env.get_template("report.html.j2")

    charts_b64 = {}
    for key, png_bytes in charts.items():
        if png_bytes:
            charts_b64[key] = base64.b64encode(png_bytes).decode()

    html_content = template.render(
        title=title,
        generated_at=data.get("generated_at", ""),
        hostname=data.get("hostname", ""),
        system_info=data.get("system_info"),
        performance_stats=data.get("performance_stats"),
        network_info=data.get("network_info"),
        disk_usage=data.get("disk_usage"),
        top_processes=data.get("top_processes"),
        active_connections=data.get("active_connections"),
        charts=charts_b64,
    )
    filepath = REPORTS_DIR / f"{filename}.html"
    filepath.write_text(html_content, encoding="utf-8")
    return filepath


def _render_json(filename: str, data: dict) -> Path:
    filepath = REPORTS_DIR / f"{filename}.json"
    filepath.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    return filepath


def _render_csv(filename: str, data: dict) -> Path:
    filepath = REPORTS_DIR / f"{filename}.csv"
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)

        if "system_info" in data:
            writer.writerow(["=== SYSTEM INFORMATION ==="])
            writer.writerow(["Field", "Value"])
            for k, v in data["system_info"].items():
                writer.writerow([k, v])
            writer.writerow([])

        if "performance_stats" in data:
            writer.writerow(["=== PERFORMANCE STATISTICS ==="])
            writer.writerow(["Metric", "Value"])
            for k, v in data["performance_stats"].items():
                writer.writerow([k, v])
            writer.writerow([])

        if "network_info" in data:
            writer.writerow(["=== NETWORK INFORMATION ==="])
            writer.writerow(["Field", "Value"])
            writer.writerow(["gateway", data["network_info"].get("gateway")])
            writer.writerow(["public_ip", data["network_info"].get("public_ip")])
            writer.writerow(["dns_servers", ", ".join(data["network_info"].get("dns_servers", []))])
            writer.writerow([])
            if data["network_info"].get("interfaces"):
                writer.writerow(["Interface", "IP", "MAC", "Status", "Speed", "Sent MB", "Recv MB"])
                for i in data["network_info"]["interfaces"]:
                    writer.writerow([i["name"], i["ip"], i["mac"], i["status"],
                                     i["speed"], i["sent_mb"], i["recv_mb"]])
            writer.writerow([])

        if "disk_usage" in data:
            writer.writerow(["=== DISK USAGE ==="])
            writer.writerow(["Device", "Mount", "Type", "Total GB", "Used GB", "Free GB", "Percent"])
            for d in data["disk_usage"]:
                writer.writerow([d["device"], d["mount"], d["fstype"],
                                 d["total_gb"], d["used_gb"], d["free_gb"], d["percent"]])
            writer.writerow([])

        if "top_processes" in data:
            writer.writerow(["=== TOP PROCESSES ==="])
            writer.writerow(["PID", "Name", "CPU %", "Memory %", "Status"])
            for p in data["top_processes"]:
                writer.writerow([p["pid"], p["name"], p["cpu_percent"],
                                 p["memory_percent"], p["status"]])
            writer.writerow([])

        if "active_connections" in data:
            writer.writerow(["=== ACTIVE CONNECTIONS ==="])
            writer.writerow(["Proto", "Local", "Remote", "Status", "Process"])
            for c in data["active_connections"]:
                writer.writerow([c["proto"], c["local"], c["remote"],
                                 c["status"], c["process"]])

    return filepath


def _render_pdf(filename: str, title: str, data: dict, charts: dict) -> Path:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import inch, cm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
        PageBreak,
    )

    filepath = REPORTS_DIR / f"{filename}.pdf"
    doc = SimpleDocTemplate(
        str(filepath), pagesize=A4,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=2 * cm, bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="CyberTitle", fontSize=22, textColor=colors.HexColor("#00f0ff"),
        fontName="Helvetica-Bold", spaceAfter=8, alignment=1,
    ))
    styles.add(ParagraphStyle(
        name="CyberSubtitle", fontSize=10, textColor=colors.HexColor("#888888"),
        fontName="Helvetica", spaceAfter=20, alignment=1, spaceBefore=4,
    ))
    styles.add(ParagraphStyle(
        name="SectionHead", fontSize=13, textColor=colors.HexColor("#00f0ff"),
        fontName="Helvetica-Bold", spaceBefore=20, spaceAfter=10,
    ))

    elements = []

    # Cover
    elements.append(Spacer(1, 2 * inch))
    elements.append(Paragraph(title, styles["CyberTitle"]))
    elements.append(Paragraph("CYBERSUITE X — SYSTEM REPORT", styles["CyberSubtitle"]))
    elements.append(Paragraph(
        f"Generated: {data.get('generated_at', '')} | Host: {data.get('hostname', '')}",
        styles["CyberSubtitle"],
    ))
    elements.append(PageBreak())

    dark_bg = colors.HexColor("#1a1a1a")
    header_bg = colors.HexColor("#111111")
    accent = colors.HexColor("#00f0ff")
    text_color = colors.HexColor("#cccccc")
    border_color = colors.HexColor("#333333")

    def make_table(headers, rows):
        table_data = [headers] + rows
        t = Table(table_data, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), header_bg),
            ("TEXTCOLOR", (0, 0), (-1, 0), accent),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("TEXTCOLOR", (0, 1), (-1, -1), text_color),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, border_color),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [dark_bg, colors.HexColor("#0d0d0d")]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        return t

    def add_chart(chart_key):
        if chart_key in charts and charts[chart_key]:
            img_buf = BytesIO(charts[chart_key])
            img = Image(img_buf, width=5.5 * inch, height=2.5 * inch)
            elements.append(Spacer(1, 12))
            elements.append(img)

    # System Info
    if "system_info" in data:
        elements.append(Paragraph("SYSTEM INFORMATION", styles["SectionHead"]))
        si = data["system_info"]
        rows = [[k.replace("_", " ").title(), str(v)] for k, v in si.items()]
        elements.append(make_table(["Property", "Value"], rows))

    # Performance
    if "performance_stats" in data:
        elements.append(Paragraph("PERFORMANCE STATISTICS", styles["SectionHead"]))
        ps = data["performance_stats"]
        rows = [[k.replace("_", " ").title(), str(v)] for k, v in ps.items()]
        elements.append(make_table(["Metric", "Value"], rows))
        add_chart("cpu_ram")

    # Network
    if "network_info" in data:
        elements.append(Paragraph("NETWORK INFORMATION", styles["SectionHead"]))
        ni = data["network_info"]
        rows = [
            ["Gateway", ni.get("gateway", "N/A")],
            ["Public IP", ni.get("public_ip", "N/A")],
            ["DNS Servers", ", ".join(ni.get("dns_servers", []))],
        ]
        elements.append(make_table(["Property", "Value"], rows))
        if ni.get("interfaces"):
            elements.append(Spacer(1, 10))
            iface_rows = [
                [i["name"], i["ip"], i["status"], str(i["speed"]),
                 str(i["sent_mb"]), str(i["recv_mb"])]
                for i in ni["interfaces"]
            ]
            elements.append(make_table(
                ["Interface", "IP", "Status", "Speed (Mbps)", "Sent (MB)", "Recv (MB)"],
                iface_rows,
            ))
        add_chart("network_io")

    # Disk
    if "disk_usage" in data:
        elements.append(Paragraph("DISK USAGE", styles["SectionHead"]))
        disk_rows = [
            [d["device"], d["mount"], d["fstype"],
             f'{d["total_gb"]}', f'{d["used_gb"]}', f'{d["percent"]}%']
            for d in data["disk_usage"]
        ]
        elements.append(make_table(
            ["Device", "Mount", "Type", "Total (GB)", "Used (GB)", "Usage"],
            disk_rows,
        ))
        add_chart("disk")

    # Processes
    if "top_processes" in data:
        elements.append(Paragraph("TOP PROCESSES", styles["SectionHead"]))
        proc_rows = [
            [str(p["pid"]), p["name"], f'{p["cpu_percent"]}%',
             f'{p["memory_percent"]}%', p["status"]]
            for p in data["top_processes"]
        ]
        elements.append(make_table(
            ["PID", "Name", "CPU %", "Memory %", "Status"],
            proc_rows,
        ))
        add_chart("processes")

    # Connections
    if "active_connections" in data:
        elements.append(Paragraph("ACTIVE CONNECTIONS", styles["SectionHead"]))
        conn_rows = [
            [c["proto"], c["local"], c["remote"], c["status"], c["process"]]
            for c in data["active_connections"]
        ]
        elements.append(make_table(
            ["Proto", "Local", "Remote", "Status", "Process"],
            conn_rows,
        ))

    doc.build(elements)
    return filepath
