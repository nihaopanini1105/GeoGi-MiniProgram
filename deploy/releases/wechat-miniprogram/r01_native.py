"""R01 phases in the existing Mini software release lock and symlink layout."""
from base64 import b64decode
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import urlopen


V21 = "src/services/report-v21-bridge-operations.js"
V21_SHA256 = "6ab5c3d2f7d726039b407acda90015400dcda00a359a737fd28908973f0fa671"
FILES = (
    "src/server.js", "src/services/customer-portal.js", "src/services/delivery-package-store.js",
    "src/services/os-operations-bridge.js", "src/services/payment-store.js",
    "src/services/report-v2-bridge-operations.js", V21,
)
LIVE_SERVER_SHA = "cde137b84a769878fb12155473a95539dc1ba96e86576ab7876434a68b4ef2c0"
BASELINE_SHA256 = {
    "src/server.js": "bd4b8f44aa5a57b9d20bdef37067be0035acd1a5175c4bd52e33cc4ba41deea5",
    "src/services/customer-portal.js": "fe33d9271fdff8fdc20298c85fbb203d80c82a073e8d0bf2007ad0c0c22d81aa",
    "src/services/delivery-package-store.js": "433c994db41dd7dbbc09a6673bd850eec4927696b04b45db19136c9f411dcba8",
    "src/services/os-operations-bridge.js": "73b13be41baea8edb19a3d8e5f958a287631b6a469cd0660098a54df7a993b79",
    "src/services/payment-store.js": "1eccf035bd3622b05da20b5b548347dc94ab777ad98499b0d1a94f7ea79b2c83",
    "src/services/report-v2-bridge-operations.js": "e0b48f4b7b430b5f13d778b15d3aa6de5d5221fb736c4a097bd446c1b6f1bb90"
}
BASELINE_SHA256["src/server.js"] = LIVE_SERVER_SHA
BASELINE_SHA256[V21] = V21_SHA256
VERSION = "r01-sealed-pair"
FORWARD = ("check", "backup", "stage", "before_switch", "switch", "verify")
RECOVERY = ("before_rollback", "rollback", "verify_rollback")
ROOT = Path("/opt/geogi-mini-program")
NODE = "/root/.nvm/versions/node/v24.19.0/bin/node"


