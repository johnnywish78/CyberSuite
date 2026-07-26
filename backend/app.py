"""
Johnny CyberSuite X — FastAPI Backend
"""
import asyncio, json, os, pty, fcntl, select, signal, struct, subprocess, time
from typing import Optional, List, Dict
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles

try:
    import psutil; HAS_PSUTIL = True
except: psutil = None; HAS_PSUTIL = False

from backend.settings import load_settings, save_settings, load_themes, load_theme_assets
from backend.vpn import profiles as vpn
from backend.vpn import manager as vpnmgr
from backend.net_center import router as net_center_router
from backend.sys_monitor import router as sys_monitor_router
from backend.ai.router import router as ai_router
from backend.reports.router import router as reports_router

app = FastAPI(title="Johnny CyberSuite X", version="3.7.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
    allow_methods=["*"], allow_headers=["*"])

# Network Center — Speed Test, Ping, DNS, Whois, Port Scan, Traceroute,
# Active Connections, Interfaces, WiFi, Diagnostics (see backend/net_center.py)
app.include_router(net_center_router)

# System Monitor — live CPU/RAM/GPU/Disk/Net/Temp/Battery/Fans + Processes,
# Services, per-interface network, per-disk IO (see backend/sys_monitor.py)
app.include_router(sys_monitor_router)

# AI Center — provider registry, streaming chat, conversations, tools
# (see backend/ai/router.py + backend/ai/providers/)
app.include_router(ai_router)

# Reports Center — generate PDF/HTML/JSON/CSV system reports with charts,
# list / download / delete (see backend/reports/)
app.include_router(reports_router)

# ── State ──────────────────────────────────────────────────────────────────
_net_prev  = None
_net_time  = 0
_gpu_fail_until = 0.0        # backoff when nvidia-smi is absent/broken
_pub_ip    = {"ip": "", "ts": 0.0}
_local_ip  = {"ip": "127.0.0.1", "ts": 0.0}

# ═══════════════════════════════════════════════════════════════════════════
#  HEALTH
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/api/health")
def health(): return {"ok": True, "version": "3.7.0"}

# ═══════════════════════════════════════════════════════════════════════════
#  SYSTEM STATS
# ═══════════════════════════════════════════════════════════════════════════
def _read_cpu_model() -> str:
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if "model name" in line:
                    return line.split(":",1)[1].strip()[:32]
    except: pass
    return "CPU"

_CPU_MODEL = _read_cpu_model()
_HOSTNAME  = os.uname().nodename

def _get_local_ip() -> str:
    now = time.time()
    if now - _local_ip["ts"] < 10:
        return _local_ip["ip"]
    ip = "127.0.0.1"
    try:
        for iface, alist in psutil.net_if_addrs().items():
            if iface == "lo": continue
            for a in alist:
                if a.family == 2 and not a.address.startswith("127"):
                    ip = a.address; break
            if ip != "127.0.0.1": break
    except: pass
    _local_ip.update(ip=ip, ts=now)
    return ip

def _query_gpu() -> Dict:
    """GPU info via nvidia-smi, fallback to lspci/nouveau."""

    global _gpu_fail_until

    now = time.time()

    # Try NVIDIA telemetry first
    if now >= _gpu_fail_until:
        try:
            out = subprocess.check_output(
                [
                    "nvidia-smi",
                    "--query-gpu=utilization.gpu,temperature.gpu,name",
                    "--format=csv,noheader,nounits"
                ],
                timeout=1,
                stderr=subprocess.DEVNULL
            ).decode().strip()

            parts = [p.strip() for p in out.split("\n")[0].split(",")]

            return {
                "gpu": float(parts[0]),
                "gpu_temp": float(parts[1]),
                "gpu_name": parts[2] if len(parts) > 2 else "",
                "gpu_driver": "nvidia"
            }

        except:
            _gpu_fail_until = now + 60


    # Fallback: detect GPU from PCI
    name = ""
    driver = ""

    try:
        out = subprocess.check_output(
            ["lspci", "-nnk"],
            stderr=subprocess.DEVNULL
        ).decode()

        lines = out.splitlines()

        for i, line in enumerate(lines):
            if "VGA compatible controller" in line or "3D controller" in line:
                name = line.split(": ", 1)[-1]

                for sub in lines[i+1:i+4]:
                    if "Kernel driver in use:" in sub:
                        driver = sub.split(":")[-1].strip()

                break

    except:
        pass

    return {
        "gpu": 0.0,
        "gpu_temp": 0.0,
        "gpu_name": name,
        "gpu_driver": driver
    }

