"""Isolated filesystem acceptance for Mini R01's existing native adapter."""
from base64 import b64encode
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.live.geogi_release import main
from tools.releasing.sdk import ReleaseContext

ROOT = Path(__file__).resolve().parents[2]
ADAPTER = ROOT / "deploy/releases/wechat-miniprogram/adapter.py"
SPEC = importlib.util.spec_from_file_location("mini_adapter_under_test", ADAPTER)
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)
native = adapter.native_module()


def test_release_doctor_and_native_hook_delegation(tmp_path, capsys, monkeypatch):
    status = main(["doctor", "--module", adapter.MODULE, "--root", str(ROOT)])
    readiness = json.loads(capsys.readouterr().out)
    assert status == 0, readiness["issues"]
    assert readiness["status"] == "adapter_contract_ready"
    assert readiness["issues"] == []

    instance = adapter.Adapter()
    receipt = {"verified": True}
    failure = RuntimeError("synthetic native failure")
    execute = Mock()
    monkeypatch.setattr(instance, "execute", execute)
    for phase in native.FORWARD + native.RECOVERY:
        context = ReleaseContext(phase=phase, run_directory=tmp_path, source_sha="a" * 40,
                                 target=adapter.TARGET, resource=adapter.MODULE,
                                 approval_ref="", module=adapter.MODULE,
                                 version=native.VERSION, profile="feature")
        hook = getattr(instance, phase)
        execute.reset_mock()
        execute.side_effect = [receipt, failure]
        assert hook(context=context) is receipt
        execute.assert_called_once_with(context)
        execute.reset_mock()
        with pytest.raises(RuntimeError) as caught:
            hook(context)
        assert caught.value is failure
        execute.assert_called_once_with(context)


class ServiceFixture:
    def __init__(self, delivery, live):
        self.calls = []
        self.fail_candidate = False
        self.delivery = delivery
        self.live = live
        self.running = live.resolve()
        self.interrupt_restart = False

    def check(self, target):
        self.calls.append(("check", target))
        return self.delivery

    def verify(self, target):
        self.calls.append(("verify", target))
        assert self.running == target
        if self.fail_candidate and target.parent.name.startswith("r01-"):
            raise RuntimeError("synthetic restart failed")
        return self.delivery

    def running_process(self):
        return (42, self.running) if self.running else (None, None)

    def restart(self):
        self.calls.append(("restart", None))
        if self.interrupt_restart:
            raise RuntimeError("synthetic_restart_interrupted")
        self.running = self.live.resolve()

    def rollback_safe(self, root):
        assert root == self.delivery
        self.calls.append(("rollback_safe", root))

    def stage(self, target):
        self.calls.append(("stage", target))


@pytest.fixture
def release(tmp_path, monkeypatch):
    original = tmp_path / "releases" / "old" / "server"
    shared = tmp_path / "shared"
    shared.mkdir()
    for name in (*native.FILES, "src/services/research.js",
                 "src/services/wechat-message-push.js", "src/services/wechat-virtual-payment.js",
                 "package.json", "package-lock.json", ".env"):
        path = original / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if name == native.V21:
            path.write_bytes((ROOT / "server" / native.V21).read_bytes())
        else:
            path.write_text("baseline:" + name)
    (original / "node_modules").mkdir()
    for name in ("data", "uploads"):
        (original / name).symlink_to(shared)
    (tmp_path / "server").symlink_to(original)
    baseline = native.inventory(original)
    monkeypatch.setattr(native, "BASELINE_SHA256", {p: baseline[p][1] for p in native.FILES})
    contents = {name: (ROOT / "server" / name).read_bytes() for name in native.FILES}
    payload = {p: b64encode(raw).decode() for p, raw in contents.items()}
    service = ServiceFixture(shared / "delivery-packages", tmp_path / "server")
    instance = native.Release(tmp_path, {"run_id": "run-fixture"},
                              {p: native.digest(raw) for p, raw in contents.items()},
                              {"v21_sha256": baseline[native.V21][1],
                               "baseline_inventory_sha256": native.digest(native.encode(baseline))}, service)
    return instance, original, baseline, payload


@pytest.mark.parametrize("fault, reason", [("missing", "payload_scope"), ("wrong", "payload_digest")])
def test_invalid_payload_fails_before_any_native_command(release, fault, reason):
    run, original, _, payload = release
    payload = dict(payload)
    if fault == "missing":
        del payload[native.FILES[-1]]
    else:
        payload[native.FILES[0]] = b64encode(b"wrong").decode()
    with pytest.raises(RuntimeError, match=reason):
        run.execute("stage", payload)
    assert run.service.calls == [] and run.live.resolve() == original


def test_wrong_adapter_scope_never_invokes_transport(monkeypatch):
    calls = []
    monkeypatch.setattr(adapter.subprocess, "run", lambda *a, **kw: calls.append(a))
    for field in ("target", "version", "resource"):
        values = dict(module=adapter.MODULE, resource=adapter.MODULE, profile="feature",
                      target=adapter.TARGET, version=native.VERSION)
        values[field] = "wrong"
        with pytest.raises(RuntimeError, match="target_version_scope"):
            adapter.Adapter().execute(SimpleNamespace(**values))
    assert calls == []


