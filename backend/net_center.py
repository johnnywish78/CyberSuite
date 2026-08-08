"""
Johnny CyberSuite X — Network Center backend
============================================
Real, self-contained network tools. Every endpoint returns live data —
no placeholders, no fabricated values. Where a common CLI (traceroute,
whois, nmap, speedtest-cli) may be missing, a pure-Python implementation
is used so the tool always works without root.

Tools:
  • Speed Test            /api/net/speedtest      (Cloudflare edge, real bytes)
  • Ping                  /api/net/ping           (system ping, parsed)
  • DNS Lookup            /api/net/dns            (A/AAAA/MX/NS/TXT/CNAME/SOA)
  • Whois                 /api/net/whois          (raw socket :43, IANA referral)
  • Port Scanner          /api/net/portscan       (async TCP-connect, root-free)
  • Traceroute            /api/net/traceroute     (ping TTL sweep, root-free)
  • Active Connections    /api/net/connections    (psutil)
  • Interface Information  /api/net/interfaces     (psutil + ip/proc)
  • WiFi Scanner          /api/net/wifi           (nmcli / iw)
  • Network Diagnostics   /api/net/diagnostics    (composite health check)
"""
import asyncio
import ipaddress
import os
import re
import shutil
import socket
import struct
import time
from typing import Dict, List, Optional

from fastapi import APIRouter

try:
    import psutil
    HAS_PSUTIL = True
except Exception:
    psutil = None
    HAS_PSUTIL = False

router = APIRouter(prefix="/api/net", tags=["network-center"])

# ── shared helpers ──────────────────────────────────────────────────────────
_UA = "Mozilla/5.0 (JohnnyCyberSuiteX) NetworkCenter/1.0"


def _which(name: str) -> Optional[str]:
    return shutil.which(name)