@app.get("/api/stats")
def get_stats():
    global _net_prev, _net_time
    data = {"cpu":0,"ram":0,"gpu":0,"gpu_temp":0,"gpu_name":"","ram_used":0,"ram_total":1,
            "dl":0,"ul":0,"cpu_temp":0,"local_ip":"127.0.0.1",
            "disk_percent":0,"disk_used":0,"disk_total":0,
            "cpu_model":_CPU_MODEL,"hostname":_HOSTNAME,"uptime":0}
    if not HAS_PSUTIL: return data
    data["cpu"]        = psutil.cpu_percent(interval=0.3)
    mem = psutil.virtual_memory()
    data["ram"]        = mem.percent
    data["ram_used"]   = round(mem.used  / (1024**3), 1)
    data["ram_total"]  = round(mem.total / (1024**3), 1)
    data["uptime"]     = int(time.time() - psutil.boot_time())

    data.update(_query_gpu())

    # root disk
    try:
        du = psutil.disk_usage("/")
        data["disk_percent"] = du.percent
        data["disk_used"]    = round(du.used  / (1024**3), 1)
        data["disk_total"]   = round(du.total / (1024**3), 1)
    except: pass

    # net speed
    now = time.time()
    net = psutil.net_io_counters()
    if _net_prev and (now - _net_time) > 0:
        dt = now - _net_time
        data["dl"] = round((net.bytes_recv - _net_prev.bytes_recv) * 8 / 1e6 / dt, 1)
        data["ul"] = round((net.bytes_sent - _net_prev.bytes_sent) * 8 / 1e6 / dt, 1)
    _net_prev = net; _net_time = now

    # CPU temp
    try:
        temps = psutil.sensors_temperatures()
        for k in ("coretemp","k10temp","cpu_thermal","acpitz"):
            if k in temps:
                data["cpu_temp"] = round(temps[k][0].current, 1); break
    except: pass

    data["local_ip"] = _get_local_ip()
    return data

# ═══════════════════════════════════════════════════════════════════════════
#  NETWORK
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/api/network/info")
def network_info():
    info = {"gateway":"—","dns":[],"interfaces":[]}
    try:
        r = subprocess.check_output(["ip","route"],timeout=3,stderr=subprocess.DEVNULL).decode()
        for line in r.splitlines():
            if line.startswith("default"): info["gateway"] = line.split()[2]; break
    except: pass
    try:
        with open("/etc/resolv.conf") as f:
            info["dns"] = [l.split()[1] for l in f if l.startswith("nameserver")][:3]
    except: pass
    return info

@app.get("/api/network/publicip")
async def public_ip():
    now = time.time()
    if _pub_ip["ip"] and (now - _pub_ip["ts"] < 300):
        return {"ip": _pub_ip["ip"], "cached": True}
    for url in ("https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"):
        try:
            r = await asyncio.wait_for(asyncio.create_subprocess_exec(
                "curl", "-s", "--max-time", "4", url,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL), timeout=6)
            out, _ = await r.communicate()
            ip = out.decode().strip()
            if ip and len(ip) < 46 and all(c in "0123456789abcdef.:ABCDEF" for c in ip):
                _pub_ip.update(ip=ip, ts=now)
                return {"ip": ip, "cached": False}
        except: continue
    return {"ip": _pub_ip["ip"] or "", "cached": bool(_pub_ip["ip"])}

