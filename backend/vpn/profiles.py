import json, os, subprocess, tempfile
from pathlib import Path

PROFILES_DIR = Path(__file__).parent.parent / "storage" / "vpn_profiles"
PROFILES_DIR.mkdir(parents=True, exist_ok=True)
PROFILES_FILE = PROFILES_DIR / "profiles.json"

_active_proc = None
_active_name = ""

def load_profiles() -> list:
    if PROFILES_FILE.exists():
        try:
            with open(PROFILES_FILE) as f: return json.load(f)
        except: pass
    return []

def save_profiles(profiles: list):
    with open(PROFILES_FILE, "w") as f: json.dump(profiles, f, indent=2)

def add_profile(profile: dict) -> dict:
    profiles = load_profiles()
    import uuid
    profile["id"] = str(uuid.uuid4())
    profiles.append(profile)
    save_profiles(profiles)
    return profile

def delete_profile(profile_id: str) -> bool:
    profiles = load_profiles()
    before = len(profiles)
    profiles = [p for p in profiles if p.get("id") != profile_id]
    save_profiles(profiles)
    return len(profiles) < before

def get_status() -> dict:
    global _active_proc, _active_name
    if _active_proc and _active_proc.poll() is None:
        return {"connected": True, "name": _active_name, "pid": _active_proc.pid}
    return {"connected": False, "name": "", "pid": None}

def connect(profile: dict) -> dict:
    global _active_proc, _active_name
    disconnect()
    proto = profile.get("protocol","").lower()
    try:
        if proto == "shadowsocks":
            cmd = ["ss-local","-s",profile["server"],"-p",str(profile["port"]),
                   "-k",profile["password"],"-m",profile.get("method","aes-256-gcm"),
                   "-l",str(profile.get("local_port",1080))]
        elif proto == "openvpn":
            cmd = ["sudo","openvpn","--config", profile["config_file"]]
        elif proto in ("vless","trojan"):
            cfg = _build_xray_cfg(proto, profile)
            tf  = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
            json.dump(cfg, tf); tf.close()
            cmd = ["xray","run","-c", tf.name]
        else:
            return {"ok": False, "error": f"Unknown protocol: {proto}"}
        _active_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _active_name = profile.get("name","VPN")
        return {"ok": True, "pid": _active_proc.pid}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def disconnect() -> dict:
    global _active_proc, _active_name
    if _active_proc:
        try: _active_proc.terminate()
        except: pass
        _active_proc = None; _active_name = ""
    return {"ok": True}

def _build_xray_cfg(proto, p):
    out = {"protocol": proto}
    if proto == "vless":
        out["settings"] = {"vnext":[{"address":p["server"],"port":int(p["port"]),
            "users":[{"id":p["uuid"],"encryption":"none"}]}]}
        out["streamSettings"] = {"network":p.get("network","ws"),"security":p.get("security","tls"),
            "tlsSettings":{"serverName":p.get("sni","")},"wsSettings":{"path":p.get("path","/")}}
    elif proto == "trojan":
        out["settings"] = {"servers":[{"address":p["server"],"port":int(p["port"]),"password":p["password"]}]}
        out["streamSettings"] = {"network":"tcp","security":"tls","tlsSettings":{"serverName":p.get("sni","")}}
    return {"inbounds":[{"port":1080,"protocol":"socks","settings":{"auth":"noauth","udp":True}}],
            "outbounds":[out]}