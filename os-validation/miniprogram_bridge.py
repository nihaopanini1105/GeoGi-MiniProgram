from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


class MiniProgramBridgeError(RuntimeError):
    pass


@dataclass(frozen=True)
class MiniProgramBridgeConfig:
    base_url: str
    token: str
    timeout_seconds: float = 8.0
    stage_timeout_seconds: float = 30.0

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.token)


class MiniProgramBridgeClient:
    def __init__(self, config: MiniProgramBridgeConfig):
        self.config = config

    @classmethod
    def from_environment(cls) -> "MiniProgramBridgeClient | None":
        base_url = os.environ.get("GEOGI_MINIPROGRAM_BRIDGE_URL", "").strip().rstrip("/")
        token = os.environ.get("GEOGI_MINIPROGRAM_BRIDGE_TOKEN", "").strip()
        if not base_url and not token:
            return None
        if not base_url or not token:
            raise MiniProgramBridgeError("miniprogram_bridge_configuration_incomplete")
        return cls(MiniProgramBridgeConfig(base_url=base_url, token=token))

    def _decode(self, raw: str) -> dict[str, Any]:
        try:
            data = json.loads(raw) if raw else {}
        except json.JSONDecodeError as exc:
            raise MiniProgramBridgeError("miniprogram_bridge_invalid_json") from exc
        if not isinstance(data, dict) or data.get("ok") is not True:
            raise MiniProgramBridgeError(str(data.get("error") or "miniprogram_bridge_invalid_response"))
        return data

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        if not self.config.configured:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        headers = {
            "Authorization": f"Bearer {self.config.token}",
            "Accept": "application/json",
        }
        if body is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        request = Request(f"{self.config.base_url}{path}", data=body, headers=headers, method=method)
        effective_timeout = self.config.timeout_seconds if timeout_seconds is None else float(timeout_seconds)
        try:
            with urlopen(request, timeout=effective_timeout) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8")).get("error", "bridge_http_error")
            except Exception:
                detail = "bridge_http_error"
            raise MiniProgramBridgeError(f"miniprogram_bridge_http_{exc.code}:{detail}") from exc
        except (URLError, TimeoutError) as exc:
            raise MiniProgramBridgeError("miniprogram_bridge_unreachable") from exc
        return self._decode(raw)

    def list_intakes(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/internal/os/intakes")
        items = data.get("items") or []
        if not isinstance(items, list):
            raise MiniProgramBridgeError("miniprogram_bridge_invalid_intake_list")
        return [dict(item) for item in items if isinstance(item, dict)]

    def list_payments(self) -> dict[str, Any]:
        data = self._request("GET", "/internal/os/payments")
        summary = data.get("summary") or {}
        items = data.get("items") or []
        if not isinstance(summary, dict) or not isinstance(items, list):
            raise MiniProgramBridgeError("miniprogram_bridge_invalid_payment_list")
        return {
            "summary": dict(summary),
            "items": [dict(item) for item in items if isinstance(item, dict)],
        }

    def channel_dashboard(self) -> dict[str, Any]:
        data = self._request("GET", "/internal/os/channels")
        channels = data.get("channels") or []
        sources = data.get("sources") or []
        orders = data.get("orders") or []
        commissions = data.get("commissions") or []
        monthly = data.get("monthly") or []
        owner_stats = data.get("ownerStats") or []
        if not all(isinstance(value, list) for value in (channels, sources, orders, commissions, monthly, owner_stats)):
            raise MiniProgramBridgeError("miniprogram_bridge_invalid_channel_dashboard")
        return {
            "channels": [dict(item) for item in channels if isinstance(item, dict)],
            "sources": [dict(item) for item in sources if isinstance(item, dict)],
            "orders": [dict(item) for item in orders if isinstance(item, dict)],
            "commissions": [dict(item) for item in commissions if isinstance(item, dict)],
            "monthly": [dict(item) for item in monthly if isinstance(item, dict)],
            "ownerStats": [dict(item) for item in owner_stats if isinstance(item, dict)],
        }

    def upsert_channel(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = self._request("POST", "/internal/os/channels", dict(payload))
        channel = data.get("channel")
        if not isinstance(channel, dict):
            raise MiniProgramBridgeError("miniprogram_bridge_invalid_channel_response")
        return dict(channel)

    def upsert_source(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = self._request("POST", "/internal/os/sources", dict(payload))
        source = data.get("source")
        if not isinstance(source, dict):
            raise MiniProgramBridgeError("miniprogram_bridge_invalid_source_response")
        return dict(source)

    def generate_source_miniprogram_code(self, source_id: str) -> dict[str, Any]:
        clean_source_id = str(source_id or "").strip()
        if not clean_source_id:
            raise MiniProgramBridgeError("source_id_required")
        data = self._request(
            "POST",
            f"/internal/os/sources/{quote(clean_source_id, safe='')}/miniprogram-code",
            {},
            timeout_seconds=max(self.config.timeout_seconds, 30.0),
        )
        result = data.get("result")
        if not isinstance(result, dict):
            raise MiniProgramBridgeError("miniprogram_bridge_invalid_source_code_response")
        return dict(result)

    def settle_channel_period(
        self,
        channel_id: str,
        period: str,
        *,
        operator_id: str = "",
        payout_reference: str = "",
    ) -> dict[str, Any]:
        clean_channel_id = str(channel_id or "").strip()
        clean_period = str(period or "").strip()
        if not clean_channel_id or not clean_period:
            raise MiniProgramBridgeError("channel_settlement_scope_required")
        data = self._request(
            "POST",
            f"/internal/os/channels/{quote(clean_channel_id, safe='')}/settlements/{quote(clean_period, safe='')}",
            {
                "operatorId": str(operator_id or "").strip(),
                "payoutReference": str(payout_reference or "").strip(),
            },
        )
        result = data.get("result")
        if not isinstance(result, dict):
            raise MiniProgramBridgeError("miniprogram_bridge_invalid_channel_settlement_response")
        return dict(result)

    def refund_payment(
        self,
        out_trade_no: str,
        *,
        amount_fen: int | None = None,
        reason: str = "",
        operator_id: str = "",
    ) -> dict[str, Any]:
        trade_no = str(out_trade_no or "").strip()
        if not trade_no:
            raise MiniProgramBridgeError("payment_out_trade_no_required")
        payload: dict[str, Any] = {
            "reason": str(reason or "").strip(),
            "operatorId": str(operator_id or "").strip(),
        }
        if amount_fen is not None:
            payload["amountFen"] = int(amount_fen)
        data = self._request(
            "POST",
            f"/internal/os/payments/{quote(trade_no, safe='')}/refund",
            payload,
            timeout_seconds=max(self.config.timeout_seconds, 30.0),
        )
        result = data.get("result")
        if not isinstance(result, dict):
            raise MiniProgramBridgeError("miniprogram_bridge_invalid_refund_response")
        return dict(result)

    def update_project_stage(self, external_project_id: str, stage: str) -> dict[str, Any]:
        if not external_project_id:
            raise MiniProgramBridgeError("external_project_id_required")
        data = self._request(
            "POST",
            f"/internal/os/projects/{quote(external_project_id, safe='')}/stage",
            {"stage": stage},
            timeout_seconds=max(self.config.timeout_seconds, self.config.stage_timeout_seconds),
        )
        result = data.get("result")
        if not isinstance(result, dict):
            raise MiniProgramBridgeError("miniprogram_bridge_invalid_stage_response")
        return dict(result)

    def upload_artifact(self, *, path: Path, file_name: str, sha256: str, size_bytes: int, mime_type: str) -> dict[str, Any]:
        if not self.config.configured:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        path = Path(path)
        if not path.is_file():
            raise MiniProgramBridgeError("miniprogram_artifact_file_missing")
        body = path.read_bytes()
        if len(body) != int(size_bytes):
            raise MiniProgramBridgeError("miniprogram_artifact_size_changed_before_upload")
        headers = {
            "Authorization": f"Bearer {self.config.token}",
            "Accept": "application/json",
            "Content-Type": "application/octet-stream",
            "X-GeoGi-Artifact-Filename": file_name,
            "X-GeoGi-Artifact-Sha256": sha256,
            "X-GeoGi-Artifact-Size": str(size_bytes),
            "X-GeoGi-Artifact-Mime-Type": mime_type,
        }
        request = Request(f"{self.config.base_url}/internal/os/artifacts", data=body, headers=headers, method="POST")
        try:
            with urlopen(request, timeout=max(self.config.timeout_seconds, 30.0)) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8")).get("error", "bridge_http_error")
            except Exception:
                detail = "bridge_http_error"
            raise MiniProgramBridgeError(f"miniprogram_artifact_http_{exc.code}:{detail}") from exc
        except (URLError, TimeoutError) as exc:
            raise MiniProgramBridgeError("miniprogram_artifact_unreachable") from exc
        data = self._decode(raw)
        result = data.get("result")
        if not isinstance(result, dict):
            raise MiniProgramBridgeError("miniprogram_artifact_invalid_response")
        if result.get("fileName") != file_name or result.get("sha256") != sha256 or int(result.get("sizeBytes") or -1) != int(size_bytes):
            raise MiniProgramBridgeError("miniprogram_artifact_integrity_response_mismatch")
        return dict(result)

    def publish_delivery_package(self, delivery_package: dict[str, Any]) -> dict[str, Any]:
        if delivery_package.get("object_type") != "delivery_package":
            raise MiniProgramBridgeError("delivery_package_required")
        if delivery_package.get("delivery_contract_version") != "3.0.0":
            raise MiniProgramBridgeError("delivery_contract_version_3_required")
        if delivery_package.get("delivery_mode") != "artifact_only":
            raise MiniProgramBridgeError("artifact_only_delivery_required")
        if delivery_package.get("production_authority") != "geogi_os":
            raise MiniProgramBridgeError("geogi_os_production_authority_required")
        purpose = delivery_package.get("delivery_purpose")
        authority = delivery_package.get("release_authority")
        allowed = {
            "baseline_diagnostic_report": "baseline_diagnostic_release_v1",
            "final_outcome_report": "m09_e2c_final_release",
        }
        if purpose not in allowed or authority != allowed[purpose]:
            raise MiniProgramBridgeError("delivery_purpose_or_release_authority_invalid")
        if "display_summary" in delivery_package:
            raise MiniProgramBridgeError("client_report_recomposition_forbidden")
        policy = delivery_package.get("display_policy") or {}
        if not isinstance(policy, dict) or policy.get("artifact_only") is not True:
            raise MiniProgramBridgeError("display_policy_artifact_only_required")
        if any(policy.get(key) is not False for key in (
            "client_recomposition_allowed",
            "client_scoring_allowed",
            "client_summary_generation_allowed",
            "client_diagnosis_generation_allowed",
        )):
            raise MiniProgramBridgeError("client_side_production_capability_forbidden")
        if delivery_package.get("release_status") != "released":
            raise MiniProgramBridgeError("released_delivery_package_required")
        data = self._request("POST", "/internal/os/delivery-packages", delivery_package)
        result = data.get("result")
        if not isinstance(result, dict):
            raise MiniProgramBridgeError("miniprogram_bridge_invalid_delivery_response")
        return dict(result)
