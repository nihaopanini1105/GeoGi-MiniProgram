"""Opt-in R03 real OS Python urllib -> isolated Mini Express HTTP probe.

Runs ONLY against a synthetic loopback server already started by Mini's
report_r03_http_regression.js fixture. Uses actual OS MiniProgramBridgeClient.
No live WeChat, billing, Feishu, A01, production or customer data.
"""
from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit


def _require_environment():
    if len(sys.argv) != 3 or sys.argv[1] not in {"prebind", "access", "revoke"}:
        raise RuntimeError("r03_test_probe_phase_invalid")
    raw_root = os.environ.get("GEOGI_R03_TEST_OS_ROOT", "")
    expected = os.environ.get("GEOGI_R03_TEST_OS_SHA", "")
    endpoint = os.environ.get("GEOGI_R03_TEST_BRIDGE_URL", "")
    token = os.environ.get("GEOGI_R03_TEST_BRIDGE_TOKEN", "")
    if (not os.path.isabs(raw_root) or not re.fullmatch(r"[0-9a-f]{40}", expected)
            or not token.startswith("synthetic-r03-loopback-")
            or len(token) > 150):
        raise RuntimeError("r03_test_probe_scope_missing")
    parsed = urlsplit(endpoint)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
            or parsed.username is not None or parsed.password is not None
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment
            or parsed.port is None or parsed.port <= 0):
        raise RuntimeError("r03_test_probe_loopback_only")
    root = Path(raw_root).resolve(strict=True)
    path = Path(sys.argv[2]).resolve(strict=True)
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("r03_test_probe_package_missing")
    sha = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        timeout=5, text=True).strip()
    if sha != expected:
        raise RuntimeError("r03_test_probe_os_sha_mismatch")
    if subprocess.check_output(
            ["git", "-C", str(root), "status", "--porcelain"],
            timeout=5, text=True).strip():
        raise RuntimeError("r03_test_probe_os_worktree_not_clean")
    return sys.argv[1], path, root, expected, endpoint, token


def main():
    phase, package_file, root, sha, endpoint, token = _require_environment()
    sys.path.insert(0, str(root))
    from apps.operations_admin.miniprogram_bridge import (
        MiniProgramBridgeClient, MiniProgramBridgeConfig,
    )
    bridge = MiniProgramBridgeClient(
        MiniProgramBridgeConfig(base_url=endpoint, token=token))
    package = json.loads(package_file.read_text(encoding="utf-8"))
    lineage = package["r03_current_cycle_source_readback"]
    checks = []
    if phase == "prebind":
        binding = bridge.verify_report_r03_customer_binding(
            package["client_id"], package["project_id"],
            snapshot_sha256=package["report_reference"]["content_hash"][7:],
            source_observation_batch_id=lineage["source_observation_batch_id"],
            source_score_snapshot_id=lineage["source_score_snapshot_id"],
            source_retest_comparison_id=lineage["source_retest_comparison_id"],
        )
        assert binding["verified"] is True and binding["grant_id"].startswith(
            "synthetic_release_grant_"), "os_six_pin_real_http_binding_failed"
        checks.append("real_python_six_pin_signed_prebind")
        bad = bridge.verify_report_r03_customer_binding(
            package["client_id"], package["project_id"],
            snapshot_sha256=package["report_reference"]["content_hash"][7:],
            source_observation_batch_id=lineage["source_observation_batch_id"],
            source_score_snapshot_id="other_synthetic_epoch",
            source_retest_comparison_id=lineage["source_retest_comparison_id"],
        )
        assert bad.get("verified") is False, "os_wrong_epoch_binding_not_denied"
        checks.append("real_python_wrong_epoch_denied")
    elif phase == "access":
        assert bridge.verify_report_r03_customer_access(package)["accessible"] is True, (
            "os_nine_pin_access_real_http_failed")
        checks.append("real_python_nine_pin_access")
        wrong_pdf = deepcopy(package)
        wrong_pdf["artifacts"][1]["sha256"] = "e" * 64
        assert bridge.verify_report_r03_customer_access(wrong_pdf)["accessible"] is False, (
            "os_cross_repo_wrong_pdf_not_denied")
        checks.append("real_python_wrong_pdf_scope_denied")
        wrong_client = deepcopy(package)
        wrong_client["client_id"] = "client_other_synthetic"
        assert bridge.verify_report_r03_customer_access(wrong_client)["accessible"] is False, (
            "os_cross_repo_wrong_client_not_denied")
        checks.append("real_python_cross_client_denied")
    else:
        revoked = bridge.revoke_report_r03_delivery(
            package, reason="synthetic_python_bridge_revoke")
        assert revoked.get("status") == "revoked", "os_real_http_revoke_failed"
        checks.append("real_python_revoke")
        assert bridge.verify_report_r03_customer_access(package)["accessible"] is False, (
            "os_revoked_access_not_denied")
        checks.append("real_python_revoked_access_denied")
    print(json.dumps({
        "status": "passed", "phase": phase, "os_sha": sha,
        "synthetic_only": True, "production_connected": False,
        "business_accepted": False, "checks": checks,
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