def test_expired_or_wrong_payload_grant_is_rejected():
    manifest = {"file": "a" * 64, native.V21: native.V21_SHA256}
    identity = {"source_sha": "b" * 40}
    now = datetime(2026, 11, 12, tzinfo=timezone.utc)
    grant = {**identity, "payload_sha256": native.digest(native.encode(manifest)),
             "scope": "mini_r01_software_only_no_enable_no_delivery", "explicit_human_approval": True,
             "starts_at": "2026-11-11T00:00:00+00:00", "expires_at": "2026-11-11T01:00:00+00:00",
             "baseline_inventory_sha256": "c" * 64, "v21_sha256": native.V21_SHA256}
    with pytest.raises(RuntimeError, match="approval_expired"):
        native.check_grant(grant, identity, manifest, now, recovery=False)
    native.check_grant(grant, identity, manifest, now, recovery=True)
    with pytest.raises(RuntimeError, match="approval_scope"):
        native.check_grant(grant, identity, {"file": "e" * 64}, now, recovery=True)


def test_staged_overlay_preserves_legacy_and_restores_after_switch_failure(release):
    run, original, baseline, payload = release
    for phase in ("check", "backup", "stage", "before_switch"):
        assert run.execute(phase, payload if phase == "stage" else {})["verified"]
    staged = native.inventory(run.candidate)
    assert {p: entry for p, entry in staged.items() if p not in native.FILES} == {
        p: entry for p, entry in baseline.items() if p not in native.FILES}
    assert all(staged[path][1] == run.manifest[path] for path in native.FILES)
    run.service.fail_candidate = True
    with pytest.raises(RuntimeError, match="synthetic restart failed"):
        run.execute("switch", {})
    assert run.live.resolve() == run.candidate and run.state()["phase"] == "switching"
    for phase in ("before_rollback", "rollback", "verify_rollback"):
        assert run.execute(phase, {})["verified"]
    assert run.live.resolve() == original and native.inventory(original) == baseline
    assert [name for name, _ in run.service.calls].count("restart") == 2
    assert ("rollback_safe", run.service.delivery) in run.service.calls


def test_old_reader_rollback_requires_durable_scoped_revocation(tmp_path):
    import json
    key = "delivery_package_synthetic"
    document = {"delivery_package_id": key, "client_id": "c", "project_id": "p",
                "version_pins": {"artifact_delivery_profile": "r01_sealed_h5_pdf"}}
    (tmp_path / (key + ".json")).write_text(json.dumps(document))
    with pytest.raises(RuntimeError, match="rollback_r01_reconciliation_required"):
        native.Service().rollback_safe(tmp_path)
    (tmp_path / "_revocations").mkdir()
    (tmp_path / "_revocations" / (key + ".json")).write_text(json.dumps(
        {"packageId": key, "clientId": "c", "projectId": "p"}))
    native.Service().rollback_safe(tmp_path)


def test_nonprivate_grant_is_rejected_before_transport(tmp_path, monkeypatch):
    import json

    run = tmp_path / "run-test"
    grants = tmp_path / "approvals"
    run.mkdir()
    grants.mkdir()
    grant = grants / "approved.json"
    grant.write_text("{}")
    grant.chmod(0o644)
    scope = dict(module=adapter.MODULE, resource=adapter.MODULE, profile="feature",
                 target=adapter.TARGET, version=native.VERSION)
    context = SimpleNamespace(**scope, phase="stage", source_sha="a" * 40,
                              approval_ref="approved", run_directory=run)
    plan = dict(source={"sha": context.source_sha}, recipe=scope)
    plan_hash = adapter.manager.digest(adapter.manager.encoded(plan))
    context_file = run / "context.json"
    context_file.write_text(json.dumps(dict(**scope, phase=context.phase, source_sha=context.source_sha,
                                             approval_ref=context.approval_ref, run_directory=str(run),
                                             plan_sha256=plan_hash)))
    (run / "status.json").write_text(json.dumps(dict(plan=plan, plan_sha256=plan_hash,
                                                     status="running", active_phase=context.phase,
                                                     approval_ref=context.approval_ref)))
    monkeypatch.setenv("GEOGI_RELEASE_CONTEXT", str(context_file))
    calls = []
    monkeypatch.setattr(adapter.subprocess, "run", lambda *a, **kw: calls.append(a))
    with pytest.raises(RuntimeError, match="private_file_required"):
        adapter.Adapter().execute(context)
    assert calls == []


def test_grant_consumption_fences_other_runs_and_unbound_stage(tmp_path):
    path = tmp_path / "approval.consumed.json"
    identity = {"plan_sha256": "a" * 64, "run_id": "run-owner"}
    sha = "b" * 64
    with pytest.raises(RuntimeError, match="approval_run_unbound"):
        native.bind_run(path, identity, sha, create=False)
    native.bind_run(path, identity, sha, create=True)
    native.bind_run(path, identity, sha, create=False)
    with pytest.raises(RuntimeError, match="approval_already_consumed"):
        native.bind_run(path, {**identity, "run_id": "run-foreign"}, sha, create=True)


