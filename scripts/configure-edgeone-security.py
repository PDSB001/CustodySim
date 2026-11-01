"""Install origin protection only after a real CDN request proves IP forwarding.

Never reads or emits the origin key. Backups are outside sites-enabled/conf.d.
"""
import argparse
import datetime
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import uuid
from urllib.parse import urlsplit
import importlib.util

spec = importlib.util.spec_from_file_location("apk_nginx", Path(__file__).with_name("configure-app-release-nginx.py"))
apk_nginx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apk_nginx)
atomic_write = apk_nginx.atomic_write
HTTP = Path("/etc/nginx/conf.d/custodysim-security.conf")
SERVER = Path("/etc/nginx/snippets/custodysim-security.conf")
LOG = Path("/var/log/nginx/custodysim-security.log")
INCLUDE = "    include /etc/nginx/snippets/custodysim-security.conf;"
START = "    # BEGIN custodysim edge security"
END = "    # END custodysim edge security"
AUTH_PATH = r"^/api/auth/(login|register|change-password|mfa/(verify|setup|disable)|security-email/(send|confirm))$"


def auth_location(original):
    root = re.search(r"(?ms)^[ \t]*location\s+/\s*\{([^{}]*?)^[ \t]*\}", original)
    if not root: raise ValueError("Expected a flat root proxy location")
    body = re.sub(r"\bclient_max_body_size\s+[^;]+;", "", root.group(1))
    body = re.sub(r"\bclient_body_timeout\s+[^;]+;", "", body)
    if not re.search(r"proxy_pass\s+http://127\.0\.0\.1:3000\s*;", body):
        raise ValueError("Expected local application upstream")
    return "\nlocation ~ " + AUTH_PATH + " {\n    client_max_body_size 16k;\n    client_body_timeout 10s;\n" + body + "\n}\n"


def configured_site(original):
    original = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"\n?", "", original, flags=re.S)
    blocks = []
    # Brace counting also handles Certbot's nested if block. Refuse quoted braces.
    for match in re.finditer(r"(?m)^server\s*\{", original):
        depth = 1
        cursor = match.end()
        while cursor < len(original) and depth:
            if original[cursor] == "{": depth += 1
            if original[cursor] == "}": depth -= 1
            cursor += 1
        if depth: raise ValueError("Unbalanced Nginx server block")
        block = original[match.end():cursor - 1]
        if re.search(r"\blisten\s+(?:\[::\]:)?443\s", block):
            blocks.append(match.end())
    if len(blocks) != 1:
        raise ValueError("Expected exactly one HTTPS server block")
    point = blocks[0]
    return original[:point] + "\n" + START + "\n" + INCLUDE + "\n" + END + "\n" + original[point:].lstrip("\r\n")


def probe(origin):
    marker = uuid.uuid4().hex
    output = subprocess.run(["curl", "--silent", "--show-error", "--fail", "--connect-timeout", "5", "--max-time", "15",
                             origin + "/api/mobile/server-info?custodysim_probe=" + marker], capture_output=True, text=True, check=True)
    if not json.loads(output.stdout).get("success"): raise ValueError("Public API health failed")
    # access_log without buffering; allow a short grace period for worker completion.
    for _ in range(10):
        for line in LOG.read_text().splitlines()[-100:]:
            try: event = json.loads(line)
            except ValueError: continue
            if event.get("probe") != marker: continue
            client = ipaddress.ip_address(event["client"])
            peer = ipaddress.ip_address(event["peer"])
            if event.get("edge") != "1" or client == peer or not client.is_global:
                raise ValueError("CDN authentication or independent public client-IP forwarding failed")
            print("Verified public CDN request: authenticated, independent valid client IP")
            return
        time.sleep(0.1)
    raise ValueError("Public request did not reach this Nginx; cannot enable origin gate")


def reload_nginx():
    subprocess.run(["nginx", "-t"], check=True, capture_output=True)
    subprocess.run(["systemctl", "reload", "nginx"], check=True)
    time.sleep(0.5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if origin.scheme != "https" or not origin.hostname or origin.path not in ("", "/") or origin.query or origin.fragment or origin.username:
        raise ValueError("Origin must be an HTTPS origin without credentials")
    site = Path(args.site).resolve(strict=True)
    if not site.is_relative_to(Path("/etc/nginx")) or not site.is_file():
        raise ValueError("Site must be an existing file under /etc/nginx")
    original = site.read_text()
    result = configured_site(original)
    # Config is captured for structural checks only; it contains secrets.
    config = subprocess.run(["nginx", "-T"], check=True, capture_output=True, text=True).stdout
    if not all(value in config for value in ["$custodysim_edgeone_authenticated", "$http_eo_client_ip", "$custodysim_client_ip"]):
        raise ValueError("Existing private EdgeOne authentication/IP maps required")
    if re.search(r"\blimit_(req|conn)\s", original):
        raise ValueError("Existing location limits require manual merge to avoid inheritance gaps")
    if not args.apply:
        print("Preview passed; apply will verify CDN authentication/IP before enforcing protection")
        return
    templates = Path(__file__).resolve().parent.parent / "deploy/nginx"
    changes = {site: result, HTTP: (templates / "edgeone-security-http.conf").read_text(),
               SERVER: (templates / "edgeone-security-server.conf").read_text() + auth_location(original)}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + uuid.uuid4().hex[:8]
    backup = Path("/etc/nginx/custodysim-backups") / stamp
    backup.mkdir(parents=True, mode=0o700)
    previous = {}
    for index, filename in enumerate(changes):
        previous[filename] = (filename.read_text(), filename.stat()) if filename.exists() else None
        if filename.exists(): shutil.copy2(filename, backup / (str(index) + "-" + filename.name))
    def write(filename, content):
        filename.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(filename, content, previous[filename][1] if previous[filename] else site.stat())
    try:
        write(HTTP, changes[HTTP])
        # Never temporarily remove an already-installed origin gate on reapply.
        preflight = previous[SERVER][0] if previous[SERVER] and "$custodysim_origin_allowed" in previous[SERVER][0] else "access_log /var/log/nginx/custodysim-security.log custodysim_security;\naccess_log /var/log/nginx/access.log combined;\n"
        write(SERVER, preflight)
        write(site, result)
        reload_nginx()
        probe(args.origin.rstrip("/"))
        write(SERVER, changes[SERVER])
        reload_nginx()
        probe(args.origin.rstrip("/"))
    except BaseException:
        for filename, saved in previous.items():
            if saved: atomic_write(filename, saved[0], saved[1])
            elif filename.exists(): filename.unlink()
        reload_nginx()
        print("Security installation failed; restored previous Nginx configuration")
        raise
    print("Origin authentication and scoped limits enabled; backup: " + str(backup))


if __name__ == "__main__": main()