def need(value, code):
    if not value:
        raise RuntimeError("mini_r01_" + code)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def atomic(path, raw):
    fd, name = tempfile.mkstemp(prefix=".r01-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(name).unlink(missing_ok=True)


def read_private(path):
    st = path.lstat()
    need(stat.S_ISREG(st.st_mode) and st.st_uid == os.geteuid() and st.st_mode & 0o077 == 0,
         "private_file_required")
    return path.read_bytes()


def check_grant(grant, identity, payload, now, *, recovery):
    # The manager generates run_id when publish starts. Bind that ID when
    # consuming the grant under the existing remote resource lock.
    expected = {key: value for key, value in identity.items() if key != "run_id"}
    expected["payload_sha256"] = digest(encode(payload))
    need(grant.get("explicit_human_approval") is True and grant.get("scope") ==
         "mini_r01_software_only_no_enable_no_delivery" and
         all(grant.get(key) == val for key, val in expected.items()), "approval_scope")
    start = datetime.fromisoformat(grant["starts_at"])
    end = datetime.fromisoformat(grant["expires_at"])
    need(start.utcoffset() is not None and end.utcoffset() is not None and end > start, "approval_window")
    need(recovery or start <= now < end, "approval_expired")
    need(payload.get(V21) == grant.get("v21_sha256") == V21_SHA256, "approval_v21_identity")
    for key in ("baseline_inventory_sha256", "v21_sha256"):
        need(re.fullmatch(r"[0-9a-f]{64}", grant.get(key) or ""), "approval_baseline_missing")


def bind_run(path, identity, grant_hash, *, create):
    expected = {"identity": identity, "grant_sha256": grant_hash}
    if path.exists():
        need(json.loads(read_private(path)) == expected, "approval_already_consumed")
    else:
        need(create, "approval_run_unbound")
        # All callers hold the existing software-release lock.
        atomic(path, encode(expected))


def file_entry(path):
    st = path.lstat()
    if stat.S_ISLNK(st.st_mode):
        return ["link", os.readlink(path)]
    need(stat.S_ISREG(st.st_mode), "unsupported_runtime_entry")
    return ["file", digest(path.read_bytes()), stat.S_IMODE(st.st_mode)]


def inventory(server):
    result = {}
    for path in sorted((server / "src").rglob("*")):
        if not path.is_dir() or path.is_symlink():
            result[path.relative_to(server).as_posix()] = file_entry(path)
    for name in ("package.json", "package-lock.json", ".env", "data", "uploads", "node_modules"):
        path = server / name
        if path.is_symlink() or path.is_file():
            result[name] = file_entry(path)
        elif path.is_dir() and name == "node_modules":
            result[name] = ["directory"]
        else:
            need(name == ".env" and not path.exists(), "runtime_link_or_file_required")
    need(result["data"][0] == result["uploads"][0] == "link", "shared_runtime_link_required")
    return result


def decode_payload(payload, manifest):
    need(set(payload) == set(FILES), "payload_scope")
    bodies = {path: b64decode(payload[path], validate=True) for path in FILES}
    need(all(digest(raw) == manifest[path] for path, raw in bodies.items()), "payload_digest")
    return bodies


class Service:
    def command(self, argv, cwd=None):
        return subprocess.check_output(argv, cwd=cwd, text=True, timeout=40).strip()

    def running_process(self):
        pid = int(self.command(["systemctl", "show", "-p", "MainPID", "--value", "geogi-api"]))
        if pid == 0:
            return None, None
        need(pid > 1, "service_pid_missing")
        return pid, Path(f"/proc/{pid}/cwd").resolve(strict=True)

    def config(self, server):
        pid, source = self.running_process()
        need(source == server, "service_source_identity_changed")
        keys = ("GEOGI_R01_SEALED_H5_PDF_ENABLED", "GEOGI_DELIVERY_PACKAGE_ROOT")
        result = json.loads(self.command([NODE, "-e",
            "const fs=require('fs'),d=require('dotenv'),p='.env';"
            "const x=fs.existsSync(p)?d.parse(fs.readFileSync(p)):{};"
            "console.log(JSON.stringify(Object.fromEntries(process.argv.slice(1).filter(k=>k in x).map(k=>[k,x[k]]))));",
            *keys], cwd=server))
        for entry in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0"):
            key, sep, value = entry.partition(b"=")
            if sep and key.decode(errors="replace") in keys:
                result[key.decode()] = value.decode()
        need(result.get(keys[0], "") in ("", "false"), "new_flag_must_stay_disabled")
        path = Path(result.get(keys[1]) or "data/delivery-packages")
        return (server / path).resolve()

    def rollback_safe(self, root):
        for path in root.glob("*.json"):
            doc = json.loads(path.read_bytes())
            if (doc.get("version_pins") or {}).get("artifact_delivery_profile") != "r01_sealed_h5_pdf":
                continue
            package = doc["delivery_package_id"]
            need(re.fullmatch(r"delivery_package_[a-zA-Z0-9_-]{8,100}", package) and
                 path.name == package + ".json", "rollback_package_identity")
            mark = root / "_revocations" / path.name
            need(mark.is_file() and not mark.is_symlink(), "rollback_r01_reconciliation_required")
            raw = mark.read_bytes()
            # Older writers emitted one literal backslash-n after the JSON.
            if raw.endswith(b"\\n"):
                raw = raw[:-2]
            revocation = json.loads(raw)
            need(isinstance(revocation, dict), "rollback_r01_reconciliation_required")
            need((revocation.get("packageId"), revocation.get("clientId"), revocation.get("projectId")) ==
                 (package, doc["client_id"], doc["project_id"]), "rollback_r01_reconciliation_required")

    def check(self, server):
        need(self.command(["systemctl", "is-active", "geogi-api"]) == "active", "service_inactive")
        delivery_root = self.config(server)
        for attempt in range(20):
            try:
                with urlopen("http://127.0.0.1:3107/health", timeout=3) as response:
                    data = json.load(response)
                need(data.get("ok") and data.get("businessAuthority") == "GeoGi OS"
                     and data.get("osOperationsBridge") == "configured", "health_invalid")
                break
            except (OSError, RuntimeError, ValueError):
                if attempt == 19:
                    raise
                time.sleep(1)
        return delivery_root

    def verify(self, server):
        delivery_root = self.check(server)
        for endpoint in ("/api/customer/projects", "/api/customer/channel-dashboard",
                         "/internal/os/report-v2/capabilities", "/internal/os/report-v21/capabilities"):
            try:
                with urlopen("http://127.0.0.1:3107" + endpoint, timeout=8):
                    raise RuntimeError("mini_r01_unauthenticated_access")
            except HTTPError as exc:
                need(exc.code == 401, "customer_denial_missing")
        with urlopen("http://127.0.0.1:3107/api/articles/2026-china-brand-ai-visibility-report",
                     timeout=12) as response:
            article = json.load(response)
        need(article.get("ok") is True and len((article.get("article") or {}).get("body") or "") > 1000,
             "legacy_research_read_failed")
        return delivery_root

    def restart(self):
        self.command(["systemctl", "restart", "geogi-api"])

    def stage(self, server):
        for name in FILES:
            self.command([NODE, "--check", str(server / name)])
        # Resolve the preserved V2.1 module's static relative imports without
        # running server.js or starting the reconciler.
        self.command([NODE, "-e", "const fs=require('fs'),m=require('module');"
                      "const p=process.argv[1],r=m.createRequire(p);"
                      "for(const x of fs.readFileSync(p,'utf8').matchAll(/require\\(['\"](\\.[^'\"]+)['\"]\\)/g))r.resolve(x[1]);",
                      str(server / V21)])


class Release:
    def __init__(self, root, identity, manifest, grant, service):
        self.root, self.live = root, root / "server"
        self.identity, self.manifest, self.grant, self.service = identity, manifest, grant, service
        self.folder = root / "releases" / ("r01-" + identity["run_id"])
        self.candidate = self.folder / "server"
        self.state_file = self.folder / "state.json"

    def save(self, state, phase):
        state["phase"] = phase
        atomic(self.state_file, encode(state))

    def state(self):
        state = json.loads(read_private(self.state_file))
        need(state["identity"] == self.identity and state["manifest"] == self.manifest
             and state["grant_sha256"] == digest(encode(self.grant)), "recovery_identity_changed")
        return state

    def observe(self):
        need(self.live.is_symlink(), "live_symlink_required")
        live = self.live.resolve(strict=True)
        need(live.is_relative_to((self.root / "releases").resolve()), "release_target_outside_root")
        return live, inventory(live)

    def original(self):
        live, observed = self.observe()
        need(all(observed.get(path, [])[:2] == ["file", sha] for path, sha in BASELINE_SHA256.items()) and
             observed.get(V21, [])[:2] == ["file", self.grant["v21_sha256"]] and
             digest(encode(observed)) == self.grant["baseline_inventory_sha256"], "baseline_identity_changed")
        delivery_root = self.service.check(live)
        need(not delivery_root.is_relative_to(live), "delivery_root_must_be_shared")
        return live, observed, delivery_root

    def confirm(self, state, target):
        live, observed = self.observe()
        expected = state["baseline_inventory"] if target == Path(state["baseline"]) else state["candidate_inventory"]
        need(live == target and observed == expected, "active_release_changed")

    def staged(self, state):
        expected = state["candidate_inventory"]
        need(not self.candidate.is_symlink() and inventory(self.candidate) == expected, "staged_payload_changed")
        need(all(expected[p][:2] == ["file", self.manifest[p]] for p in FILES), "staged_payload_digest")

    def point_live_at(self, target):
        link = self.folder / ("next-" + os.urandom(8).hex())
        link.symlink_to(target)
        try:
            os.replace(link, self.live)
        finally:
            link.unlink(missing_ok=True)
    def swap(self, target):
        self.point_live_at(target)
        self.service.restart()
        return self.service.verify(target)

    def rollback(self, state):
        baseline = Path(state["baseline"])
        need(inventory(baseline) == state["baseline_inventory"], "backup_changed")
        live, _ = self.observe()
        need(live in (baseline, self.candidate), "newer_release_owns_target")
        self.confirm(state, live)
        _, running = self.service.running_process()
        need(running in (None, baseline, self.candidate), "newer_service_owns_target")
        delivery_root = Path(state["delivery_root"])
        if live == self.candidate or running != baseline:
            if running == self.candidate:
                self.staged(state)
            self.service.rollback_safe(delivery_root)
            self.save(state, "rollback_restarting")
            if live != baseline:
                self.point_live_at(baseline)
            self.confirm(state, baseline)
            _, running = self.service.running_process()
            need(running in (None, baseline, self.candidate), "newer_service_owns_target")
            if running != baseline:
                self.service.restart()
        self.confirm(state, baseline)
        need(self.service.verify(baseline) == delivery_root, "delivery_root_changed")
        self.save(state, "rolled_back")

    def execute(self, phase, payload):
        bodies = decode_payload(payload, self.manifest) if phase == "stage" else {}
        if phase == "check":
            self.original()
            need(not self.folder.exists(), "run_already_exists")
        elif phase == "backup":
            baseline, observed, delivery_root = self.original()
            self.folder.mkdir(mode=0o700)
            self.save({"identity": self.identity, "manifest": self.manifest,
                       "grant_sha256": digest(encode(self.grant)), "baseline": str(baseline),
                       "baseline_inventory": observed, "delivery_root": str(delivery_root)}, "backed_up")
        else:
            state = self.state()
            baseline = Path(state["baseline"])
            if phase == "stage":
                need(state["phase"] == "backed_up" and not self.candidate.exists(), "backup_required")
                self.confirm(state, baseline)
                need(self.service.check(baseline) == Path(state["delivery_root"]), "delivery_root_changed")
                shutil.copytree(baseline, self.candidate, symlinks=True)
                for name, raw in bodies.items():
                    target = self.candidate / name
                    need(target.is_file() and target.resolve() == target, "payload_target_invalid")
                    target.write_bytes(raw)
                observed = inventory(self.candidate)
                for name in ("data", "uploads", ".env", "node_modules"):
                    if (baseline / name).is_symlink():
                        need((baseline / name).resolve(strict=True) ==
                             (self.candidate / name).resolve(strict=True), "protected_link_target_changed")
                need({p: entry for p, entry in observed.items() if p not in FILES} ==
                     {p: entry for p, entry in state["baseline_inventory"].items() if p not in FILES},
                     "protected_inventory_changed")
                self.service.stage(self.candidate)
                state["candidate_inventory"] = observed
                self.staged(state)
                self.save(state, "staged")
            elif phase == "before_switch":
                need(state["phase"] == "staged", "stage_required")
                self.confirm(state, baseline)
                need(self.service.check(baseline) == Path(state["delivery_root"]), "delivery_root_changed")
                self.staged(state)
                self.save(state, "armed")
            elif phase == "switch":
                need(state["phase"] == "armed", "arm_required")
                self.confirm(state, baseline)
                need(self.service.check(baseline) == Path(state["delivery_root"]), "delivery_root_changed")
                self.staged(state)
                self.save(state, "switching")
                need(self.swap(self.candidate) == Path(state["delivery_root"]), "delivery_root_changed")
                self.confirm(state, self.candidate)
                self.save(state, "switched")
            elif phase == "verify":
                need(state["phase"] == "switched", "switch_required")
                self.confirm(state, self.candidate)
                need(self.service.verify(self.candidate) == Path(state["delivery_root"]), "delivery_root_changed")
                self.save(state, "verified")
            elif phase == "before_rollback":
                live, _ = self.observe()
                need(live in (baseline, self.candidate), "newer_release_owns_target")
                self.confirm(state, live)
                if state["phase"] not in ("rollback_restarting", "rolled_back"):
                    self.save(state, "rollback_armed")
            elif phase == "rollback":
                need(state["phase"] in ("rollback_armed", "rollback_restarting", "rolled_back"), "rollback_arm_required")
                self.rollback(state)
            elif phase == "verify_rollback":
                need(state["phase"] == "rolled_back", "rollback_required")
                self.confirm(state, baseline)
                need(self.service.verify(baseline) == Path(state["delivery_root"]), "delivery_root_changed")
        return {"verified": True, "phase": phase, **self.identity,
                "payload_sha256": digest(encode(self.manifest))}


def main(request):
    phase, identity, manifest = request["phase"], request["identity"], request["manifest"]
    need(phase in FORWARD + RECOVERY and identity["version"] == VERSION and
         identity["target"] == "geogi-prod-miniprogram-api" and
         identity["module"] == identity["resource"] == "wechat-miniprogram" and
         re.fullmatch(r"[a-f0-9]{40}", identity["source_sha"]) and
         re.fullmatch(r"[a-f0-9]{64}", identity["plan_sha256"]) and
         re.fullmatch(r"run-[a-zA-Z0-9_-]{1,80}", identity["run_id"]), "request_identity")
    need(set(manifest) == set(FILES) and all(re.fullmatch(r"[a-f0-9]{64}", v) for v in manifest.values()),
         "manifest_invalid")
    ref = request["approval_ref"]
    need(re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", ref or ""), "approval_reference")
    grant = json.loads(read_private(ROOT / "release-approvals" / (ref + ".json")))
    need(digest(encode(grant)) == request["grant_sha256"], "approval_bytes_changed")
    check_grant(grant, identity, manifest, datetime.now(timezone.utc), recovery=phase in RECOVERY)
    with (ROOT / ".software-release.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        binding = ROOT / "release-approvals" / (ref + ".consumed.json")
        runner = Release(ROOT, identity, manifest, grant, Service())
        if phase == "check":
            if binding.exists():
                bind_run(binding, identity, request["grant_sha256"], create=False)
            result = runner.execute(phase, request.get("payload", {}))
            bind_run(binding, identity, request["grant_sha256"], create=True)
        else:
            bind_run(binding, identity, request["grant_sha256"], create=False)
            result = runner.execute(phase, request.get("payload", {}))
    print(json.dumps(result, sort_keys=True))
