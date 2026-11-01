"""Install the APK location while retaining this site's trusted client-IP headers."""
import argparse
import datetime
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import uuid


def configured_text(original, template):
    root = re.search(r"(?ms)^[ \t]*location\s+/\s*\{(.*?)^[ \t]*\}", original)
    if not root:
        raise ValueError("No unambiguous root proxy location")
    block = "\n".join(line for line in template.splitlines() if not line.lstrip().startswith("#"))
    for name in ("Host", "X-Real-IP", "X-Forwarded-For", "X-Forwarded-Proto"):
        values = re.findall(r"proxy_set_header\s+" + re.escape(name) + r"\s+([^;]+);", root.group(1))
        if len(values) != 1:
            raise ValueError("Expected exactly one existing " + name + " forwarding header")
        block = re.sub(r"(proxy_set_header\s+" + re.escape(name) + r"\s+)[^;]+;", lambda match: match.group(1) + values[0] + ";", block)
    upstreams = re.findall(r"proxy_pass\s+([^;]+);", root.group(1))
    if len(upstreams) != 1:
        raise ValueError("Expected exactly one upstream")
    block = re.sub(r"proxy_pass\s+[^;]+;", lambda _: "proxy_pass " + upstreams[0] + ";", block)
    # The checked-in location is flat; refuse ambiguous/nested existing overrides.
    pattern = r"(?ms)^[ \t]*location\s*=\s*/api/admin/app-release\s*\{[^{}]*\}"
    existing = list(re.finditer(pattern, original))
    if original.count("location = /api/admin/app-release") > 1 or len(existing) > 1:
        raise ValueError("Multiple APK locations")
    indented = "\n".join("    " + line if line else "" for line in block.strip().splitlines())
    if existing:
        return original[:existing[0].start()] + indented + original[existing[0].end():]
    return original[:root.start()] + indented + "\n\n" + original[root.start():]


def atomic_write(site, content, metadata):
    descriptor, temporary = tempfile.mkstemp(prefix=".custodysim-apk-", dir=site.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, metadata.st_mode & 0o777)
        os.chown(temporary, metadata.st_uid, metadata.st_gid)
        os.replace(temporary, site)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True)
    parser.add_argument("--template", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    site = Path(args.site).resolve(strict=True)
    if not site.is_relative_to(Path("/etc/nginx")) or not site.is_file():
        raise ValueError("Site must resolve to an existing file under /etc/nginx")
    original = site.read_text(encoding="utf-8")
    result = configured_text(original, Path(args.template).read_text(encoding="utf-8"))
    if result == original:
        print("APK Nginx location already current")
        return
    if not args.apply:
        print("APK Nginx location update required (read-only preview)")
        return
    metadata = site.stat()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S")
    backup = site.with_name(site.name + ".pre-apk-" + stamp + "-" + uuid.uuid4().hex[:8])
    shutil.copy2(site, backup)
    try:
        atomic_write(site, result, metadata)
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except BaseException:
        atomic_write(site, original, metadata)
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
        raise
    print("APK Nginx location installed; previous configuration: " + str(backup))


if __name__ == "__main__":
    main()