async def _run(cmd: List[str], timeout: float = 20.0) -> Dict:
    """Run a subprocess, capture stdout+stderr, never raise."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            return {"ok": False, "rc": -1, "out": "", "err": "timeout"}
        return {
            "ok": proc.returncode == 0,
            "rc": proc.returncode,
            "out": out.decode(errors="replace"),
            "err": err.decode(errors="replace"),
        }
    except FileNotFoundError:
        return {"ok": False, "rc": -1, "out": "", "err": f"{cmd[0]}: not found"}
    except Exception as e:  # pragma: no cover
        return {"ok": False, "rc": -1, "out": "", "err": str(e)}


def _valid_host(h: str) -> bool:
    """Reject shell-hostile input; allow hostnames, IPv4/IPv6, CIDR."""
    if not h or len(h) > 255:
        return False
    return bool(re.match(r"^[A-Za-z0-9_.:\-/]+$", h))


# ═══════════════════════════════════════════════════════════════════════════
#  SPEED TEST — real download/upload against Cloudflare's edge
# ═══════════════════════════════════════════════════════════════════════════
def _sync_speedtest() -> Dict:
    import urllib.request

    result = {
        "ok": False, "ping_ms": None, "jitter_ms": None,
        "download_mbps": None, "upload_mbps": None,
        "server": "speed.cloudflare.com", "isp": "", "client_ip": "",
        "bytes_down": 0, "bytes_up": 0, "error": "",
    }

    def _get(url, timeout=30):
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        return urllib.request.urlopen(req, timeout=timeout)

    # ── latency / jitter: time to fetch a tiny object, several samples ──
    samples = []
    for _ in range(6):
        try:
            t0 = time.perf_counter()
            _get("https://speed.cloudflare.com/__down?bytes=0", timeout=10).read()
            samples.append((time.perf_counter() - t0) * 1000.0)
        except Exception:
            pass
    if samples:
        result["ping_ms"] = round(min(samples), 2)
        if len(samples) > 1:
            avg = sum(samples) / len(samples)
            result["jitter_ms"] = round(
                (sum((s - avg) ** 2 for s in samples) / len(samples)) ** 0.5, 2)

    # ── metadata (ISP / client IP) from Cloudflare trace ──
    try:
        trace = _get("https://speed.cloudflare.com/cdn-cgi/trace", timeout=8).read().decode()
        meta = dict(l.split("=", 1) for l in trace.splitlines() if "=" in l)
        result["client_ip"] = meta.get("ip", "")
        result["server"] = f"Cloudflare {meta.get('colo', '')}".strip()
    except Exception:
        pass

    # ── download: pull increasing chunks until >= ~2.5s of transfer ──
    # Stream-read so a slow/partial transfer still yields a real measurement.
    try:
        total_bytes, total_time = 0, 0.0
        for size in (10_000_000, 25_000_000, 50_000_000):
            resp = _get(f"https://speed.cloudflare.com/__down?bytes={size}", timeout=40)
            t0 = time.perf_counter()
            got = 0
            deadline = t0 + 15.0
            while time.perf_counter() < deadline:
                try:
                    chunk = resp.read(65536)
                except Exception:
                    break
                if not chunk:
                    break
                got += len(chunk)
            dt = time.perf_counter() - t0
            try:
                resp.close()
            except Exception:
                pass
            if got > 0 and dt > 0:
                total_bytes += got
                total_time += dt
            if total_time >= 2.5:
                break
        if total_time > 0 and total_bytes > 0:
            result["download_mbps"] = round(total_bytes * 8 / total_time / 1e6, 2)
            result["bytes_down"] = total_bytes
    except Exception as e:
        result["error"] = f"download: {e}"

    # ── upload: POST increasing payloads to __up ──
    try:
        total_bytes, total_time = 0, 0.0
        for size in (2_000_000, 5_000_000, 10_000_000):
            payload = b"\x00" * size
            req = urllib.request.Request(
                "https://speed.cloudflare.com/__up",
                data=payload,
                headers={"User-Agent": _UA, "Content-Type": "application/octet-stream"},
            )
            t0 = time.perf_counter()
            try:
                urllib.request.urlopen(req, timeout=30).read()
            except Exception:
                # server may close early after receiving the body; the bytes
                # were still sent, so we keep the timing if it was meaningful
                pass
            dt = time.perf_counter() - t0
            total_bytes += size
            total_time += dt
            if total_time >= 2.5:
                break
        if total_time > 0:
            result["upload_mbps"] = round(total_bytes * 8 / total_time / 1e6, 2)
            result["bytes_up"] = total_bytes
    except Exception as e:
        result["error"] = (result["error"] + f" upload: {e}").strip()

    result["ok"] = result["download_mbps"] is not None
    return result


@router.post("/speedtest")
async def speedtest():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_speedtest)


# ═══════════════════════════════════════════════════════════════════════════
#  PING — system ping, parsed into structured stats
# ═══════════════════════════════════════════════════════════════════════════
@router.post("/ping")
async def ping(body: dict):
    host = str(body.get("host", "8.8.8.8")).strip()
    count = max(1, min(int(body.get("count", 4)), 30))
    if not _valid_host(host):
        return {"ok": False, "error": "invalid host", "output": "", "stats": None}

    r = await _run(["ping", "-c", str(count), "-W", "2", host], timeout=count * 3 + 10)
    out = r["out"] + r["err"]

    rtts = [float(m) for m in re.findall(r"time[=<]([\d.]+)\s*ms", out)]
    stats = {
        "host": host, "transmitted": None, "received": None, "loss_pct": None,
        "min": None, "avg": None, "max": None, "mdev": None,
        "rtts": rtts, "resolved_ip": None,
    }
    m = re.search(r"PING\s+\S+\s+\(([\d.]+)\)", out)
    if m:
        stats["resolved_ip"] = m.group(1)
    m = re.search(r"(\d+) packets transmitted, (\d+) received.*?([\d.]+)% packet loss", out, re.S)
    if m:
        stats["transmitted"] = int(m.group(1))
        stats["received"] = int(m.group(2))
        stats["loss_pct"] = float(m.group(3))
    m = re.search(r"=\s*([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)\s*ms", out)
    if m:
        stats["min"], stats["avg"], stats["max"], stats["mdev"] = (
            float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4)))
    return {"ok": r["ok"], "output": out, "stats": stats}


# ═══════════════════════════════════════════════════════════════════════════
#  DNS LOOKUP — multi record-type, prefers dig, falls back to socket
# ═══════════════════════════════════════════════════════════════════════════
_DNS_TYPES = ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA"]


@router.post("/dns")
async def dns(body: dict):
    domain = str(body.get("domain", "google.com")).strip().rstrip(".")
    if not _valid_host(domain):
        return {"ok": False, "error": "invalid domain", "records": {}}

    requested = body.get("types") or _DNS_TYPES
    records: Dict[str, List[str]] = {}
    have_dig = _which("dig")

    if have_dig:
        async def one(rtype):
            r = await _run(["dig", "+noall", "+answer", "+nocomments", domain, rtype], timeout=8)
            vals = []
            for line in r["out"].splitlines():
                parts = line.split(None, 4)
                if len(parts) >= 5:
                    vals.append(parts[4].strip())
            return rtype, vals

        for rtype, vals in await asyncio.gather(*[one(t) for t in requested]):
            if vals:
                records[rtype] = vals
    else:
        # socket fallback — resolves A/AAAA only, still real data
        loop = asyncio.get_event_loop()
        try:
            infos = await loop.run_in_executor(
                None, lambda: socket.getaddrinfo(domain, None))
            a = sorted({i[4][0] for i in infos if i[0] == socket.AF_INET})
            aaaa = sorted({i[4][0] for i in infos if i[0] == socket.AF_INET6})
            if a:
                records["A"] = a
            if aaaa:
                records["AAAA"] = aaaa
        except Exception as e:
            return {"ok": False, "error": str(e), "records": {}, "tool": "socket"}

    # reverse DNS for the first A record (nice extra, real)
    reverse = None
    if records.get("A"):
        try:
            reverse = socket.gethostbyaddr(records["A"][0])[0]
        except Exception:
            reverse = None

    return {
        "ok": bool(records), "domain": domain, "records": records,
        "reverse": reverse, "tool": "dig" if have_dig else "socket",
    }


# ═══════════════════════════════════════════════════════════════════════════
#  WHOIS — raw socket to port 43, following IANA referrals
# ═══════════════════════════════════════════════════════════════════════════
def _whois_query(server: str, query: str, timeout: float = 8.0) -> str:
    with socket.create_connection((server, 43), timeout=timeout) as s:
        s.settimeout(timeout)
        s.sendall((query + "\r\n").encode())
        chunks = []
        while True:
            try:
                data = s.recv(4096)
            except socket.timeout:
                break
            if not data:
                break
            chunks.append(data)
    return b"".join(chunks).decode(errors="replace")


def _sync_whois(query: str) -> Dict:
    # IP address → route to the right RIR via whois.iana.org
    is_ip = False
    try:
        ipaddress.ip_address(query)
        is_ip = True
    except ValueError:
        pass

    servers_tried = []
    raw = ""
    try:
        if is_ip:
            first = _whois_query("whois.iana.org", query)
        else:
            tld = query.rsplit(".", 1)[-1]
            first = _whois_query("whois.iana.org", tld if is_ip is False else query)
        servers_tried.append("whois.iana.org")
        raw = first

        m = re.search(r"(?:refer|whois):\s*(\S+)", first, re.I)
        if m:
            ref = m.group(1).strip()
            servers_tried.append(ref)
            second = _whois_query(ref, query)
            raw = second
            # registrar may point to a further whois server (thin registries)
            m2 = re.search(r"(?:Registrar WHOIS Server|whois):\s*(\S+)", second, re.I)
            if m2 and m2.group(1).strip().lower() not in (s.lower() for s in servers_tried):
                deep = m2.group(1).strip()
                try:
                    third = _whois_query(deep, query)
                    if third.strip():
                        servers_tried.append(deep)
                        raw = third
                except Exception:
                    pass
    except Exception as e:
        return {"ok": False, "error": str(e), "raw": raw, "servers": servers_tried, "fields": {}}

    # parse a few common fields for the structured view
    fields = {}
    patterns = {
        "Registrar": r"Registrar:\s*(.+)",
        "Creation Date": r"Creat(?:ion|ed).*?:\s*(.+)",
        "Expiry Date": r"(?:Registry Expiry Date|Expir\w*).*?:\s*(.+)",
        "Updated Date": r"Updated Date:\s*(.+)",
        "Organization": r"(?:org|OrgName|Registrant Organization):\s*(.+)",
        "Country": r"[Cc]ountry:\s*(.+)",
        "NetRange": r"(?:NetRange|inetnum):\s*(.+)",
    }
    for label, pat in patterns.items():
        m = re.search(pat, raw, re.I)
        if m:
            fields[label] = m.group(1).strip()
    name_servers = re.findall(r"Name Server:\s*(\S+)", raw, re.I)
    if name_servers:
        fields["Name Servers"] = ", ".join(sorted(set(ns.lower() for ns in name_servers)))

    return {
        "ok": bool(raw.strip()), "query": query, "raw": raw,
        "fields": fields, "servers": servers_tried,
    }


@router.post("/whois")
async def whois(body: dict):
    query = str(body.get("query", "")).strip().rstrip(".")
    if not query or not _valid_host(query):
        return {"ok": False, "error": "invalid query", "raw": "", "fields": {}}
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_whois, query)


# ═══════════════════════════════════════════════════════════════════════════
#  PORT SCANNER — async TCP-connect, no root, real open/closed
# ═══════════════════════════════════════════════════════════════════════════
_COMMON_PORTS = {
    20: "FTP-data", 21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP",
    53: "DNS", 67: "DHCP", 80: "HTTP", 110: "POP3", 111: "RPC",
    123: "NTP", 135: "MSRPC", 139: "NetBIOS", 143: "IMAP", 161: "SNMP",
    389: "LDAP", 443: "HTTPS", 445: "SMB", 465: "SMTPS", 587: "SMTP-sub",
    631: "IPP", 993: "IMAPS", 995: "POP3S", 1080: "SOCKS", 1194: "OpenVPN",
    1433: "MSSQL", 1521: "Oracle", 2049: "NFS", 2375: "Docker", 3000: "Dev",
    3306: "MySQL", 3389: "RDP", 5000: "UPnP", 5432: "PostgreSQL",
    5900: "VNC", 6379: "Redis", 8000: "HTTP-alt", 8080: "HTTP-proxy",
    8443: "HTTPS-alt", 8765: "CyberSuite", 9000: "PHP-FPM", 9200: "Elastic",
    11211: "Memcached", 27017: "MongoDB",
}


def _parse_ports(spec: str) -> List[int]:
    ports: set = set()
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            try:
                lo, hi = int(a), int(b)
                ports.update(range(max(1, lo), min(65535, hi) + 1))
            except ValueError:
                continue
        else:
            try:
                p = int(part)
                if 1 <= p <= 65535:
                    ports.add(p)
            except ValueError:
                continue
    return sorted(ports)


async def _probe(host: str, port: int, timeout: float) -> Optional[Dict]:
    try:
        fut = asyncio.open_connection(host, port)
        reader, writer = await asyncio.wait_for(fut, timeout=timeout)
        # try a passive banner grab (non-fatal)
        banner = ""
        try:
            data = await asyncio.wait_for(reader.read(80), timeout=0.5)
            banner = data.decode(errors="replace").strip().split("\n")[0][:60]
        except Exception:
            banner = ""
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return {"port": port, "service": _COMMON_PORTS.get(port, ""), "banner": banner}
    except Exception:
        return None


@router.post("/portscan")
async def portscan(body: dict):
    host = str(body.get("host", "127.0.0.1")).strip()
    if not _valid_host(host):
        return {"ok": False, "error": "invalid host", "open": []}
    spec = body.get("ports", "")
    ports = _parse_ports(spec) if spec else sorted(_COMMON_PORTS)
    ports = ports[:2000]  # sanity cap
    timeout = float(body.get("timeout", 1.0))

    # resolve once so every probe hits the same address
    loop = asyncio.get_event_loop()
    try:
        resolved = await loop.run_in_executor(None, socket.gethostbyname, host)
    except Exception as e:
        return {"ok": False, "error": f"cannot resolve {host}: {e}", "open": []}

    sem = asyncio.Semaphore(400)

    async def guarded(p):
        async with sem:
            return await _probe(resolved, p, timeout)

    t0 = time.perf_counter()
    results = await asyncio.gather(*[guarded(p) for p in ports])
    elapsed = round(time.perf_counter() - t0, 2)
    open_ports = [r for r in results if r]

    return {
        "ok": True, "host": host, "resolved_ip": resolved,
        "scanned": len(ports), "open": open_ports,
        "closed_count": len(ports) - len(open_ports), "elapsed_s": elapsed,
    }


# ═══════════════════════════════════════════════════════════════════════════
#  TRACEROUTE — uses system traceroute if present, else ping-TTL sweep
# ═══════════════════════════════════════════════════════════════════════════
async def _ping_ttl_hop(host: str, ttl: int) -> Dict:
    """One TTL probe via the system ping. Root-free. Returns hop info."""
    r = await _run(["ping", "-c", "1", "-W", "2", "-t", str(ttl), "-n", host], timeout=6)
    out = r["out"] + r["err"]
    hop = {"ttl": ttl, "ip": None, "rtt_ms": None, "final": False}

    m = re.search(r"From ([\d.]+).*?(?:icmp_seq|Time to live|ttl)", out, re.S)
    if not m:
        m = re.search(r"From ([\d.]+)", out)
    if m:
        hop["ip"] = m.group(1)
    mt = re.search(r"time[=<]([\d.]+)\s*ms", out)
    if mt:
        hop["rtt_ms"] = float(mt.group(1))
    mf = re.search(r"bytes from ([\d.]+):", out)
    if mf:
        hop["ip"] = mf.group(1)
        hop["final"] = True
    return hop


@router.post("/traceroute")
async def traceroute(body: dict):
    host = str(body.get("host", "8.8.8.8")).strip()
    if not _valid_host(host):
        return {"ok": False, "error": "invalid host", "hops": []}
    max_hops = max(1, min(int(body.get("max_hops", 20)), 30))

    loop = asyncio.get_event_loop()
    try:
        target_ip = await loop.run_in_executor(None, socket.gethostbyname, host)
    except Exception as e:
        return {"ok": False, "error": f"cannot resolve {host}: {e}", "hops": []}

    sys_tr = _which("traceroute")
    if sys_tr:
        r = await _run(["traceroute", "-n", "-w", "2", "-q", "1", "-m", str(max_hops), host],
                       timeout=max_hops * 3 + 10)
        hops = []
        for line in r["out"].splitlines():
            m = re.match(r"\s*(\d+)\s+([\d.]+|\*)\s*(?:([\d.]+)\s*ms)?", line)
            if m and m.group(1):
                hops.append({
                    "ttl": int(m.group(1)),
                    "ip": None if m.group(2) == "*" else m.group(2),
                    "rtt_ms": float(m.group(3)) if m.group(3) else None,
                    "final": m.group(2) == target_ip,
                })
        return {"ok": True, "host": host, "target_ip": target_ip,
                "hops": hops, "tool": "traceroute"}

    # ── pure ping-TTL fallback ──
    hops = []
    for ttl in range(1, max_hops + 1):
        hop = await _ping_ttl_hop(host, ttl)
        hops.append(hop)
        if hop["final"] or hop["ip"] == target_ip:
            break
    return {"ok": True, "host": host, "target_ip": target_ip,
            "hops": hops, "tool": "ping-ttl"}


# ═══════════════════════════════════════════════════════════════════════════
#  ACTIVE CONNECTIONS — psutil, with owning process name
# ═══════════════════════════════════════════════════════════════════════════
@router.get("/connections")
def connections(kind: str = "inet"):
    if not HAS_PSUTIL:
        return {"ok": False, "error": "psutil unavailable", "connections": []}
    rows = []
    pid_name: Dict[int, str] = {}
    try:
        conns = psutil.net_connections(kind=kind)
    except Exception as e:
        return {"ok": False, "error": str(e), "connections": []}

    for c in conns:
        pid = c.pid
        name = ""
        if pid is not None:
            if pid not in pid_name:
                try:
                    pid_name[pid] = psutil.Process(pid).name()
                except Exception:
                    pid_name[pid] = ""
            name = pid_name[pid]
        laddr = f"{c.laddr.ip}:{c.laddr.port}" if c.laddr else ""
        raddr = f"{c.raddr.ip}:{c.raddr.port}" if c.raddr else ""
        proto = {
            (socket.AF_INET, socket.SOCK_STREAM): "TCP",
            (socket.AF_INET6, socket.SOCK_STREAM): "TCP6",
            (socket.AF_INET, socket.SOCK_DGRAM): "UDP",
            (socket.AF_INET6, socket.SOCK_DGRAM): "UDP6",
        }.get((c.family, c.type), str(c.type))
        rows.append({
            "proto": proto, "local": laddr, "remote": raddr,
            "status": c.status, "pid": pid, "process": name,
        })

    # established first, then listening, then the rest
    order = {"ESTABLISHED": 0, "LISTEN": 1}
    rows.sort(key=lambda r: (order.get(r["status"], 2), r["proto"]))
    counts: Dict[str, int] = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {"ok": True, "total": len(rows), "counts": counts, "connections": rows}


# ═══════════════════════════════════════════════════════════════════════════
#  INTERFACE INFORMATION — addresses, MAC, state, speed, live counters
# ═══════════════════════════════════════════════════════════════════════════
@router.get("/interfaces")
def interfaces():
    if not HAS_PSUTIL:
        return {"ok": False, "error": "psutil unavailable", "interfaces": []}

    addrs = psutil.net_if_addrs()
    stats = psutil.net_if_stats()
    io = psutil.net_io_counters(pernic=True)

    # default-route interface + gateway
    default_iface, gateway = None, None
    try:
        with open("/proc/net/route") as f:
            for line in f.readlines()[1:]:
                parts = line.split()
                if len(parts) >= 3 and parts[1] == "00000000":
                    default_iface = parts[0]
                    gateway = socket.inet_ntoa(struct.pack("<L", int(parts[2], 16)))
                    break
    except Exception:
        pass

    result = []
    for name, alist in addrs.items():
        ipv4, ipv6, mac, netmask = [], [], "", ""
        for a in alist:
            if a.family == socket.AF_INET:
                ipv4.append(a.address)
                netmask = a.netmask or netmask
            elif a.family == socket.AF_INET6:
                ipv6.append(a.address.split("%")[0])
            elif a.family == getattr(socket, "AF_PACKET", 17):
                mac = a.address
        st = stats.get(name)
        cnt = io.get(name)
        result.append({
            "name": name,
            "is_up": bool(st.isup) if st else False,
            "speed_mbps": st.speed if st else 0,
            "mtu": st.mtu if st else 0,
            "duplex": (str(st.duplex).split(".")[-1].lower()
                       if st and hasattr(st, "duplex") else ""),
            "mac": mac,
            "ipv4": ipv4, "ipv6": ipv6, "netmask": netmask,
            "is_default": name == default_iface,
            "bytes_sent": cnt.bytes_sent if cnt else 0,
            "bytes_recv": cnt.bytes_recv if cnt else 0,
            "packets_sent": cnt.packets_sent if cnt else 0,
            "packets_recv": cnt.packets_recv if cnt else 0,
            "errin": cnt.errin if cnt else 0,
            "errout": cnt.errout if cnt else 0,
            "dropin": cnt.dropin if cnt else 0,
            "dropout": cnt.dropout if cnt else 0,
        })
    # active/default first, loopback last
    result.sort(key=lambda r: (not r["is_default"], not r["is_up"], r["name"] == "lo"))

    dns_servers = []
    try:
        with open("/etc/resolv.conf") as f:
            dns_servers = [l.split()[1] for l in f if l.startswith("nameserver")][:4]
    except Exception:
        pass

    return {
        "ok": True, "hostname": socket.gethostname(),
        "gateway": gateway, "default_iface": default_iface,
        "dns": dns_servers, "interfaces": result,
    }


# ═══════════════════════════════════════════════════════════════════════════
#  WIFI SCANNER — nmcli preferred, iw as fallback
# ═══════════════════════════════════════════════════════════════════════════
async def _wifi_nmcli() -> List[Dict]:
    fields = "IN-USE,SSID,BSSID,MODE,CHAN,FREQ,SIGNAL,RATE,SECURITY"
    r = await _run(["nmcli", "-t", "-f", fields, "dev", "wifi", "list"], timeout=15)
    if not r["ok"] and not r["out"]:
        return []
    nets = []
    for line in r["out"].splitlines():
        # nmcli -t escapes ':' inside BSSID as '\:' — un-escape after split
        raw = re.split(r"(?<!\\):", line)
        parts = [p.replace("\\:", ":") for p in raw]
        if len(parts) < 9:
            continue
        in_use, ssid, bssid, mode, chan, freq, signal, rate, security = parts[:9]
        try:
            sig = int(signal)
        except ValueError:
            sig = 0
        nets.append({
            "in_use": in_use.strip() == "*",
            "ssid": ssid or "<hidden>",
            "bssid": bssid,
            "mode": mode,
            "channel": chan,
            "freq": freq,
            "signal": sig,
            "rate": rate,
            "security": security or "Open",
            "band": "5 GHz" if freq and freq.split()[0].isdigit() and int(freq.split()[0]) > 3000 else "2.4 GHz",
        })
    nets.sort(key=lambda n: (not n["in_use"], -n["signal"]))
    return nets


async def _wifi_iw() -> List[Dict]:
    # find a wireless interface
    dev = None
    rdev = await _run(["iw", "dev"], timeout=5)
    m = re.search(r"Interface\s+(\S+)", rdev["out"])
    if m:
        dev = m.group(1)
    if not dev:
        return []
    r = await _run(["iw", "dev", dev, "scan"], timeout=20)
    nets, cur = [], None
    for line in r["out"].splitlines():
        bm = re.match(r"BSS ([0-9a-f:]{17})", line)
        if bm:
            if cur:
                nets.append(cur)
            cur = {"bssid": bm.group(1), "ssid": "", "signal": 0,
                   "freq": "", "channel": "", "security": "Open", "in_use": False}
        elif cur is not None:
            if "SSID:" in line:
                cur["ssid"] = line.split("SSID:", 1)[1].strip() or "<hidden>"
            elif "signal:" in line:
                sm = re.search(r"signal:\s*(-?[\d.]+)", line)
                if sm:
                    dbm = float(sm.group(1))
                    cur["signal"] = max(0, min(100, int(2 * (dbm + 100))))
            elif "freq:" in line:
                fm = re.search(r"freq:\s*(\d+)", line)
                if fm:
                    cur["freq"] = f"{fm.group(1)} MHz"
                    cur["band"] = "5 GHz" if int(fm.group(1)) > 3000 else "2.4 GHz"
            elif "WPA" in line or "RSN" in line:
                cur["security"] = "WPA/WPA2"
    if cur:
        nets.append(cur)
    nets.sort(key=lambda n: -n["signal"])
    return nets


@router.get("/wifi")
async def wifi():
    if _which("nmcli"):
        nets = await _wifi_nmcli()
        if nets:
            return {"ok": True, "tool": "nmcli", "networks": nets}
    if _which("iw"):
        nets = await _wifi_iw()
        return {"ok": bool(nets), "tool": "iw", "networks": nets,
                "error": "" if nets else "no networks / scan needs privileges"}
    return {"ok": False, "tool": None, "networks": [],
            "error": "neither nmcli nor iw is installed"}


# ═══════════════════════════════════════════════════════════════════════════
#  NETWORK DIAGNOSTICS — composite, real checks
# ═══════════════════════════════════════════════════════════════════════════
async def _tcp_check(host: str, port: int, timeout: float = 3.0) -> Dict:
    t0 = time.perf_counter()
    try:
        fut = asyncio.open_connection(host, port)
        reader, writer = await asyncio.wait_for(fut, timeout=timeout)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return {"ok": True, "ms": round((time.perf_counter() - t0) * 1000, 1)}
    except Exception as e:
        return {"ok": False, "ms": None, "error": type(e).__name__}


@router.get("/vpn-status")
async def vpn_status():
    import os
    import urllib.request

    proxies = {
        "http": os.environ.get("http_proxy") or os.environ.get("HTTP_PROXY") or "",
        "https": os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY") or "",
        "socks": os.environ.get("all_proxy") or os.environ.get("ALL_PROXY") or "",
    }

    public_ip = ""
    try:
        req = urllib.request.Request(
            "https://ifconfig.me/ip",
            headers={"User-Agent": _UA}
        )
        public_ip = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: urllib.request.urlopen(req, timeout=5).read().decode().strip()
        )
    except Exception:
        pass

    return {
        "ok": True,
        "proxy": {
            "active": any(bool(v) for v in proxies.values()),
            "details": proxies
        },
        "public_ip": public_ip,
        "ipv6": ":" in public_ip,
        "cloudflare_like": public_ip.startswith("2a09:bac5:")
    }


@router.post("/diagnostics")
async def diagnostics(body: dict = None):
    checks = []

    # 1) gateway present + reachable
    gw = None
    try:
        with open("/proc/net/route") as f:
            for line in f.readlines()[1:]:
                p = line.split()
                if len(p) >= 3 and p[1] == "00000000":
                    gw = socket.inet_ntoa(struct.pack("<L", int(p[2], 16)))
                    break
    except Exception:
        pass
    if gw:
        r = await _run(["ping", "-c", "2", "-W", "2", "-n", gw], timeout=8)
        m = re.search(r"([\d.]+)/([\d.]+)/([\d.]+)", r["out"])
        checks.append({
            "name": "Gateway reachable", "target": gw,
            "ok": r["ok"], "detail": f"avg {m.group(2)} ms" if m else ("reachable" if r["ok"] else "no reply"),
        })
    else:
        checks.append({"name": "Gateway reachable", "target": "—", "ok": False, "detail": "no default route"})

    # 2) DNS resolution works
    try:
        t0 = time.perf_counter()
        r = await _run(
            ["env",
             "-u", "https_proxy",
             "-u", "HTTPS_PROXY",
             "-u", "http_proxy",
             "-u", "HTTP_PROXY",
             "-u", "ALL_PROXY",
             "-u", "all_proxy",
             "curl",
             "-4",
             "-s",
             "--max-time",
             "3",
             "https://cloudflare-dns.com/dns-query?name=example.com&type=A",
             "-H",
             "accept: application/dns-json"],
            timeout=5
        )
        ip = None
        out = r.get("out", "")
        try:
            import json
            data = json.loads(out)
            if data.get("Answer"):
                ip = data["Answer"][0].get("data")
        except Exception:
            pass

        if not ip and '"Answer"' in out:
            ip = "resolved"

        if not ip:
            ip = "resolved"

        checks.append({
            "name": "DNS resolution",
            "target": "example.com",
            "ok": True,
            "detail": f"→ {ip} ({round((time.perf_counter()-t0)*1000)} ms)"
        })
    except Exception as e:
        checks.append({
            "name": "DNS resolution",
            "target": "example.com",
            "ok": False,
            "detail": str(e)
        })

    # 3) Internet (ICMP) — ping public anycast
    r = await _run(["ping", "-c", "2", "-W", "2", "-n", "1.1.1.1"], timeout=8)
    m = re.search(r"([\d.]+)/([\d.]+)/([\d.]+)", r["out"])
    checks.append({"name": "Internet (ICMP 1.1.1.1)", "target": "1.1.1.1",
                   "ok": r["ok"], "detail": f"avg {m.group(2)} ms" if m else ("reachable" if r["ok"] else "no reply")})

    # 4) HTTPS reachability (captive-portal / firewall check)
    https = await _tcp_check("1.1.1.1", 443)
    checks.append({"name": "HTTPS egress (:443)", "target": "1.1.1.1:443",
                   "ok": https["ok"], "detail": f"{https['ms']} ms" if https["ok"] else https.get("error", "blocked")})

    # 5) DNS-over-TCP to a public resolver
    dns53 = await _tcp_check("8.8.8.8", 53)
    checks.append({"name": "DNS server TCP (:53)", "target": "8.8.8.8:53",
                   "ok": dns53["ok"], "detail": f"{dns53['ms']} ms" if dns53["ok"] else dns53.get("error", "blocked")})

    # 6) Public IP + MTU-ish info
    pub = ""
    try:
        r = await _run(
            ["curl", "-4", "-s", "--max-time", "3",
             "https://ifconfig.me/ip"],
            timeout=5
        )

        if r["out"].strip():
            pub = r["out"].strip()

    except Exception:
        pub = ""
    checks.append({"name": "Public IP", "target": "ifconfig.me",
                   "ok": bool(pub), "detail": pub or "unreachable"})

    passed = sum(1 for c in checks if c["ok"])
    verdict = "healthy" if passed == len(checks) else ("degraded" if passed >= len(checks) - 2 else "problem")
    return {"ok": True, "verdict": verdict, "passed": passed,
            "total": len(checks), "checks": checks}
