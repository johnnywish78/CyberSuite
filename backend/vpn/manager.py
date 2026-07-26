"""
Johnny CyberSuite X — VPN Center engine
=======================================
Real VPN management built on NetworkManager (nmcli). On this machine nmcli
can import, activate, deactivate and delete both OpenVPN and WireGuard
connections WITHOUT a sudo/polkit password (polkit grants network-control +
settings.modify.system to the session user), and the wireguard kernel module
is loaded — so WireGuard works even though the `wg` CLI is not installed.

Everything reported here is measured from the live system:
  • status        — parsed from `nmcli connection show --active` + the tunnel device
  • current IP    — real public IP (whatismyip via HTTPS), cached briefly
  • connection time — wall-clock since the tunnel came up
  • traffic stats — real rx/tx byte counters of the tunnel device from psutil
  • kill switch   — root-free: a monitor thread drops the WAN uplinks the moment
                    an armed tunnel disappears, so no cleartext leaks after a drop
  • auto-connect  — nmcli connection.autoconnect on the chosen profile

Where something genuinely cannot be done without root (e.g. an nftables-based
firewall lock), we do NOT fake it — the WAN-down kill switch is the honest,
working, root-free equivalent and is described as such to the UI.
"""
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional

try:
    import psutil
except Exception:
    psutil = None

# Runtime writable storage (works in Development and AppImage)
APP_DATA = Path.home() / ".config" / "Johnny CyberSuite X" / "vpn_profiles"

PROFILES_DIR = APP_DATA
PROFILES_DIR.mkdir(parents=True, exist_ok=True)

PROFILES_FILE = PROFILES_DIR / "profiles.json"

IMPORT_DIR = PROFILES_DIR / "configs"
IMPORT_DIR.mkdir(parents=True, exist_ok=True)

# nmcli connections we create are namespaced so we never touch the user's own
NM_PREFIX = "cs-vpn-"

_NMCLI = shutil.which("nmcli")
_OPENVPN = shutil.which("openvpn")


# ─────────────────────────────────────────────────────────────────────────────
#  low-level nmcli helper
# ─────────────────────────────────────────────────────────────────────────────
def _nm(args: List[str], timeout: float = 30) -> subprocess.CompletedProcess:
    return subprocess.run([_NMCLI, *args], capture_output=True, text=True, timeout=timeout)


def _nm_terse(fields: str, args: List[str], timeout: float = 15) -> List[List[str]]:
    """Run nmcli in terse mode and split each line on unescaped ':'."""
    r = subprocess.run([_NMCLI, "-t", "-f", fields, *args],
                       capture_output=True, text=True, timeout=timeout)
    rows = []
    for line in r.stdout.splitlines():
        if not line:
            continue
        parts = re.split(r"(?<!\\):", line)
        rows.append([p.replace("\\:", ":") for p in parts])
    return rows


def nmcli_available() -> bool:
    return bool(_NMCLI)


# ─────────────────────────────────────────────────────────────────────────────
#  runtime state
# ─────────────────────────────────────────────────────────────────────────────
_state = {
    "active_uuid": None,       # nmcli uuid of the connection we activated
    "active_name": "",         # friendly profile name
    "active_conn": "",         # nmcli connection id (NM_PREFIX + ...)
    "device": None,            # tun/wg device name
    "since": None,             # epoch when connected
    "proto": "",               # openvpn / wireguard
    "base_rx": 0, "base_tx": 0,  # tunnel counters at connect time
}
_state_lock = threading.RLock()

# legacy process-based backends (xray / shadowsocks) kept working
_active_proc = None
_active_proc_name = ""

# kill switch
_ks = {"armed": False, "thread": None, "downed": [], "tripped": False}
_ks_lock = threading.RLock()

# public IP cache
_ip_cache = {"ip": None, "ts": 0.0}


