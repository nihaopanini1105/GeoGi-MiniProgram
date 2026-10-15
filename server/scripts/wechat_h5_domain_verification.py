#!/usr/bin/env python3
"""GeoGi 微信 web-view 业务域名验证：默认只读；仅在显式 install 时变更独立 Nginx vhost。"""
from __future__ import annotations
import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from urllib.request import Request, urlopen

VHOST = Path("/www/server/panel/vhost/nginx/api.geogi.cn.conf")
NAME = "iBZMBKP6Yg.txt"
URL = "https://api.geogi.cn/" + NAME
WEB_ROOT = Path("/opt/geogi-wechat-domain")
DEST = WEB_ROOT / NAME
BACKUPS = Path("/var/backups/geogi-wechat-domain")
LOCATION = (
    "\n    # GeoGi WeChat domain verification (managed)\n"
    f"    location = /{NAME} {{\n"
    f"        alias {DEST};\n"
    "        default_type text/plain;\n"
    '        add_header Cache-Control "no-store" always;\n'
    "    }\n"
)

class SafeAbort(Exception):
    pass

def digest(data):
    return hashlib.sha256(data).hexdigest()

def mask(text):
    """Keep offsets and directive braces, mask quoted strings and comments."""
    out = list(text)
    quote = None
    comment = False
    escaped = False
    for i, char in enumerate(text):
        if comment:
            if char == "\n":
                comment = False
            else:
                out[i] = " "
        elif quote:
            out[i] = "\n" if char == "\n" else " "
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
        elif char == "#":
            comment = True
            out[i] = " "
        elif char in ("'", '"'):
            quote = char
            out[i] = " "
    if quote:
        raise SafeAbort("NGINX_QUOTE_UNBALANCED")
    return "".join(out)

def locate_https_block(source, permit_existing=False):
    clear = mask(source)
    selected = []
    for match in re.finditer(r"\bserver\s*\{", clear):
        opening = match.end() - 1
        depth = 0
        closing = None
        for i in range(opening, len(clear)):
            if clear[i] == "{":
                depth += 1
            elif clear[i] == "}":
                depth -= 1
                if depth == 0:
                    closing = i
                    break
        if closing is None:
            raise SafeAbort("NGINX_SERVER_BLOCK_UNBALANCED")
        body = clear[opening:closing]
        if re.search(r"\bserver_name\s+[^;]*\bapi\.geogi\.cn\b[^;]*;", body) and re.search(
            r"\blisten\s+[^;]*\b443\b[^;]*;", body
        ):
            selected.append((opening, closing, body))
    if len(selected) != 1:
        raise SafeAbort(f"NGINX_EXACT_HTTPS_VHOST_COUNT={len(selected)}")
    opening, closing, body = selected[0]
    exists = bool(re.search(r"\blocation\s*(?:=\s*)?/" + re.escape(NAME) + r"\b", body))
    if exists and not permit_existing:
        raise SafeAbort("NGINX_VERIFICATION_LOCATION_EXISTS")
    return opening, closing, exists

def assert_vhost():
    if not VHOST.is_file() or VHOST.is_symlink() or VHOST.resolve(strict=True) != VHOST:
        raise SafeAbort("NGINX_VHOST_PATH_UNSAFE")
    if VHOST.stat().st_uid != 0 or (VHOST.stat().st_mode & 0o002):
        raise SafeAbort("NGINX_VHOST_OWNER_OR_MODE_UNSAFE")
    for parent in (VHOST.parent, VHOST.parent.parent):
        if not parent.is_dir() or parent.is_symlink() or (parent.stat().st_mode & 0o002):
            raise SafeAbort("NGINX_VHOST_PARENT_UNSAFE")

def nginx():
    binary = shutil.which("nginx") or "/www/server/nginx/sbin/nginx"
    if not Path(binary).is_file():
        raise SafeAbort("NGINX_BINARY_MISSING")
    return binary

def check_active():
    assert_vhost()
    binary = nginx()
    dump = subprocess.run([binary, "-T"], text=True, capture_output=True, timeout=40)
    if dump.returncode:
        raise SafeAbort("NGINX_BASELINE_TEST_FAILED")
    if f"# configuration file {VHOST}:" not in dump.stdout:
        raise SafeAbort("NGINX_VHOST_NOT_IN_ACTIVE_INCLUDE_TREE")
    return binary, VHOST.read_text(encoding="utf-8")

def atomic(path, data, mode):
    staged = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".geogi-domain-", delete=False) as file:
            staged = Path(file.name)
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.chmod(staged, mode)
        os.replace(staged, path)
        staged = None
    finally:
        if staged:
            staged.unlink(missing_ok=True)

