"""Bind the R01 Mini software overlay to the existing release manager."""
from base64 import b64encode
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
from types import SimpleNamespace

from tools.releasing import manager
from tools.releasing.sdk import ReleaseAdapter


MODULE = "wechat-miniprogram"
TARGET = "geogi-prod-miniprogram-api"
NATIVE = Path(__file__).with_name("r01_native.py")


def native_module():
    spec = importlib.util.spec_from_file_location("mini_r01_native", NATIVE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def bound_request(context, native):
    require = manager.require
    require((context.module, context.resource, context.profile, context.target, context.version) ==
            (MODULE, MODULE, "feature", TARGET, native.VERSION), "mini_r01_target_version_scope")
    require(context.phase in native.FORWARD + native.RECOVERY, "mini_r01_phase_scope")
    folder = context.run_directory
    context_file = Path(os.environ.get("GEOGI_RELEASE_CONTEXT", ""))
    require(folder.is_absolute() and folder.resolve() == folder and context_file.parent == folder,
            "mini_r01_context_path")
    envelope = manager.read_json(context_file)
    state = manager.read_json(folder / "status.json")
    plan = state["plan"]
    plan_hash = manager.digest(manager.encoded(plan))
    recover = context.phase in native.RECOVERY
    authorized_ref = state.get("rollback_approval_ref", state["approval_ref"]) if recover else state["approval_ref"]
    expected = {key: getattr(context, key) for key in
                ("module", "resource", "version", "target", "profile", "phase", "source_sha", "approval_ref")}
    expected.update(run_directory=str(folder), plan_sha256=plan_hash)
    require(envelope == expected and state["plan_sha256"] == plan_hash and
            state["status"] == "running" and state["active_phase"] == context.phase and
            context.approval_ref == authorized_ref and plan["source"]["sha"] == context.source_sha and
            all(plan["recipe"][key] == expected[key] for key in
                ("module", "resource", "version", "target", "profile")), "mini_r01_manager_binding")
    ref = state["approval_ref"]
    require(context.approval_ref == ref, "mini_r01_recovery_requires_original_approval")
    require(re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", ref or ""), "mini_r01_approval_reference")
    grant_file = folder.parent / "approvals" / (ref + ".json")
    grant_raw = native.read_private(grant_file)
    grant = json.loads(grant_raw)
    if recover:
        manager.verify_recovery(SimpleNamespace(folder=folder, state=state))
        gate = plan["gate"]
        require(manager.gate_identity(Path(gate["path"]), plan["source"]) == gate,
                "mini_r01_recovery_gate_changed")
        root = folder / "source"
    else:
        manager.verify_plan_inputs(plan)
        root = Path(plan["source_root"])
    require(Path(__file__).resolve() == root / "deploy/releases/wechat-miniprogram/adapter.py",
            "mini_r01_adapter_source_changed")
    files = {path: (root / "server" / path).read_bytes() for path in native.FILES}
    manifest = {path: native.digest(raw) for path, raw in files.items()}
    identity = {key: expected[key] for key in ("module", "resource", "version", "target", "source_sha")}
    identity.update(plan_sha256=plan_hash, run_id=folder.name)
    native.check_grant(grant, identity, manifest, datetime.now(timezone.utc), recovery=recover)
    request = {"phase": context.phase, "identity": identity, "manifest": manifest,
               "approval_ref": ref, "grant_sha256": native.digest(native.encode(grant))}
    if context.phase == "stage":
        request["payload"] = {path: b64encode(raw).decode() for path, raw in files.items()}
    return request


class Adapter(ReleaseAdapter):
    def execute(self, context):
        native = native_module()
        request = bound_request(context, native)
        # Send the frozen controller and the staged bytes in one stdin stream.
        # The remote controller validates its local copy of the same grant.
        data = NATIVE.read_text(encoding="utf-8") + "\nmain(json.loads(" + repr(json.dumps(request)) + "))\n"
        response = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                                   "geogi-prod", "python3 -"], input=data, capture_output=True,
                                  text=True, check=True, timeout=800)
        receipt = json.loads(response.stdout)
        manager.require(receipt == {"verified": True, "phase": context.phase, **request["identity"],
                                    "payload_sha256": native.digest(native.encode(request["manifest"]))},
                        "mini_r01_native_receipt_mismatch")
        context.write_json("native-r01-" + context.phase + "-" + Path(
            os.environ["GEOGI_RELEASE_CONTEXT"]).stem + ".json", receipt)
        return receipt

    check = backup = stage = before_switch = switch = verify = execute
    before_rollback = rollback = verify_rollback = execute
