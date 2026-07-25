import psutil
import socket
import subprocess
import os
import platform
import datetime
from typing import Any

from .models import ReportSections


async def collect_system_info() -> dict[str, Any]:
    info = {
        "hostname": socket.gethostname(),
        "user": os.environ.get("USER", "unknown"),
        "os": "Linux",
        "kernel": platform.release(),
        "architecture": platform.machine(),
        "python_version": platform.python_version(),
        "uptime": "N/A",
    }
    try:
        result = subprocess.run(["lsb_release", "-d", "-s"],
                                capture_output=True, text=True, timeout=5)
        if result.stdout.strip():
            info["os"] = result.stdout.strip()
    except Exception:
        pass
    try:
        with open("/proc/uptime") as f:
            uptime_sec = float(f.read().split()[0])
            days = int(uptime_sec // 86400)
            hours = int((uptime_sec % 86400) // 3600)
            minutes = int((uptime_sec % 3600) // 60)
            info["uptime"] = f"{days}d {hours}h {minutes}m"
    except Exception:
        pass
    return info


async def collect_network_info() -> dict[str, Any]:
    data = {"interfaces": [], "gateway": "N/A", "dns_servers": [], "public_ip": "N/A"}

    try:
        gw = subprocess.run(["ip", "route", "show", "default"],
                            capture_output=True, text=True, timeout=5)
        import re
        match = re.search(r"default via ([\d.]+)", gw.stdout)
        if match:
            data["gateway"] = match.group(1)
    except Exception:
        pass

    try:
        with open("/etc/resolv.conf") as f:
            for line in f:
                if line.startswith("nameserver"):
                    data["dns_servers"].append(line.split()[1])
    except Exception:
        pass

    try:
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
        io = psutil.net_io_counters(pernic=True)
        for name, addr_list in addrs.items():
            if name == "lo":
                continue
            iface = {"name": name, "ip": "N/A", "mac": "N/A",
                     "status": "DOWN", "speed": 0, "sent_mb": 0, "recv_mb": 0}
            for addr in addr_list:
                if addr.family == socket.AF_INET:
                    iface["ip"] = addr.address
                elif addr.family == psutil.AF_LINK:
                    iface["mac"] = addr.address
            if name in stats:
                iface["status"] = "UP" if stats[name].isup else "DOWN"
                iface["speed"] = stats[name].speed
            if name in io:
                iface["sent_mb"] = round(io[name].bytes_sent / (1024 * 1024), 2)
                iface["recv_mb"] = round(io[name].bytes_recv / (1024 * 1024), 2)
            data["interfaces"].append(iface)
    except Exception:
        pass

    try:
        hostname = socket.gethostname()
        data["public_ip"] = socket.gethostbyname(hostname)
    except Exception:
        pass

    return data


async def collect_performance_stats() -> dict[str, Any]:
    data = {
        "cpu_percent": 0,
        "cpu_count": psutil.cpu_count(),
        "cpu_freq_mhz": 0,
        "ram_percent": 0,
        "ram_used_mb": 0,
        "ram_total_mb": 0,
        "swap_percent": 0,
        "swap_used_mb": 0,
        "swap_total_mb": 0,
        "load_avg": "N/A",
        "cpu_temp": "N/A",
    }
    try:
        data["cpu_percent"] = psutil.cpu_percent(interval=1)
    except Exception:
        pass
    try:
        freq = psutil.cpu_freq()
        if freq:
            data["cpu_freq_mhz"] = round(freq.current)
    except Exception:
        pass
    try:
        ram = psutil.virtual_memory()
        data["ram_percent"] = ram.percent
        data["ram_used_mb"] = round(ram.used / (1024 * 1024))
        data["ram_total_mb"] = round(ram.total / (1024 * 1024))
    except Exception:
        pass
    try:
        swap = psutil.swap_memory()
        data["swap_percent"] = swap.percent
        data["swap_used_mb"] = round(swap.used / (1024 * 1024))
        data["swap_total_mb"] = round(swap.total / (1024 * 1024))
    except Exception:
        pass
    try:
        load = os.getloadavg()
        data["load_avg"] = f"{load[0]:.2f}, {load[1]:.2f}, {load[2]:.2f}"
    except Exception:
        pass
    try:
        temp_path = "/sys/class/thermal/thermal_zone0/temp"
        if os.path.exists(temp_path):
            with open(temp_path) as f:
                data["cpu_temp"] = f"{int(f.read()) / 1000:.1f}°C"
    except Exception:
        pass
    return data


async def collect_active_connections() -> list[dict]:
    connections = []
    try:
        for conn in psutil.net_connections(kind="inet")[:50]:
            local = f"{conn.laddr.ip}:{conn.laddr.port}" if conn.laddr else "N/A"
            remote = f"{conn.raddr.ip}:{conn.raddr.port}" if conn.raddr else "N/A"
            proc = "N/A"
            if conn.pid:
                try:
                    proc = psutil.Process(conn.pid).name()
                except Exception:
                    pass
            connections.append({
                "proto": "TCP" if conn.type == socket.SOCK_STREAM else "UDP",
                "local": local,
                "remote": remote,
                "status": conn.status,
                "process": proc,
            })
    except Exception:
        pass
    return connections


async def collect_top_processes() -> list[dict]:
    processes = []
    try:
        for p in sorted(
            psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent", "status"]),
            key=lambda x: x.info.get("cpu_percent") or 0,
            reverse=True,
        )[:15]:
            processes.append({
                "pid": p.info["pid"],
                "name": p.info["name"],
                "cpu_percent": round(p.info.get("cpu_percent") or 0, 1),
                "memory_percent": round(p.info.get("memory_percent") or 0, 1),
                "status": p.info.get("status", "N/A"),
            })
    except Exception:
        pass
    return processes


async def collect_disk_usage() -> list[dict]:
    disks = []
    try:
        for part in psutil.disk_partitions():
            try:
                usage = psutil.disk_usage(part.mountpoint)
                disks.append({
                    "device": part.device,
                    "mount": part.mountpoint,
                    "fstype": part.fstype,
                    "total_gb": round(usage.total / (1024**3), 1),
                    "used_gb": round(usage.used / (1024**3), 1),
                    "free_gb": round(usage.free / (1024**3), 1),
                    "percent": usage.percent,
                })
            except PermissionError:
                continue
    except Exception:
        pass
    return disks


async def collect_all(sections: ReportSections) -> dict[str, Any]:
    data = {
        "generated_at": datetime.datetime.now().isoformat(),
        "hostname": socket.gethostname(),
    }
    if sections.system_info:
        data["system_info"] = await collect_system_info()
    if sections.network_info:
        data["network_info"] = await collect_network_info()
    if sections.performance_stats:
        data["performance_stats"] = await collect_performance_stats()
    if sections.active_connections:
        data["active_connections"] = await collect_active_connections()
    if sections.top_processes:
        data["top_processes"] = await collect_top_processes()
    if sections.disk_usage:
        data["disk_usage"] = await collect_disk_usage()
    return data
