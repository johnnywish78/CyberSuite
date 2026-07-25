"""
Johnny CyberSuite X — System Monitor backend
============================================
Live, real system telemetry. Everything here is measured from the running
machine — no synthetic values. Where a sensor genuinely does not exist on
this hardware (e.g. no battery on a desktop, no fan headers exposed), the
API says so explicitly instead of inventing numbers.

Design for low CPU overhead:
  • A single background sampler thread computes all the cheap 1-second
    metrics (CPU %, RAM, net/disk rates, temps, fans, battery, GPU temp)
    ONCE per tick. Every websocket client reads that shared snapshot, so
    N clients cost the same as one.
  • Process CPU% uses persistent psutil.Process objects with non-blocking
    cpu_percent(None) deltas — no per-request sleep, no rescans of /proc
    beyond what's needed.
  • systemctl output is cached (services change slowly) to avoid forking
    on every poll.
"""
import asyncio
import os
import shutil
import subprocess
import threading
import time
from typing import Dict, List, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

try:
    import psutil
    HAS_PSUTIL = True
except Exception:
    psutil = None
    HAS_PSUTIL = False

router = APIRouter(prefix="/api/monitor", tags=["system-monitor"])

_CPU_COUNT = psutil.cpu_count(logical=True) if HAS_PSUTIL else 1
_CPU_PHYS = (psutil.cpu_count(logical=False) or _CPU_COUNT) if HAS_PSUTIL else 1
_BOOT = psutil.boot_time() if HAS_PSUTIL else time.time()


def _which(n):
    return shutil.which(n)


# ═══════════════════════════════════════════════════════════════════════════
#  GPU probe (nvidia-smi if present → util+temp+mem; else nouveau/amd temp)
# ═══════════════════════════════════════════════════════════════════════════
_gpu_backoff = 0.0


def _read_gpu() -> Dict:
    global _gpu_backoff
    now = time.time()
    out = {"present": False, "name": "", "util": None, "temp": None,
           "mem_used": None, "mem_total": None, "source": ""}
    # nvidia-smi — richest source
    if now >= _gpu_backoff and _which("nvidia-smi"):
        try:
            raw = subprocess.check_output(
                ["nvidia-smi",
                 "--query-gpu=utilization.gpu,temperature.gpu,name,memory.used,memory.total",
                 "--format=csv,noheader,nounits"],
                timeout=1.5, stderr=subprocess.DEVNULL).decode().strip()
            p = [x.strip() for x in raw.split("\n")[0].split(",")]
            out.update(present=True, util=float(p[0]), temp=float(p[1]),
                       name=p[2], mem_used=float(p[3]), mem_total=float(p[4]),
                       source="nvidia-smi")
            return out
        except Exception:
            _gpu_backoff = now + 30
    # sysfs GPU busy (amdgpu / some intel) + hwmon temp
    try:
        import glob
        for card in sorted(glob.glob("/sys/class/drm/card[0-9]/device/gpu_busy_percent")):
            with open(card) as f:
                out["util"] = float(f.read().strip())
                out["present"] = True
                out["source"] = "sysfs"
                break
    except Exception:
        pass
    # temperature from psutil sensors (nouveau / amdgpu / etc.)
    if HAS_PSUTIL:
        try:
            temps = psutil.sensors_temperatures()
            for key in ("nouveau", "amdgpu", "radeon", "i915"):
                if key in temps and temps[key]:
                    out["temp"] = round(temps[key][0].current, 1)
                    out["present"] = True
                    if not out["name"]:
                        out["name"] = key
                    if not out["source"]:
                        out["source"] = "hwmon"
                    break
        except Exception:
            pass
    return out


def _read_cpu_temp(temps: Dict) -> Optional[float]:
    for key in ("coretemp", "k10temp", "cpu_thermal", "acpitz", "zenpower"):
        if key in temps and temps[key]:
            return round(temps[key][0].current, 1)
    return None


