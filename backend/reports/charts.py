import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from io import BytesIO

COLORS = {
    "cyan": "#00f0ff",
    "purple": "#a855f7",
    "green": "#00ff88",
    "red": "#ff3366",
    "yellow": "#ffb703",
    "blue": "#3b82f6",
    "bg": "#0d0d0d",
    "panel": "#1a1a1a",
    "grid": "#2a2a2a",
    "text": "#cccccc",
}


def _apply_theme():
    plt.rcParams.update({
        "figure.facecolor": COLORS["bg"],
        "axes.facecolor": COLORS["panel"],
        "axes.edgecolor": "#333333",
        "axes.labelcolor": COLORS["text"],
        "xtick.color": COLORS["text"],
        "ytick.color": COLORS["text"],
        "text.color": COLORS["text"],
        "grid.color": COLORS["grid"],
        "grid.alpha": 0.3,
        "font.family": "monospace",
        "font.size": 10,
    })


def generate_cpu_ram_gauge(cpu: float, ram: float) -> bytes:
    _apply_theme()
    fig, ax = plt.subplots(figsize=(6, 3))
    bars = ax.barh(
        ["RAM", "CPU"],
        [ram, cpu],
        color=[COLORS["purple"], COLORS["cyan"]],
        edgecolor="none",
        height=0.5,
    )
    ax.set_xlim(0, 100)
    ax.set_xlabel("Usage %")
    ax.set_title("CPU & RAM Usage", fontsize=12, fontweight="bold", color=COLORS["cyan"])
    ax.grid(axis="x", linestyle="--")
    for bar, val in zip(bars, [ram, cpu]):
        ax.text(bar.get_width() + 1, bar.get_y() + bar.get_height() / 2,
                f"{val:.1f}%", va="center", fontsize=11, color=COLORS["text"])
    plt.tight_layout()
    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def generate_disk_chart(disks: list[dict]) -> bytes:
    _apply_theme()
    if not disks:
        return b""
    mounts = [d["mount"] for d in disks]
    percents = [d["percent"] for d in disks]
    colors = [COLORS["green"] if p < 70 else COLORS["yellow"] if p < 90
              else COLORS["red"] for p in percents]

    fig, ax = plt.subplots(figsize=(6, max(2, len(disks) * 0.8)))
    bars = ax.barh(mounts, percents, color=colors, edgecolor="none", height=0.5)
    ax.set_xlim(0, 100)
    ax.set_xlabel("Usage %")
    ax.set_title("Disk Usage", fontsize=12, fontweight="bold", color=COLORS["cyan"])
    ax.grid(axis="x", linestyle="--")
    for bar, val in zip(bars, percents):
        ax.text(bar.get_width() + 1, bar.get_y() + bar.get_height() / 2,
                f"{val}%", va="center", fontsize=10, color=COLORS["text"])
    plt.tight_layout()
    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def generate_network_io_chart(interfaces: list[dict]) -> bytes:
    _apply_theme()
    if not interfaces:
        return b""
    names = [i["name"] for i in interfaces]
    sent = [i["sent_mb"] for i in interfaces]
    recv = [i["recv_mb"] for i in interfaces]

    fig, ax = plt.subplots(figsize=(6, max(2.5, len(names) * 0.9)))
    y_pos = range(len(names))
    bar_h = 0.35
    ax.barh([y - bar_h / 2 for y in y_pos], sent, bar_h,
            label="Sent (MB)", color=COLORS["cyan"], edgecolor="none")
    ax.barh([y + bar_h / 2 for y in y_pos], recv, bar_h,
            label="Recv (MB)", color=COLORS["purple"], edgecolor="none")
    ax.set_yticks(list(y_pos))
    ax.set_yticklabels(names)
    ax.set_xlabel("MB")
    ax.set_title("Network I/O", fontsize=12, fontweight="bold", color=COLORS["cyan"])
    ax.legend(loc="lower right", fontsize=9)
    ax.grid(axis="x", linestyle="--")
    plt.tight_layout()
    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def generate_process_chart(processes: list[dict]) -> bytes:
    _apply_theme()
    if not processes:
        return b""
    top = processes[:10]
    names = [p["name"][:20] for p in top]
    cpu_vals = [p["cpu_percent"] for p in top]

    fig, ax = plt.subplots(figsize=(6, max(3, len(names) * 0.5)))
    bars = ax.barh(names, cpu_vals, color=COLORS["blue"], edgecolor="none", height=0.5)
    ax.set_xlabel("CPU %")
    ax.set_title("Top Processes by CPU", fontsize=12, fontweight="bold", color=COLORS["cyan"])
    ax.grid(axis="x", linestyle="--")
    for bar, val in zip(bars, cpu_vals):
        if val > 0:
            ax.text(bar.get_width() + 0.2, bar.get_y() + bar.get_height() / 2,
                    f"{val}%", va="center", fontsize=9, color=COLORS["text"])
    plt.tight_layout()
    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()