def test_real_revocation_writer_and_historical_marker_compatibility(tmp_path):
    store = ROOT / "server/src/services/delivery-package-store.js"
    completed, incomplete = ("delivery_package_" + ch * 24 for ch in "12")
    fixture = ROOT / "tests/fixtures/mini_r01_sealed_package.json"
    subprocess.run(["node", "-e", """
        const fs = require('fs');
        const path = require('path');
        const [storePath, root, fixture, completed, incomplete] = process.argv.slice(1);
        process.env.GEOGI_DELIVERY_PACKAGE_ROOT = root;
        const store = require(storePath);
        (async () => {
          const template = JSON.parse(fs.readFileSync(fixture, 'utf8'));
          delete template.package_hash;
          for (const id of [completed, incomplete]) {
            const document = { ...template, delivery_package_id: id };
            document.package_hash = store.sha256Canonical(document);
            await store.importDeliveryPackage(document);
            if (id === completed) await store.completeR01Delivery(document);
            await store.revokeDeliveryPackage(id, {
              clientId: document.client_id, projectId: document.project_id, reason: 'synthetic withdrawal'
            });
          }
        })().catch(error => { console.error(error); process.exitCode = 1; });
        """, str(store), str(tmp_path), str(fixture), completed, incomplete], check=True, timeout=10)
    safety = native.Service()
    for package in (completed, incomplete):
        marker = tmp_path / "_revocations" / (package + ".json")
        current = marker.read_bytes()
        assert current.endswith(b"\n") and json.loads(current)["packageId"] == package
        safety.rollback_safe(tmp_path)
        historical = current[:-1] + b"\\n"
        marker.write_bytes(historical)
        safety.rollback_safe(tmp_path)
        for field in ("packageId", "clientId", "projectId"):
            marker.write_text(json.dumps({**json.loads(current), field: "wrong"}))
            with pytest.raises(RuntimeError, match="rollback_r01_reconciliation_required"):
                safety.rollback_safe(tmp_path)
        for damaged in (historical + b"\\n", current + b"junk", b"truncated"):
            marker.write_bytes(damaged)
            with pytest.raises(json.JSONDecodeError):
                safety.rollback_safe(tmp_path)
        marker.write_bytes(historical)


@pytest.mark.parametrize("running_after_failure", ["candidate", "stopped", "foreign", "baseline"])
def test_rollback_resumes_using_actual_service_identity(release, running_after_failure):
    run, original, baseline, payload = release
    for phase in ("check", "backup", "stage", "before_switch", "switch", "verify"):
        run.execute(phase, payload if phase == "stage" else {})
    assert run.service.running == run.candidate

    run.execute("before_rollback", {})
    run.service.interrupt_restart = True
    with pytest.raises(RuntimeError, match="synthetic_restart_interrupted"):
        run.execute("rollback", {})
    assert run.live.resolve() == original
    assert run.service.running == run.candidate
    assert run.state()["phase"] == "rollback_restarting"
    with pytest.raises(RuntimeError, match="rollback_required"):
        run.execute("verify_rollback", {})

    observed = {"candidate": run.candidate, "stopped": None, "foreign": original.parent / "unknown",
                "baseline": original}
    run.service.running = observed[running_after_failure]
    run.service.interrupt_restart = False
    restarts = run.service.calls.count(("restart", None))
    run.execute("before_rollback", {})
    assert run.state()["phase"] == "rollback_restarting"
    if running_after_failure == "foreign":
        with pytest.raises(RuntimeError, match="newer_service_owns_target"):
            run.execute("rollback", {})
        assert run.state()["phase"] == "rollback_restarting"
        assert run.service.calls.count(("restart", None)) == restarts
    else:
        run.execute("rollback", {})
        assert run.service.calls.count(("restart", None)) == restarts + (
            running_after_failure != "baseline")
        assert run.service.running == original
        assert run.state()["phase"] == "rolled_back"
        run.execute("verify_rollback", {})
    assert native.inventory(original) == baseline


def test_preserved_v21_bytes_cannot_be_substituted_in_release_grant():
    path = ROOT / "server" / native.V21
    assert native.digest(path.read_bytes()) == native.V21_SHA256
    identity = {"source_sha": "a" * 40}
    substituted = "b" * 64
    manifest = {native.V21: substituted}
    grant = {**identity, "payload_sha256": native.digest(native.encode(manifest)),
             "scope": "mini_r01_software_only_no_enable_no_delivery", "explicit_human_approval": True,
             "starts_at": "2026-11-12T00:00:00+00:00", "expires_at": "2026-11-12T01:00:00+00:00",
             "baseline_inventory_sha256": "c" * 64, "v21_sha256": substituted}
    with pytest.raises(RuntimeError, match="approval_v21_identity"):
        native.check_grant(grant, identity, manifest, datetime(2026, 11, 12, tzinfo=timezone.utc),
                           recovery=False)