@app.post("/api/network/ping")
async def do_ping(body: dict):
    host  = body.get("host","8.8.8.8")
    count = int(body.get("count",4))
    try:
        r = await asyncio.wait_for(asyncio.create_subprocess_exec(
            "ping","-c",str(count),host,
            stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE), timeout=20)
        out,err = await r.communicate()
        return {"output":(out+err).decode(),"ok":r.returncode==0}
    except asyncio.TimeoutError:
        return {"output":"Timeout","ok":False}

@app.post("/api/network/dns")
async def do_dns(body: dict):
    domain = body.get("domain","google.com")
    try:
        r = await asyncio.create_subprocess_exec("nslookup",domain,
            stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        out,err = await r.communicate()
        return {"output":(out+err).decode(),"ok":True}
    except Exception as e:
        return {"output":str(e),"ok":False}

@app.post("/api/network/traceroute")
async def do_trace(body: dict):
    host = body.get("host","8.8.8.8")
    try:
        r = await asyncio.create_subprocess_exec("traceroute","-m","15",host,
            stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        out,err = await r.communicate()
        return {"output":(out+err).decode(),"ok":True}
    except Exception as e:
        return {"output":str(e),"ok":False}

@app.post("/api/network/scan")
async def do_scan(body: dict):
    host = body.get("host","192.168.1.0/24")
    try:
        r = await asyncio.wait_for(asyncio.create_subprocess_exec(
            "nmap","-sn",host,
            stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE), timeout=30)
        out,err = await r.communicate()
        return {"output":(out+err).decode(),"ok":True}
    except Exception as e:
        return {"output":str(e),"ok":False}

@app.post("/api/network/speedtest")
async def do_speedtest():
    try:
        r = await asyncio.wait_for(asyncio.create_subprocess_exec(
            "speedtest-cli","--simple",
            stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE), timeout=60)
        out,err = await r.communicate()
        return {"output":(out+err).decode(),"ok":True}
    except Exception as e:
        return {"output":str(e),"ok":False}

# ═══════════════════════════════════════════════════════════════════════════
#  VPN
# ═══════════════════════════════════════════════════════════════════════════
# ═══════════════════════════════════════════════════════════════════════════
#  VPN CENTER  (nmcli-backed: OpenVPN + WireGuard, import, kill switch,
#  auto-connect, live status / IP / traffic — see backend/vpn/manager.py)
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/api/vpn/status")
def vpn_status(): return vpnmgr.get_status()

@app.get("/api/vpn/profiles")
def list_profiles(): return vpnmgr.load_profiles()

@app.post("/api/vpn/profiles")
def create_profile(body: dict): return vpnmgr.add_profile(body)

@app.delete("/api/vpn/profiles/{pid}")
def delete_profile(pid: str):
    ok = vpnmgr.delete_profile(pid)
    if not ok: raise HTTPException(404, "Profile not found")
    return {"ok": True}

@app.post("/api/vpn/connect")
def vpn_connect(body: dict):
    pid   = body.get("profile_id")
    profs = vpnmgr.load_profiles()
    prof  = next((p for p in profs if p.get("id") == pid), None)
    if not prof: raise HTTPException(404, "Profile not found")
    return vpnmgr.connect(prof)

@app.post("/api/vpn/disconnect")
def vpn_disconnect(): return vpnmgr.disconnect()

# ── import ───────────────────────────────────────────────────────────────
@app.post("/api/vpn/import")
def vpn_import(body: dict):
    """Import an OpenVPN (.ovpn) or WireGuard (.conf) profile.
    Accepts either {path: "/abs/path"} or {filename, content}."""
    name = (body.get("name") or "").strip()
    if body.get("path"):
        return vpnmgr.import_path(body["path"], name)
    if body.get("content"):
        return vpnmgr.import_config(body.get("filename", "config"), body["content"], name)
    return {"ok": False, "error": "provide 'path' or 'content'"}

@app.post("/api/vpn/import-file")
async def vpn_import_file(file: UploadFile = File(...), name: str = Form("")):
    content = (await file.read()).decode("utf-8", errors="ignore")
    return vpnmgr.import_config(file.filename or "config", content, name)

# ── live telemetry ───────────────────────────────────────────────────────
@app.get("/api/vpn/ip")
def vpn_ip(force: bool = False): return vpnmgr.get_public_ip(force=force)

@app.get("/api/vpn/traffic")
def vpn_traffic(): return vpnmgr.get_traffic()

# ── kill switch ──────────────────────────────────────────────────────────
@app.get("/api/vpn/killswitch")
def vpn_ks_status(): return vpnmgr.killswitch_status()

@app.post("/api/vpn/killswitch")
def vpn_ks_set(body: dict): return vpnmgr.killswitch(bool(body.get("enable")))

# ── auto-connect ─────────────────────────────────────────────────────────
@app.get("/api/vpn/autoconnect")
def vpn_ac_get(): return vpnmgr.get_autoconnect()

@app.post("/api/vpn/autoconnect")
def vpn_ac_set(body: dict):
    return vpnmgr.set_autoconnect(body.get("profile_id", ""), bool(body.get("enable")))

# ═══════════════════════════════════════════════════════════════════════════
#  AI CENTER  (provider registry, streaming chat, persisting conversations,
#  AI-assisted tools — see backend/ai/router.py + backend/ai/providers/)
# ═══════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════
#  THEMES & SETTINGS
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/api/themes")
def get_themes(): return load_themes()

@app.get("/api/theme-assets")
def get_theme_assets(): return load_theme_assets()

@app.get("/api/settings")
def get_settings(): return load_settings()

@app.put("/api/settings")
def put_settings(body: dict):
    s = load_settings(); s.update(body); save_settings(s)
    return s

# ═══════════════════════════════════════════════════════════════════════════
#  ASSETS API
# ═══════════════════════════════════════════════════════════════════════════
ASSETS_DIR = os.path.join(os.path.dirname(__file__), "..", "assets")

ASSET_EXTENSIONS = {
    "backgrounds": {"jpg", "jpeg", "png", "webp", "gif"},
    "music":       {"mp3", "ogg", "wav", "flac", "aac"},
    "fonts":       {"ttf", "otf", "woff", "woff2"},
    "icons":       {"png", "svg", "ico"},
}

def scan_asset_dir(category: str) -> List[Dict]:
    """Return metadata for every file in assets/{category}/."""
    base = Path(ASSETS_DIR) / category
    if not base.is_dir():
        return []
    allowed = ASSET_EXTENSIONS.get(category, set())
    results = []
    for f in sorted(base.iterdir()):
        if f.is_file() and f.suffix.lstrip(".").lower() in allowed:
            results.append({
                "name": f.name,
                "stem": f.stem,
                "ext":  f.suffix.lstrip(".").lower(),
                "size": f.stat().st_size,
                "url":  f"/assets/{category}/{f.name}",
            })
    return results

@app.get("/api/assets")
def list_asset_summary():
    return {cat: len(scan_asset_dir(cat)) for cat in ASSET_EXTENSIONS}

@app.get("/api/assets/{category}")
def list_assets_by_category(category: str):
    if category not in ASSET_EXTENSIONS:
        raise HTTPException(404, f"Unknown category: {category}")
    return scan_asset_dir(category)

# ═══════════════════════════════════════════════════════════════════════════
#  SYSTEM COMMANDS
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/api/system/processes")
def get_processes():
    if not HAS_PSUTIL: return []
    procs = []
    for p in psutil.process_iter(["pid","name","cpu_percent","memory_percent","status"]):
        try: procs.append(p.info)
        except: pass
    return sorted(procs, key=lambda x: x["cpu_percent"], reverse=True)[:20]

@app.get("/api/system/disk")
def get_disk():
    if not HAS_PSUTIL: return []
    parts = []
    for dp in psutil.disk_partitions():
        try:
            usage = psutil.disk_usage(dp.mountpoint)
            parts.append({"device":dp.device,"mountpoint":dp.mountpoint,
                "total":round(usage.total/1024**3,1),
                "used":round(usage.used/1024**3,1),"percent":usage.percent})
        except: pass
    return parts

# ═══════════════════════════════════════════════════════════════════════════
#  SYSTEM INFO (About page)
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/api/system/info")
def get_system_info():
    info = {
        "os": "", "os_pretty": "", "kernel": "", "arch": "",
        "hostname": "", "uptime": 0, "desktop": "", "shell": "",
        "cpu_model": "", "cpu_cores": 0, "cpu_threads": 0,
        "cpu_freq": "", "cpu_temp": "",
        "ram_total": 0, "ram_used": 0, "ram_available": 0, "ram_percent": 0,
        "swap_total": 0, "swap_used": 0,
        "gpu_name": "", "gpu_driver": "", "gpu_memory": "",
        "disks": [], "network": []
    }

    # OS info
    uname = os.uname()
    info["kernel"]   = f"{uname.sysname} {uname.release}"
    info["arch"]     = uname.machine
    info["hostname"] = uname.nodename

    # Pretty OS name from /etc/os-release
    try:
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    info["os_pretty"] = line.split("=",1)[1].strip().strip('"')
                    break
    except: pass
    info["os"] = info["os_pretty"] or f"{uname.sysname} {uname.release}"

    # Desktop env
    info["desktop"] = os.environ.get("XDG_CURRENT_DESKTOP", os.environ.get("DESKTOP_SESSION", "—"))
    info["shell"]   = os.environ.get("SHELL", "/bin/bash")

    if HAS_PSUTIL:
        # Uptime
        info["uptime"] = int(time.time() - psutil.boot_time())

        # CPU
        info["cpu_cores"]   = psutil.cpu_count(logical=False) or 0
        info["cpu_threads"] = psutil.cpu_count(logical=True) or 0
        try:
            freq = psutil.cpu_freq()
            if freq: info["cpu_freq"] = str(round(freq.current))
        except: pass
        try:
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if "model name" in line:
                        info["cpu_model"] = line.split(":",1)[1].strip(); break
        except: pass
        try:
            temps = psutil.sensors_temperatures()
            for k in ("coretemp","k10temp","cpu_thermal","acpitz"):
                if k in temps:
                    info["cpu_temp"] = str(round(temps[k][0].current, 1)); break
        except: pass

        # RAM
        mem = psutil.virtual_memory()
        info["ram_total"]     = round(mem.total / (1024**3), 1)
        info["ram_used"]      = round(mem.used  / (1024**3), 1)
        info["ram_available"] = round(mem.available / (1024**3), 1)
        info["ram_percent"]   = mem.percent
        swap = psutil.swap_memory()
        info["swap_total"] = round(swap.total / (1024**3), 1)
        info["swap_used"]  = round(swap.used  / (1024**3), 1)

        # Disks
        for dp in psutil.disk_partitions():
            try:
                u = psutil.disk_usage(dp.mountpoint)
                info["disks"].append({
                    "device": dp.device, "mountpoint": dp.mountpoint,
                    "total": round(u.total/1024**3,1),
                    "used": round(u.used/1024**3,1), "percent": u.percent
                })
            except: pass

        # Network interfaces
        addrs = psutil.net_if_addrs()
        for iface, alist in addrs.items():
            if iface == "lo": continue
            ip = mac = ""
            for a in alist:
                if a.family == 2:   ip  = a.address      # AF_INET
                if a.family == 17:  mac = a.address       # AF_PACKET
            if ip or mac:
                info["network"].append({"name": iface, "ip": ip, "mac": mac})

    # GPU (nvidia-smi)
    try:
        out = subprocess.check_output(
            ["nvidia-smi","--query-gpu=name,driver_version,memory.total",
             "--format=csv,noheader,nounits"],
            timeout=2, stderr=subprocess.DEVNULL).decode().strip()
        parts = out.split(",")
        info["gpu_name"]   = parts[0].strip() if len(parts)>0 else ""
        info["gpu_driver"] = parts[1].strip() if len(parts)>1 else ""
        info["gpu_memory"] = (parts[2].strip()+" MiB") if len(parts)>2 else ""
    except:
        # Fallback: try lspci
        try:
            out = subprocess.check_output(["lspci"], timeout=2,
                stderr=subprocess.DEVNULL).decode()
            for line in out.splitlines():
                if "VGA" in line or "3D" in line:
                    info["gpu_name"] = line.split(":",2)[-1].strip()
                    break
        except: pass

    return info

# ═══════════════════════════════════════════════════════════════════════════
#  WEBSOCKET — LIVE STATS
# ═══════════════════════════════════════════════════════════════════════════
@app.websocket("/ws/stats")
async def ws_stats(ws: WebSocket):
    await ws.accept()
    loop = asyncio.get_event_loop()
    try:
        while True:
            data = await loop.run_in_executor(None, get_stats)
            await ws.send_json(data)
            await asyncio.sleep(1)
    except (WebSocketDisconnect, Exception): pass

# ═══════════════════════════════════════════════════════════════════════════
#  WEBSOCKET — TERMINAL (PTY)
# ═══════════════════════════════════════════════════════════════════════════
@app.websocket("/ws/terminal")
async def ws_terminal(ws: WebSocket):
    await ws.accept()
    master_fd, slave_fd = pty.openpty()
    # set window size
    winsize = struct.pack("HHHH", 40, 140, 0, 0)
    try:
        import termios
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
    except: pass

    pid = os.fork()
    if pid == 0:
        os.close(master_fd)
        os.setsid()
        try:
            import termios as T
            fcntl.ioctl(slave_fd, T.TIOCSCTTY, 0)
        except: pass
        for fd in (0,1,2): os.dup2(slave_fd, fd)
        os.close(slave_fd)
        env = os.environ.copy()
        env["TERM"]      = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["PS1"]       = r"\[\033[01;33m\]JohnnyCyberSuite\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "
        os.execvpe("/bin/bash", ["/bin/bash","--login"], env)
        os._exit(1)
    else:
        os.close(slave_fd)
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def _pty_readable():
            try:
                data = os.read(master_fd, 4096)
                loop.call_soon_threadsafe(queue.put_nowait, data)
            except OSError: pass

        loop.add_reader(master_fd, _pty_readable)
        try:
            async def _send():
                while True:
                    data = await queue.get()
                    await ws.send_bytes(data)

            async def _recv():
                while True:
                    msg = await ws.receive()
                    if "bytes" in msg:
                        os.write(master_fd, msg["bytes"])
                    elif "text" in msg:
                        try:
                            d = json.loads(msg["text"])
                            if d.get("type") == "resize":
                                ws_struct = struct.pack("HHHH",
                                    int(d.get("rows",40)), int(d.get("cols",140)),0,0)
                                try:
                                    import termios
                                    fcntl.ioctl(master_fd, termios.TIOCSWINSZ, ws_struct)
                                except: pass
                        except:
                            os.write(master_fd, msg["text"].encode())
            await asyncio.gather(_send(), _recv())
        except (WebSocketDisconnect, Exception): pass
        finally:
            loop.remove_reader(master_fd)
            try: os.close(master_fd)
            except: pass
            try: os.kill(pid, signal.SIGTERM)
            except: pass

# ═══════════════════════════════════════════════════════════════════════════
#  STATIC FILES — serve assets/ (must be AFTER all /api routes)
# ═══════════════════════════════════════════════════════════════════════════
if os.path.isdir(ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