# ═══════════════════════════════════════════════════════════════════════════
#  Background sampler — one shared snapshot for all websocket clients
# ═══════════════════════════════════════════════════════════════════════════
class Sampler:
    def __init__(self):
        self.snapshot: Dict = {}
        self.lock = threading.Lock()
        self.thread: Optional[threading.Thread] = None
        self.subscribers = 0
        self.running = False
        self._prev_net = None
        self._prev_net_t = 0.0
        self._prev_disk = None
        self._prev_disk_t = 0.0
        self._gpu_cache = {"present": False}
        self._gpu_last = 0.0

    def start(self):
        with self.lock:
            self.subscribers += 1
            if not self.running:
                self.running = True
                self.thread = threading.Thread(target=self._loop, daemon=True)
                self.thread.start()

    def stop(self):
        with self.lock:
            self.subscribers = max(0, self.subscribers - 1)
            if self.subscribers == 0:
                self.running = False

    def _loop(self):
        if HAS_PSUTIL:
            psutil.cpu_percent(percpu=True)  # prime deltas
        while True:
            with self.lock:
                if not self.running:
                    break
            try:
                snap = self._sample()
                with self.lock:
                    self.snapshot = snap
            except Exception:
                pass
            time.sleep(1.0)

    def _sample(self) -> Dict:
        now = time.time()
        d: Dict = {"ts": now, "uptime": int(now - _BOOT), "cpu_count": _CPU_COUNT,
                   "cpu_phys": _CPU_PHYS}
        if not HAS_PSUTIL:
            return d

        # CPU — total + per-core in one shot
        percore = psutil.cpu_percent(percpu=True)
        d["cpu"] = round(sum(percore) / len(percore), 1) if percore else 0.0
        d["cpu_percore"] = [round(c, 1) for c in percore]
        try:
            la = os.getloadavg()
            d["loadavg"] = [round(x, 2) for x in la]
        except Exception:
            d["loadavg"] = [0, 0, 0]
        try:
            fr = psutil.cpu_freq()
            d["cpu_freq"] = round(fr.current) if fr else None
            d["cpu_freq_max"] = round(fr.max) if fr and fr.max else None
        except Exception:
            d["cpu_freq"] = d["cpu_freq_max"] = None

        # Memory
        m = psutil.virtual_memory()
        d["ram"] = m.percent
        d["ram_used"] = round(m.used / 1024**3, 2)
        d["ram_total"] = round(m.total / 1024**3, 2)
        d["ram_avail"] = round(m.available / 1024**3, 2)
        sw = psutil.swap_memory()
        d["swap"] = sw.percent
        d["swap_used"] = round(sw.used / 1024**3, 2)
        d["swap_total"] = round(sw.total / 1024**3, 2)

        # Network rates (aggregate)
        net = psutil.net_io_counters()
        if self._prev_net and now > self._prev_net_t:
            dt = now - self._prev_net_t
            d["net_down"] = round((net.bytes_recv - self._prev_net.bytes_recv) * 8 / 1e6 / dt, 2)
            d["net_up"] = round((net.bytes_sent - self._prev_net.bytes_sent) * 8 / 1e6 / dt, 2)
        else:
            d["net_down"] = d["net_up"] = 0.0
        d["net_recv_total"] = net.bytes_recv
        d["net_sent_total"] = net.bytes_sent
        self._prev_net, self._prev_net_t = net, now

        # Disk IO rates (aggregate)
        try:
            dio = psutil.disk_io_counters()
            if dio and self._prev_disk and now > self._prev_disk_t:
                dt = now - self._prev_disk_t
                d["disk_read"] = round((dio.read_bytes - self._prev_disk.read_bytes) / 1024**2 / dt, 2)
                d["disk_write"] = round((dio.write_bytes - self._prev_disk.write_bytes) / 1024**2 / dt, 2)
            else:
                d["disk_read"] = d["disk_write"] = 0.0
            self._prev_disk, self._prev_disk_t = dio, now
        except Exception:
            d["disk_read"] = d["disk_write"] = 0.0

        # Root disk usage (cheap enough per tick)
        try:
            du = psutil.disk_usage("/")
            d["disk_percent"] = du.percent
            d["disk_used"] = round(du.used / 1024**3, 1)
            d["disk_total"] = round(du.total / 1024**3, 1)
        except Exception:
            pass

        # Temperatures
        temps_out = []
        cpu_temp = None
        try:
            temps = psutil.sensors_temperatures()
            cpu_temp = _read_cpu_temp(temps)
            for chip, entries in temps.items():
                for e in entries:
                    temps_out.append({
                        "chip": chip, "label": e.label or chip,
                        "current": round(e.current, 1) if e.current is not None else None,
                        "high": round(e.high, 1) if e.high else None,
                        "critical": round(e.critical, 1) if e.critical else None,
                    })
        except Exception:
            pass
        d["cpu_temp"] = cpu_temp
        d["temps"] = temps_out

        # Fans
        fans_out = []
        try:
            fans = psutil.sensors_fans()
            for chip, entries in fans.items():
                for e in entries:
                    fans_out.append({"chip": chip, "label": e.label or chip, "rpm": e.current})
        except Exception:
            pass
        d["fans"] = fans_out
        d["fans_available"] = len(fans_out) > 0

        # Battery
        try:
            b = psutil.sensors_battery()
            if b is None:
                d["battery"] = None
            else:
                d["battery"] = {
                    "percent": round(b.percent, 1),
                    "plugged": bool(b.power_plugged),
                    "secsleft": (None if b.secsleft in (psutil.POWER_TIME_UNLIMITED,
                                                        psutil.POWER_TIME_UNKNOWN) else b.secsleft),
                }
        except Exception:
            d["battery"] = None

        # GPU — refresh at most every 2s (nvidia-smi fork is the pricey bit)
        if now - self._gpu_last >= 2.0:
            self._gpu_cache = _read_gpu()
            self._gpu_last = now
        d["gpu"] = self._gpu_cache

        return d