def public_bytes():
    request = Request(URL, headers={"Cache-Control": "no-cache"})
    with urlopen(request, timeout=20) as response:
        if response.status != 200 or response.geturl() != URL:
            raise SafeAbort("PUBLIC_HTTPS_STATUS_OR_REDIRECT_INVALID")
        result = response.read(65537)
        if len(result) > 65536:
            raise SafeAbort("PUBLIC_RESPONSE_TOO_LARGE")
        return result

def read_original(path):
    if path is None or not path.is_file() or path.is_symlink() or path.name != NAME:
        raise SafeAbort("ORIGINAL_FILE_REQUIRED")
    content = path.read_bytes()
    if not content or len(content) > 65536:
        raise SafeAbort("ORIGINAL_FILE_INVALID_SIZE")
    return content

def restore(backup, binary):
    original_config = backup / "api.geogi.cn.conf"
    if not original_config.is_file():
        raise SafeAbort("ROLLBACK_MISSING_VHOST_BACKUP")
    atomic(VHOST, original_config.read_bytes(), original_config.stat().st_mode & 0o777)
    old_file = backup / NAME
    if old_file.exists():
        atomic(DEST, old_file.read_bytes(), 0o644)
    else:
        DEST.unlink(missing_ok=True)
    subprocess.run([binary, "-t"], check=True, timeout=40)
    subprocess.run([binary, "-s", "reload"], check=True, timeout=30)

def inspect():
    _, current = check_active()
    _, _, exists = locate_https_block(current, permit_existing=True)
    print("NGINX_READ_ONLY_INSPECTION=PASS")
    print("CONFIG_SOURCE=" + str(VHOST))
    print("CONFIG_INCLUDED_IN_ACTIVE_TREE=True")
    print("EXACT_TLS_VHOST_COUNT=1")
    print("VERIFICATION_LOCATION_EXISTS=" + str(exists))
    print("CONFIG_SHA256=" + digest(current.encode("utf-8")))

def install(original):
    if os.geteuid() != 0:
        raise SafeAbort("INSTALL_REQUIRES_ROOT")
    content = read_original(original)
    binary, current = check_active()
    _, closing, _ = locate_https_block(current)
    edited = current[:closing] + LOCATION + current[closing:]
    backup = BACKUPS / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup, 0o700)
    shutil.copy2(VHOST, backup / "api.geogi.cn.conf")
    if DEST.exists():
        if DEST.is_symlink() or not DEST.is_file():
            raise SafeAbort("EXISTING_DOMAIN_FILE_UNSAFE")
        shutil.copy2(DEST, backup / NAME)
    print("BACKUP_DIR=" + str(backup), flush=True)
    WEB_ROOT.mkdir(parents=True, exist_ok=True, mode=0o755)
    if WEB_ROOT.resolve(strict=True) != WEB_ROOT or (WEB_ROOT.stat().st_mode & 0o002):
        raise SafeAbort("PUBLIC_DOMAIN_DIR_UNSAFE")
    changed = False
    try:
        atomic(DEST, content, 0o644)
        changed = True
        atomic(VHOST, edited.encode("utf-8"), VHOST.stat().st_mode & 0o777)
        subprocess.run([binary, "-t"], check=True, timeout=40)
        subprocess.run([binary, "-s", "reload"], check=True, timeout=30)
        if DEST.read_bytes() != content or public_bytes() != content:
            raise SafeAbort("PUBLIC_HTTPS_BYTES_DO_NOT_MATCH_ORIGINAL")
    except Exception:
        if changed:
            restore(backup, binary)
        raise
    print("VERIFICATION_DEPLOYED=PASS")
    print("ORIGINAL_SHA256=" + digest(content))
    print("PUBLIC_URL=" + URL)

def rollback(backup):
    if os.geteuid() != 0:
        raise SafeAbort("ROLLBACK_REQUIRES_ROOT")
    assert_vhost()
    if not backup or backup.resolve(strict=True).parent != BACKUPS.resolve(strict=False):
        raise SafeAbort("ROLLBACK_BACKUP_PATH_UNSAFE")
    restore(backup, nginx())
    print("VERIFICATION_ROLLBACK=PASS")

def verify(original):
    content = read_original(original)
    if content != public_bytes():
        raise SafeAbort("PUBLIC_HTTPS_BYTES_DO_NOT_MATCH_ORIGINAL")
    print("VERIFICATION_PUBLIC_HTTPS=PASS")
    print("SHA256=" + digest(content))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["inspect", "install", "verify", "rollback"])
    parser.add_argument("--original", type=Path)
    parser.add_argument("--backup", type=Path)
    options = parser.parse_args()
    try:
        if options.mode == "inspect":
            inspect()
        elif options.mode == "install":
            install(options.original)
        elif options.mode == "verify":
            verify(options.original)
        else:
            rollback(options.backup)
    except (SafeAbort, OSError, ValueError, subprocess.CalledProcessError) as error:
        print("VERIFICATION_FAILED_REASON=" + str(error), file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