# ─────────────────────────────────────────────────────────────────────────────
#  profiles store  (superset of the old format — stays backward compatible)
# ─────────────────────────────────────────────────────────────────────────────
def load_profiles() -> list:
    if PROFILES_FILE.exists():
        try:
            with open(PROFILES_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return []


def save_profiles(profiles: list):
    with open(PROFILES_FILE, "w") as f:
        json.dump(profiles, f, indent=2)


def add_profile(profile: dict) -> dict:
    profiles = load_profiles()
    profile["id"] = str(uuid.uuid4())
    profiles.append(profile)
    save_profiles(profiles)
    return profile


def delete_profile(profile_id: str) -> bool:
    profiles = load_profiles()
    prof = next((p for p in profiles if p.get("id") == profile_id), None)
    before = len(profiles)
    profiles = [p for p in profiles if p.get("id") != profile_id]
    save_profiles(profiles)
    # clean up any nmcli connection + stored config file this profile owns
    if prof:
        conn = prof.get("nm_conn")
        if conn:
            try:
                _nm(["connection", "delete", conn], timeout=15)
            except Exception:
                pass
        cf = prof.get("config_file", "")
        try:
            if cf and str(IMPORT_DIR) in cf and os.path.exists(cf):
                os.remove(cf)
        except Exception:
            pass
    return len(profiles) < before


# ─────────────────────────────────────────────────────────────────────────────
#  IMPORT — .ovpn / .conf  →  nmcli connection  → saved profile
# ─────────────────────────────────────────────────────────────────────────────
def _detect_kind(path: str, text: str) -> str:
    low = path.lower()
    if low.endswith(".ovpn") or low.endswith(".conf") and "remote " in text and "[Interface]" not in text:
        return "openvpn"
    if low.endswith(".conf") or "[Interface]" in text:
        # a WireGuard config has [Interface] / [Peer]; ovpn does not
        if "[Interface]" in text or "PrivateKey" in text:
            return "wireguard"
        return "openvpn"
    if "[Interface]" in text or "PrivateKey" in text:
        return "wireguard"
    if "remote " in text or "client" in text.split("\n")[0:5]:
        return "openvpn"
    return "unknown"


def _staged_path(kind: str, name: str) -> Path:
    """Pick a staging filename. For WireGuard the file STEM becomes the tunnel
    interface name, so it must be a valid ifname (<=15 chars, [A-Za-z0-9_-])."""
    if kind == "wireguard":
        stem = "wg" + uuid.uuid4().hex[:6]          # e.g. wg1a2b3c  (8 chars)
        return IMPORT_DIR / f"{stem}.conf"
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", name or "vpn")[:40] or "vpn"
    return IMPORT_DIR / f"{safe}-{uuid.uuid4().hex[:8]}.ovpn"


def import_config(filename: str, content: str, name: str = "") -> dict:
    """Import a raw OpenVPN/WireGuard config (uploaded content) via nmcli."""
    if not _NMCLI:
        return {"ok": False, "error": "NetworkManager (nmcli) not available"}
    kind = _detect_kind(filename, content)
    if kind == "unknown":
        return {"ok": False, "error": "Could not detect OpenVPN or WireGuard from this file"}

    dest = _staged_path(kind, name or Path(filename).stem)
    dest.write_text(content)
    try:
        os.chmod(dest, 0o600)
    except Exception:
        pass
    return _import_path(str(dest), kind, name or Path(filename).stem)


def import_path(path: str, name: str = "") -> dict:
    """Import an OpenVPN/WireGuard config already on disk (by absolute path)."""
    if not _NMCLI:
        return {"ok": False, "error": "NetworkManager (nmcli) not available"}
    if not os.path.isfile(path):
        return {"ok": False, "error": f"File not found: {path}"}
    try:
        text = Path(path).read_text(errors="ignore")
    except Exception as e:
        return {"ok": False, "error": f"Cannot read file: {e}"}
    kind = _detect_kind(path, text)
    if kind == "unknown":
        return {"ok": False, "error": "Could not detect OpenVPN or WireGuard from this file"}
    # copy into our store so deleting the profile can clean it up
    dest = _staged_path(kind, name or Path(path).stem)
    try:
        shutil.copyfile(path, dest)
        os.chmod(dest, 0o600)
    except Exception as e:
        return {"ok": False, "error": f"Cannot stage config: {e}"}
    return _import_path(str(dest), kind, name or Path(path).stem)


def _import_path(dest: str, kind: str, name: str) -> dict:
    conn_name = f"{NM_PREFIX}{re.sub(r'[^A-Za-z0-9_.-]', '_', name)[:32]}-{uuid.uuid4().hex[:6]}"
    nm_type = "openvpn" if kind == "openvpn" else "wireguard"
    r = _nm(["connection", "import", "type", nm_type, "file", dest], timeout=30)
    if r.returncode != 0:
        # nmcli sometimes names the connection after the file; capture stderr
        err = (r.stderr or r.stdout or "import failed").strip()
        return {"ok": False, "error": err[:300]}
    # nmcli names the imported connection after the file stem; find its uuid
    imported_id = Path(dest).stem
    uuid_val = _conn_uuid(imported_id)
    # rename to our namespaced id for clean management
    if uuid_val:
        _nm(["connection", "modify", uuid_val, "connection.id", conn_name], timeout=15)
        # don't auto-connect on boot unless the user turns it on
        _nm(["connection", "modify", uuid_val, "connection.autoconnect", "no"], timeout=15)
    else:
        conn_name = imported_id

    prof = add_profile({
        "name": name,
        "protocol": nm_type,
        "config_file": dest,
        "nm_conn": conn_name,
        "nm_uuid": uuid_val or "",
        "source": "import",
    })
    return {"ok": True, "profile": prof, "protocol": nm_type}


def _conn_uuid(conn_id: str) -> Optional[str]:
    for row in _nm_terse("NAME,UUID", ["connection", "show"]):
        if len(row) >= 2 and row[0] == conn_id:
            return row[1]
    return None


# ─────────────────────────────────────────────────────────────────────────────
#  CONNECT / DISCONNECT
# ─────────────────────────────────────────────────────────────────────────────
def connect(profile: dict) -> dict:
    """Connect a saved profile. nmcli-backed profiles (import) activate the
    NM connection; legacy xray/shadowsocks profiles spawn their process."""
    proto = (profile.get("protocol") or "").lower()

    if profile.get("nm_conn") or proto in ("openvpn", "wireguard"):
        return _nm_connect(profile)

    # legacy process backends (shadowsocks / vless / trojan) — unchanged behavior
    return _proc_connect(profile)


def _nm_connect(profile: dict) -> dict:
    if not _NMCLI:
        return {"ok": False, "error": "nmcli not available"}
    conn = profile.get("nm_conn") or profile.get("nm_uuid")
    if not conn:
        return {"ok": False, "error": "profile has no NetworkManager connection"}
    # bring down anything we previously started
    disconnect(_keep_killswitch=True)

    r = _nm(["connection", "up", conn], timeout=45)
    if r.returncode != 0:
        return {"ok": False, "error": (r.stderr or r.stdout or "activation failed").strip()[:300]}

    dev = _active_tun_device(conn)
    rx, tx = _dev_counters(dev)
    with _state_lock:
        _state.update(
            active_uuid=profile.get("nm_uuid") or _conn_uuid(conn) or conn,
            active_name=profile.get("name", "VPN"),
            active_conn=conn,
            device=dev,
            since=time.time(),
            proto=(profile.get("protocol") or "").lower(),
            base_rx=rx, base_tx=tx,
        )
    _ip_cache["ts"] = 0.0  # force IP refresh
    return {"ok": True, "device": dev, "connection": conn}


def _proc_connect(profile: dict) -> dict:
    global _active_proc, _active_proc_name
    import tempfile
    disconnect(_keep_killswitch=True)
    proto = profile.get("protocol", "").lower()
    try:
        if proto == "shadowsocks":
            cmd = ["ss-local", "-s", profile["server"], "-p", str(profile["port"]),
                   "-k", profile["password"], "-m", profile.get("method", "aes-256-gcm"),
                   "-l", str(profile.get("local_port", 1080))]
        elif proto in ("vless", "trojan"):
            cfg = _build_xray_cfg(proto, profile)
            tf = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
            json.dump(cfg, tf); tf.close()
            cmd = ["xray", "run", "-c", tf.name]
        else:
            return {"ok": False, "error": f"Unknown protocol: {proto}"}
        _active_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _active_proc_name = profile.get("name", "VPN")
        with _state_lock:
            _state.update(active_name=_active_proc_name, since=time.time(),
                          proto=proto, device=None, active_conn="", active_uuid=None,
                          base_rx=0, base_tx=0)
        return {"ok": True, "pid": _active_proc.pid}
    except FileNotFoundError as e:
        return {"ok": False, "error": f"binary not installed: {e.filename}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def disconnect(_keep_killswitch: bool = False) -> dict:
    global _active_proc, _active_proc_name
    # disarm kill switch on an explicit user disconnect so WAN isn't downed
    if not _keep_killswitch:
        killswitch(False)

    with _state_lock:
        conn = _state.get("active_conn")
    if conn and _NMCLI:
        try:
            _nm(["connection", "down", conn], timeout=30)
        except Exception:
            pass

    if _active_proc:
        try:
            _active_proc.terminate()
        except Exception:
            pass
        _active_proc = None
        _active_proc_name = ""

    with _state_lock:
        _state.update(active_uuid=None, active_name="", active_conn="",
                      device=None, since=None, proto="", base_rx=0, base_tx=0)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
#  STATUS  /  IP  /  TRAFFIC
# ─────────────────────────────────────────────────────────────────────────────
def _active_connections() -> List[Dict]:
    out = []
    for row in _nm_terse("NAME,TYPE,DEVICE,STATE", ["connection", "show", "--active"]):
        if len(row) >= 4:
            out.append({"name": row[0], "type": row[1], "device": row[2], "state": row[3]})
    return out


def _active_tun_device(conn: str) -> Optional[str]:
    for c in _active_connections():
        if c["name"] == conn:
            return c["device"] or None
    # fall back: newest tun/wireguard device
    for c in _active_connections():
        if c["type"] in ("tun", "wireguard") and c["device"]:
            return c["device"]
    return None


def _dev_counters(dev: Optional[str]):
    if not dev or not psutil:
        return 0, 0
    try:
        io = psutil.net_io_counters(pernic=True).get(dev)
        if io:
            return io.bytes_recv, io.bytes_sent
    except Exception:
        pass
    return 0, 0


def _is_active() -> bool:
    with _state_lock:
        conn = _state.get("active_conn")
        proc_name = _state.get("active_name")
        proto = _state.get("proto")
    if conn and _NMCLI:
        for c in _active_connections():
            if c["name"] == conn and c["state"] == "activated":
                return True
        return False
    # legacy proc backend
    return bool(_active_proc and _active_proc.poll() is None)


def get_status() -> dict:
    """Rich live status used by the VPN Center."""
    active = _is_active()
    with _state_lock:
        s = dict(_state)

    if not active:
        # tunnel is gone — if kill switch armed and it dropped unexpectedly, note it
        return {
            "connected": False, "name": "", "protocol": "",
            "device": None, "since": None, "duration": 0,
            "killswitch": _ks["armed"], "killswitch_tripped": _ks["tripped"],
            "rx": 0, "tx": 0, "rx_rate": 0, "tx_rate": 0,
            "engine": "nmcli" if _NMCLI else "proc",
        }

    dev = s.get("device")
    rx, tx = _dev_counters(dev)
    since = s.get("since") or time.time()
    dur = int(time.time() - since)
    total_rx = max(0, rx - s.get("base_rx", 0)) if dev else 0
    total_tx = max(0, tx - s.get("base_tx", 0)) if dev else 0
    return {
        "connected": True,
        "name": s.get("active_name", "VPN"),
        "protocol": s.get("proto", ""),
        "device": dev,
        "since": since,
        "duration": dur,
        "killswitch": _ks["armed"],
        "killswitch_tripped": _ks["tripped"],
        "rx": total_rx, "tx": total_tx,
        "engine": "nmcli" if s.get("active_conn") else "proc",
    }


def get_traffic() -> dict:
    """Instantaneous tunnel throughput (bytes/s) + cumulative since connect."""
    with _state_lock:
        dev = _state.get("device")
        base_rx = _state.get("base_rx", 0)
        base_tx = _state.get("base_tx", 0)
    if not dev or not _is_active():
        return {"connected": False, "rx": 0, "tx": 0, "rx_rate": 0, "tx_rate": 0, "device": None}
    rx, tx = _dev_counters(dev)
    now = time.time()
    prev = get_traffic._prev.get(dev)
    rate_rx = rate_tx = 0.0
    if prev and now > prev[0]:
        dt = now - prev[0]
        rate_rx = max(0, (rx - prev[1]) / dt)
        rate_tx = max(0, (tx - prev[2]) / dt)
    get_traffic._prev[dev] = (now, rx, tx)
    return {
        "connected": True, "device": dev,
        "rx": max(0, rx - base_rx), "tx": max(0, tx - base_tx),
        "rx_rate": round(rate_rx, 1), "tx_rate": round(rate_tx, 1),
    }


get_traffic._prev = {}


def get_public_ip(force: bool = False) -> dict:
    now = time.time()
    if not force and _ip_cache["ip"] and now - _ip_cache["ts"] < 20:
        return {"ip": _ip_cache["ip"], "cached": True}
    ip = None
    for url in ("https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"):
        try:
            import urllib.request
            req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
            ip = urllib.request.urlopen(req, timeout=6).read().decode().strip()
            if ip:
                break
        except Exception:
            continue
    if ip:
        _ip_cache.update(ip=ip, ts=now)
    return {"ip": ip or _ip_cache["ip"], "cached": False}


# ─────────────────────────────────────────────────────────────────────────────
#  KILL SWITCH  (root-free: down the WAN uplinks if an armed tunnel drops)
# ─────────────────────────────────────────────────────────────────────────────
def _wan_connections() -> List[str]:
    """Active ethernet/wifi connections that carry the default route."""
    wans = []
    for c in _active_connections():
        if c["type"] in ("802-3-ethernet", "802-11-wireless") and c["state"] == "activated":
            wans.append(c["name"])
    return wans


def killswitch(enable: bool) -> dict:
    with _ks_lock:
        if enable:
            if _ks["armed"]:
                return {"ok": True, "armed": True}
            _ks["armed"] = True
            _ks["tripped"] = False
            t = threading.Thread(target=_ks_monitor, daemon=True)
            _ks["thread"] = t
            t.start()
            return {"ok": True, "armed": True, "mode": "wan-drop"}
        else:
            _ks["armed"] = False
            # bring back any uplinks we took down
            restored = []
            for name in _ks.get("downed", []):
                try:
                    _nm(["connection", "up", name], timeout=30)
                    restored.append(name)
                except Exception:
                    pass
            _ks["downed"] = []
            _ks["tripped"] = False
            return {"ok": True, "armed": False, "restored": restored}


def killswitch_status() -> dict:
    return {"armed": _ks["armed"], "tripped": _ks["tripped"], "downed": list(_ks.get("downed", []))}


def _ks_monitor():
    """While armed: once a tunnel has been up, if it disappears, drop WAN uplinks
    so no traffic leaks over the cleartext path. Disarming restores them."""
    seen_up = False
    while True:
        with _ks_lock:
            if not _ks["armed"]:
                return
        up = _is_active()
        if up:
            seen_up = True
        elif seen_up:
            # tunnel dropped while armed → engage
            with _ks_lock:
                if not _ks["armed"]:
                    return
                if not _ks["tripped"]:
                    downed = []
                    for name in _wan_connections():
                        try:
                            _nm(["connection", "down", name], timeout=20)
                            downed.append(name)
                        except Exception:
                            pass
                    _ks["downed"] = downed
                    _ks["tripped"] = True
            # keep holding until disarmed
        time.sleep(2)


# ─────────────────────────────────────────────────────────────────────────────
#  AUTO-CONNECT
# ─────────────────────────────────────────────────────────────────────────────
def set_autoconnect(profile_id: str, enable: bool) -> dict:
    profiles = load_profiles()
    prof = next((p for p in profiles if p.get("id") == profile_id), None)
    if not prof:
        return {"ok": False, "error": "profile not found"}
    conn = prof.get("nm_conn") or prof.get("nm_uuid")
    if conn and _NMCLI:
        r = _nm(["connection", "modify", conn, "connection.autoconnect",
                 "yes" if enable else "no"], timeout=15)
        if r.returncode != 0:
            return {"ok": False, "error": (r.stderr or r.stdout).strip()[:200]}
    # clear the flag on all others so exactly one is the auto profile
    for p in profiles:
        p["autoconnect"] = bool(enable and p.get("id") == profile_id)
        if enable and p.get("id") != profile_id:
            other = p.get("nm_conn") or p.get("nm_uuid")
            if other and _NMCLI:
                try:
                    _nm(["connection", "modify", other, "connection.autoconnect", "no"], timeout=10)
                except Exception:
                    pass
    save_profiles(profiles)
    return {"ok": True, "autoconnect": enable, "profile_id": profile_id}


def get_autoconnect() -> dict:
    for p in load_profiles():
        if p.get("autoconnect"):
            return {"enabled": True, "profile_id": p["id"], "name": p.get("name", "")}
    return {"enabled": False, "profile_id": None, "name": ""}


# ─────────────────────────────────────────────────────────────────────────────
#  xray config builder (unchanged from the original)
# ─────────────────────────────────────────────────────────────────────────────
def _build_xray_cfg(proto, p):
    out = {"protocol": proto}
    if proto == "vless":
        out["settings"] = {"vnext": [{"address": p["server"], "port": int(p["port"]),
            "users": [{"id": p["uuid"], "encryption": "none"}]}]}
        out["streamSettings"] = {"network": p.get("network", "ws"), "security": p.get("security", "tls"),
            "tlsSettings": {"serverName": p.get("sni", "")}, "wsSettings": {"path": p.get("path", "/")}}
    elif proto == "trojan":
        out["settings"] = {"servers": [{"address": p["server"], "port": int(p["port"]), "password": p["password"]}]}
        out["streamSettings"] = {"network": "tcp", "security": "tls", "tlsSettings": {"serverName": p.get("sni", "")}}
    return {"inbounds": [{"port": 1080, "protocol": "socks", "settings": {"auth": "noauth", "udp": True}}],
            "outbounds": [out]}