_sampler = Sampler()


# ═══════════════════════════════════════════════════════════════════════════
#  WEBSOCKET — live metrics (shared snapshot, 1 Hz)
# ═══════════════════════════════════════════════════════════════════════════
@router.websocket("/ws")
async def monitor_ws(ws: WebSocket):
    await ws.accept()
    _sampler.start()
    try:
        # deliver first frame promptly even if the sampler just started
        for _ in range(20):
            with _sampler.lock:
                snap = dict(_sampler.snapshot)
            if snap:
                await ws.send_json(snap)
                break
            await asyncio.sleep(0.1)
        last_ts = snap.get("ts") if snap else None
        while True:
            await asyncio.sleep(1.0)
            with _sampler.lock:
                snap = dict(_sampler.snapshot)
            if snap and snap.get("ts") != last_ts:
                last_ts = snap.get("ts")
                await ws.send_json(snap)
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        _sampler.stop()


# ═══════════════════════════════════════════════════════════════════════════
#  PROCESSES — persistent cache, non-blocking CPU deltas
# ═══════════════════════════════════════════════════════════════════════════
_proc_cache: Dict[int, "psutil.Process"] = {}
_proc_primed = False


@router.get("/processes")
def processes():
    if not HAS_PSUTIL:
        return {"ok": False, "processes": [], "error": "psutil unavailable"}
    global _proc_primed
    rows = []
    seen = set()
    for p in psutil.process_iter(["pid"]):
        pid = p.info["pid"]
        seen.add(pid)
        proc = _proc_cache.get(pid)
        if proc is None:
            try:
                proc = psutil.Process(pid)
                proc.cpu_percent(None)  # prime this process' delta
                _proc_cache[pid] = proc
            except Exception:
                continue
        try:
            with proc.oneshot():
                cpu = proc.cpu_percent(None)
                mem = proc.memory_info()
                info = {
                    "pid": pid,
                    "name": proc.name(),
                    "username": (proc.username() or "")[:24],
                    "status": proc.status(),
                    "cpu": round(cpu / _CPU_COUNT, 1),   # normalized to whole machine
                    "cpu_raw": round(cpu, 1),            # can exceed 100 (multi-thread)
                    "mem_percent": round(proc.memory_percent(), 1),
                    "rss": round(mem.rss / 1024**2, 1),  # MB
                    "threads": proc.num_threads(),
                }
            rows.append(info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            _proc_cache.pop(pid, None)
        except Exception:
            pass

    # evict dead processes from the cache
    for dead in set(_proc_cache) - seen:
        _proc_cache.pop(dead, None)

    primed = _proc_primed
    _proc_primed = True
    return {
        "ok": True, "count": len(rows),
        "primed": primed,   # first call has 0 CPU deltas; UI can hint "measuring…"
        "cpu_count": _CPU_COUNT,
        "processes": rows,
    }


@router.post("/kill")
def kill_process(body: dict):
    pid = int(body.get("pid", 0))
    sig = body.get("signal", "term")
    if pid <= 1:
        return {"ok": False, "error": "refusing to signal pid<=1"}
    try:
        proc = psutil.Process(pid)
        name = proc.name()
        if sig == "kill":
            proc.kill()
        else:
            proc.terminate()
        _proc_cache.pop(pid, None)
        return {"ok": True, "pid": pid, "name": name, "signal": sig}
    except psutil.NoSuchProcess:
        return {"ok": False, "error": "no such process"}
    except psutil.AccessDenied:
        return {"ok": False, "error": "permission denied (needs root)"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════
#  SERVICES — systemctl, cached
# ═══════════════════════════════════════════════════════════════════════════
_svc_cache = {"ts": 0.0, "data": None}


def _read_services() -> Dict:
    if not _which("systemctl"):
        return {"ok": False, "error": "systemctl not available", "services": []}
    try:
        out = subprocess.run(
            ["systemctl", "list-units", "--type=service", "--all",
             "--no-legend", "--no-pager", "--plain"],
            capture_output=True, text=True, timeout=8).stdout
    except Exception as e:
        return {"ok": False, "error": str(e), "services": []}

    services = []
    counts = {"running": 0, "exited": 0, "dead": 0, "failed": 0, "other": 0}
    for line in out.splitlines():
        parts = line.split(None, 4)
        if len(parts) < 4:
            continue
        unit, load, active, sub = parts[0], parts[1], parts[2], parts[3]
        desc = parts[4] if len(parts) > 4 else ""
        if not unit.endswith(".service"):
            continue
        name = unit[:-len(".service")]
        services.append({
            "name": name, "load": load, "active": active,
            "sub": sub, "description": desc,
        })
        if sub in counts:
            counts[sub] += 1
        elif active == "failed" or sub == "failed":
            counts["failed"] += 1
        else:
            counts["other"] += 1
    services.sort(key=lambda s: (s["active"] != "active", s["name"]))
    return {"ok": True, "total": len(services), "counts": counts, "services": services}


@router.get("/services")
def services(force: bool = False):
    now = time.time()
    if not force and _svc_cache["data"] and now - _svc_cache["ts"] < 5:
        return _svc_cache["data"]
    data = _read_services()
    _svc_cache.update(ts=now, data=data)
    return data


@router.post("/service-action")
def service_action(body: dict):
    name = str(body.get("name", "")).strip()
    action = str(body.get("action", "")).strip()
    if not name or action not in ("start", "stop", "restart"):
        return {"ok": False, "error": "invalid request"}
    if not name.replace("-", "").replace("_", "").replace(".", "").replace("@", "").isalnum():
        return {"ok": False, "error": "invalid service name"}
    try:
        r = subprocess.run(["systemctl", action, f"{name}.service"],
                           capture_output=True, text=True, timeout=15)
        _svc_cache["ts"] = 0.0  # invalidate cache
        if r.returncode == 0:
            return {"ok": True, "name": name, "action": action}
        return {"ok": False, "error": (r.stderr or r.stdout or "failed").strip()[:200]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════
#  DISKS — partitions + per-disk IO totals
# ═══════════════════════════════════════════════════════════════════════════
@router.get("/disks")
def disks():
    if not HAS_PSUTIL:
        return {"ok": False, "partitions": []}
    parts = []
    for dp in psutil.disk_partitions(all=False):
        # skip read-only pseudo mounts (snap/loop squashfs, etc.) — real storage only
        if dp.fstype in ("squashfs", "") or dp.device.startswith("/dev/loop"):
            continue
        try:
            u = psutil.disk_usage(dp.mountpoint)
            parts.append({
                "device": dp.device, "mountpoint": dp.mountpoint,
                "fstype": dp.fstype,
                "total": round(u.total / 1024**3, 1),
                "used": round(u.used / 1024**3, 1),
                "free": round(u.free / 1024**3, 1),
                "percent": u.percent,
            })
        except Exception:
            pass
    io = {}
    try:
        per = psutil.disk_io_counters(perdisk=True)
        for name, c in per.items():
            if name.startswith("loop") or name.startswith("ram"):
                continue
            io[name] = {
                "read_mb": round(c.read_bytes / 1024**2, 1),
                "write_mb": round(c.write_bytes / 1024**2, 1),
                "read_count": c.read_count, "write_count": c.write_count,
            }
    except Exception:
        pass
    parts.sort(key=lambda p: -p["percent"])
    return {"ok": True, "partitions": parts, "io": io}


# ═══════════════════════════════════════════════════════════════════════════
#  NETWORK — per-interface addresses, state, counters
# ═══════════════════════════════════════════════════════════════════════════
_net_prev_if = {"data": None, "ts": 0.0}


@router.get("/network")
def network():
    if not HAS_PSUTIL:
        return {"ok": False, "interfaces": []}
    import socket as _sock
    addrs = psutil.net_if_addrs()
    stats = psutil.net_if_stats()
    io = psutil.net_io_counters(pernic=True)

    now = time.time()
    prev = _net_prev_if["data"]
    dt = now - _net_prev_if["ts"] if prev else 0

    rows = []
    for name, alist in addrs.items():
        ipv4, ipv6, mac = [], [], ""
        for a in alist:
            if a.family == _sock.AF_INET:
                ipv4.append(a.address)
            elif a.family == _sock.AF_INET6:
                ipv6.append(a.address.split("%")[0])
            elif a.family == getattr(_sock, "AF_PACKET", 17):
                mac = a.address
        st = stats.get(name)
        c = io.get(name)
        down = up = 0.0
        if c and prev and name in prev and dt > 0:
            down = round((c.bytes_recv - prev[name].bytes_recv) * 8 / 1e6 / dt, 2)
            up = round((c.bytes_sent - prev[name].bytes_sent) * 8 / 1e6 / dt, 2)
        rows.append({
            "name": name,
            "is_up": bool(st.isup) if st else False,
            "speed": st.speed if st else 0,
            "mtu": st.mtu if st else 0,
            "mac": mac, "ipv4": ipv4, "ipv6": ipv6,
            "bytes_recv": c.bytes_recv if c else 0,
            "bytes_sent": c.bytes_sent if c else 0,
            "packets_recv": c.packets_recv if c else 0,
            "packets_sent": c.packets_sent if c else 0,
            "errin": c.errin if c else 0, "errout": c.errout if c else 0,
            "dropin": c.dropin if c else 0, "dropout": c.dropout if c else 0,
            "down_mbps": down, "up_mbps": up,
        })
    _net_prev_if["data"] = io
    _net_prev_if["ts"] = now
    rows.sort(key=lambda r: (not r["is_up"], r["name"] == "lo", r["name"]))
    return {"ok": True, "interfaces": rows}


# ═══════════════════════════════════════════════════════════════════════════
#  SNAPSHOT — one-shot pull of the live metrics (for non-WS consumers)
# ═══════════════════════════════════════════════════════════════════════════
@router.get("/live")
def live():
    with _sampler.lock:
        snap = dict(_sampler.snapshot)
    if not snap:
        # sampler not running (no WS clients) → take a single sample on demand
        s = Sampler()
        if HAS_PSUTIL:
            psutil.cpu_percent(percpu=True)
            time.sleep(0.15)
        snap = s._sample()
    return snap
