from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Mapping

from tools.modules.customer_operations.control_plane import record_operation_event
from tools.modules.foundation_identity import (
    build_prospect_foundation_bundle,
    validate_prospect_foundation_bundle,
)
from tools.modules.query_demand.prospect_detection_planning import (
    build_enterprise_service_detection_candidates,
    materialize_approved_detection_plan,
)

from .action_registry import action_registry
from .brand_profile_editing import apply_manual_brand_profile_fields
from .commercial_catalog import GEOGI_DIAGNOSTIC_LIST_PRICE_FEN
from .miniprogram_bridge import MiniProgramBridgeClient, MiniProgramBridgeError

PAID_DIAGNOSTIC_LAUNCH_CUTOFF = "2026-09-22T07:33:31Z"
LEGACY_PAYMENT_EXEMPTION_REASON = "submitted_before_paid_diagnostic_launch"
from .production_routed_service import ProductionRoutedOperationsAdminService
from .routed_service import _now


ROOT = Path(__file__).resolve().parents[2]
INDUSTRY_PACK_ROOT = ROOT / "data" / "industry_packs"


def _customer_intake_attachment_id(intake: Mapping[str, Any]) -> str:
    """Stable provenance ID for the customer-submitted MiniProgram intake snapshot.

    This is not verification of any customer claim. It identifies the real intake payload that
    M01 uses as client-asserted evidence.
    """
    canonical = json.dumps(dict(intake), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    return f"customer_attachment_{digest}"


def _split_customer_values(value: Any) -> tuple[str, ...]:
    if isinstance(value, (list, tuple)):
        values = [str(item or "").strip() for item in value]
    else:
        values = [item.strip() for item in re.split(r"[、,，;；\n]+", str(value or ""))]
    return tuple(dict.fromkeys(item for item in values if item))


def _customer_intake_snapshot(intake: Mapping[str, Any]) -> dict[str, Any]:
    """Return the customer-asserted business profile carried by the MiniProgram bridge.

    The snapshot is intentionally labelled client_asserted and must never be interpreted as
    verified legal identity, verified official-source evidence, or an OS-derived diagnosis.
    """
    keys = (
        "submissionId",
        "brandName",
        "companyName",
        "industry",
        "segment",
        "officialChannel",
        "website",
        "officialWebsite",
        "market",
        "offerings",
        "audiences",
        "advantages",
        "competitors",
        "goals",
        "attachments",
        "submittedAt",
        "source",
    )
    snapshot = {key: intake.get(key) for key in keys if intake.get(key) not in (None, "", [])}
    snapshot["assertion_status"] = "client_asserted"
    return snapshot


def _customer_intake_record(
    *,
    intake: Mapping[str, Any],
    attachment_id: str,
    canonical_client_id: str,
    canonical_project_id: str,
    created_at: str,
    created_by: str,
) -> dict[str, Any]:
    """Persist the real MiniProgram submission as M11 read-model evidence.

    This object preserves the customer's submitted business context for downstream operators and
    report lineage without promoting any claim to verified M01 identity authority.
    """
    return {
        "schema_version": "1.0.0",
        "object_id": attachment_id,
        "object_type": "customer_attachment",
        "customer_attachment_id": attachment_id,
        "client_id": canonical_client_id,
        "project_id": canonical_project_id,
        "created_at": created_at,
        "created_by": created_by,
        "source_system": "wechat_miniprogram",
        "lifecycle_status": "active",
        "review_status": "approved",
        "sensitivity_level": "internal",
        "evidence_kind": "customer_submitted_intake",
        "assertion_status": "client_asserted",
        "external_customer_id": str(intake.get("clientId") or ""),
        "external_project_id": str(intake.get("projectId") or ""),
        "submission_id": str(intake.get("submissionId") or ""),
        "business_profile": _customer_intake_snapshot(intake),
    }


def _approved_industry_packs(root: Path = INDUSTRY_PACK_ROOT) -> list[dict[str, Any]]:
    packs: list[dict[str, Any]] = []
    if not root.exists():
        return packs
    for path in root.rglob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        reference_id = str(payload.get("industry_pack_reference_id") or "")
        if (
            reference_id.startswith("industry_pack_reference_")
            and payload.get("review_status") == "approved"
            and payload.get("lifecycle_status") == "active"
        ):
            packs.append({
                "industry_pack_reference_id": reference_id,
                "industry_pack_id": str(payload.get("industry_pack_id") or ""),
                "pack_name": str(payload.get("pack_name") or reference_id),
                "industry_domain": str(payload.get("industry_domain") or ""),
                "version": str(payload.get("industry_pack_version") or ""),
                "country_market": list(payload.get("country_market") or []),
                "compatibility_status": str(payload.get("compatibility_status") or "unknown"),
            })
    return sorted(packs, key=lambda item: (item["pack_name"], item["industry_pack_reference_id"]))


def _approved_industry_pack_ids(root: Path = INDUSTRY_PACK_ROOT) -> set[str]:
    return {item["industry_pack_reference_id"] for item in _approved_industry_packs(root)}


def _fingerprint_persisted_query_set(candidates: list[dict[str, Any]]) -> tuple[str, tuple[tuple[str, str], ...]]:
    """Fingerprint exact query wording in the governed QuerySet order.

    Database row order is deliberately not part of the approval contract. QuerySet.query_references
    is the authoritative sequence, so SQLite/PostgreSQL retrieval plans cannot alter the bytes that
    an operator reviewed in the Admin UI.
    """
    query_sets = [row for row in candidates if row.get("object_type") == "query_set"]
    if len(query_sets) != 1:
        raise ValueError("exactly_one_pending_query_set_required")
    query_set = query_sets[0]
    references = [str(value or "") for value in query_set.get("query_references") or []]
    queries = {
        str(row.get("query_id") or ""): row
        for row in candidates
        if row.get("object_type") == "query"
    }
    if len(references) != 12 or len(queries) != 12 or any(reference not in queries for reference in references):
        raise ValueError("exactly_twelve_pending_queries_required")
    query_pairs = tuple((reference, str(queries[reference].get("query_text") or "")) for reference in references)
    canonical = json.dumps(list(query_pairs), ensure_ascii=False, sort_keys=False, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest(), query_pairs


def _materialization_order(candidates: list[dict[str, Any]], query_pairs: tuple[tuple[str, str], ...]) -> list[dict[str, Any]]:
    """Preserve non-query candidates and append Query rows in authoritative QuerySet order."""
    query_map = {
        str(row.get("query_id") or ""): row
        for row in candidates
        if row.get("object_type") == "query"
    }
    ordered = [row for row in candidates if row.get("object_type") != "query"]
    ordered.extend(query_map[query_id] for query_id, _ in query_pairs)
    return ordered



def _semantic_detection_plan_version(revision_number: int) -> str:
    revision = max(1, int(revision_number or 1))
    return f"1.0.{revision - 1}"


def _detection_plan_revision_number(row: Mapping[str, Any]) -> int:
    metadata = row.get("metadata") or {}
    revision = metadata.get("detection_plan_revision") or {}
    try:
        value = int(revision.get("revision_number") or 0)
    except (TypeError, ValueError):
        value = 0
    if value > 0:
        return value
    semantic = str(row.get("semantic_version") or "1.0.0")
    match = re.fullmatch(r"\d+\.\d+\.(\d+)", semantic)
    return int(match.group(1)) + 1 if match else 1


def _next_detection_plan_revision_number(records: list[dict[str, Any]]) -> int:
    versions = [
        _detection_plan_revision_number(row)
        for row in records
        if row.get("object_type") == "query_set"
    ]
    return (max(versions) + 1) if versions else 1


def _history_object_id(prefix: str, source_object_id: str, archived_at: str, reason: str) -> str:
    seed = f"{source_object_id}|{archived_at}|{reason}"
    return f"{prefix}_{hashlib.sha256(seed.encode('utf-8')).hexdigest()[:16]}"


def _archive_pending_queryset_version(
    candidates: list[dict[str, Any]],
    *,
    archived_at: str,
    archived_by: str,
    reason: str,
) -> list[dict[str, Any]]:
    """Persist an immutable snapshot before a pending detection plan is replaced or revised."""
    query_sets = [
        dict(row)
        for row in candidates
        if row.get("object_type") == "query_set"
        and str(row.get("review_status") or "") in {"pending_review", "changes_requested"}
        and str(row.get("lifecycle_status") or "") not in {"superseded", "archived", "rejected"}
    ]
    if not query_sets:
        return []
    query_set = sorted(
        query_sets,
        key=lambda row: str(row.get("updated_at") or row.get("created_at") or ""),
        reverse=True,
    )[0]
    references = [str(value or "") for value in query_set.get("query_references") or []]
    query_map = {
        str(row.get("query_id") or row.get("object_id") or ""): dict(row)
        for row in candidates
        if row.get("object_type") == "query"
        and str(row.get("review_status") or "") in {"pending_review", "changes_requested"}
        and str(row.get("lifecycle_status") or "") not in {"superseded", "archived", "rejected"}
    }
    if len(references) != 12 or any(reference not in query_map for reference in references):
        raise ValueError("detection_plan_history_requires_complete_pending_queryset")

    archived_queries: list[dict[str, Any]] = []
    archived_query_ids: dict[str, str] = {}
    for reference in references:
        source = query_map[reference]
        archived_id = _history_object_id("query", reference, archived_at, reason)
        metadata = dict(source.get("metadata") or {})
        metadata["detection_plan_history"] = {
            "archived_from_object_id": reference,
            "archived_at": archived_at,
            "archived_by": archived_by,
            "archive_reason": reason,
            "original_created_at": source.get("created_at"),
        }
        archived = dict(source)
        archived.update({
            "object_id": archived_id,
            "query_id": archived_id,
            "created_at": archived_at,
            "created_by": archived_by,
            "updated_at": archived_at,
            "updated_by": archived_by,
            "review_status": "changes_requested",
            "lifecycle_status": "superseded",
            "metadata": metadata,
        })
        archived_query_ids[reference] = archived_id
        archived_queries.append(archived)

    source_set_id = str(query_set.get("query_set_id") or query_set.get("object_id") or "")
    archived_set_id = _history_object_id("query_set", source_set_id, archived_at, reason)
    set_metadata = dict(query_set.get("metadata") or {})
    set_metadata["detection_plan_history"] = {
        "archived_from_object_id": source_set_id,
        "archived_at": archived_at,
        "archived_by": archived_by,
        "archive_reason": reason,
        "original_created_at": query_set.get("created_at"),
    }
    archived_set = dict(query_set)
    archived_set.update({
        "object_id": archived_set_id,
        "query_set_id": archived_set_id,
        "query_references": [archived_query_ids[reference] for reference in references],
        "created_at": archived_at,
        "created_by": archived_by,
        "updated_at": archived_at,
        "updated_by": archived_by,
        "review_status": "changes_requested",
        "lifecycle_status": "superseded",
        "metadata": set_metadata,
    })
    return [*archived_queries, archived_set]


def _latest_history_reference(records: list[dict[str, Any]], source_object_id: str) -> str | None:
    matches: list[dict[str, Any]] = []
    for row in records:
        history = (row.get("metadata") or {}).get("detection_plan_history") or {}
        if str(history.get("archived_from_object_id") or "") == source_object_id:
            matches.append(row)
    if not matches:
        return None
    latest = sorted(
        matches,
        key=lambda row: str(
            ((row.get("metadata") or {}).get("detection_plan_history") or {}).get("archived_at")
            or row.get("created_at")
            or ""
        ),
        reverse=True,
    )[0]
    return str(latest.get("object_id") or "") or None


def _stamp_generated_detection_plan_revision(
    generated_records: list[dict[str, Any]],
    *,
    existing_records: list[dict[str, Any]],
    candidate_fingerprint: str,
    generated_at: str,
    generated_by: str,
    profile_id: str,
    profile_version: str,
) -> tuple[int, str]:
    revision_number = _next_detection_plan_revision_number(existing_records)
    semantic_version = _semantic_detection_plan_version(revision_number)
    for row in generated_records:
        if row.get("object_type") not in {"query", "query_set"}:
            continue
        row["semantic_version"] = semantic_version
        metadata = dict(row.get("metadata") or {})
        metadata["detection_plan_revision"] = {
            "revision_number": revision_number,
            "revision_origin": "generated",
            "revision_reason": "根据当前品牌企业画像生成检测方案",
            "candidate_fingerprint": candidate_fingerprint,
            "profile_id": profile_id,
            "profile_version": profile_version,
            "revised_at": generated_at,
            "revised_by": generated_by,
        }
        row["metadata"] = metadata
        if row.get("object_type") == "query":
            source_id = str(row.get("query_id") or row.get("object_id") or "")
            prior = _latest_history_reference(existing_records, source_id)
            row["supersedes"] = [prior] if prior else []
    return revision_number, semantic_version


def _revise_pending_queryset_version(
    candidates: list[dict[str, Any]],
    *,
    edits: list[dict[str, Any]],
    revised_at: str,
    revised_by: str,
    reason: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, int, str, int]:
    """Create a new pending semantic version while retaining the previous exact wording."""
    reason = str(reason or "").strip()
    if not reason:
        raise ValueError("detection_plan_revision_reason_required")
    query_sets = [
        dict(row)
        for row in candidates
        if row.get("object_type") == "query_set"
        and str(row.get("review_status") or "") in {"pending_review", "changes_requested"}
        and str(row.get("lifecycle_status") or "") not in {"superseded", "archived", "rejected"}
    ]
    if len(query_sets) != 1:
        raise ValueError("detection_plan_revision_requires_one_pending_queryset")
    query_set = query_sets[0]
    references = [str(value or "") for value in query_set.get("query_references") or []]
    query_map = {
        str(row.get("query_id") or row.get("object_id") or ""): dict(row)
        for row in candidates
        if row.get("object_type") == "query"
        and str(row.get("review_status") or "") in {"pending_review", "changes_requested"}
        and str(row.get("lifecycle_status") or "") not in {"superseded", "archived", "rejected"}
    }
    if len(references) != 12 or len(query_map) != 12 or any(reference not in query_map for reference in references):
        raise ValueError("detection_plan_revision_requires_complete_pending_queryset")

    edit_map: dict[str, dict[str, Any]] = {}
    for edit in edits:
        query_id = str(edit.get("query_id") or "").strip()
        if not query_id or query_id not in query_map:
            raise ValueError("detection_plan_revision_query_id_invalid")
        if query_id in edit_map:
            raise ValueError("detection_plan_revision_duplicate_query_edit")
        edit_map[query_id] = dict(edit)
    if not edit_map:
        raise ValueError("detection_plan_revision_requires_query_edits")

    revised_queries: list[dict[str, Any]] = []
    changed_count = 0
    for query_id in references:
        source = query_map[query_id]
        edit = edit_map.get(query_id)
        updated = dict(source)
        if edit is not None:
            query_text = str(edit.get("query_text") or "").strip()
            if not query_text:
                raise ValueError("detection_plan_revision_query_text_required")
            if len(query_text) > 1000:
                raise ValueError("detection_plan_revision_query_text_too_long")
            query_intent = str(edit.get("query_intent") or source.get("query_intent") or "").strip()
            if not query_intent:
                raise ValueError("detection_plan_revision_query_intent_required")
            if query_text != str(source.get("query_text") or "") or query_intent != str(source.get("query_intent") or ""):
                changed_count += 1
            updated["query_text"] = query_text
            updated["query_intent"] = query_intent
        revised_queries.append(updated)
    if changed_count == 0:
        raise ValueError("detection_plan_revision_has_no_changes")
    normalized_texts = [str(row.get("query_text") or "").strip().casefold() for row in revised_queries]
    if len(set(normalized_texts)) != len(normalized_texts):
        raise ValueError("detection_plan_revision_duplicate_query_text")

    archived = _archive_pending_queryset_version(
        candidates,
        archived_at=revised_at,
        archived_by=revised_by,
        reason="manual_revision:" + reason,
    )
    revision_number = _detection_plan_revision_number(query_set) + 1
    semantic_version = _semantic_detection_plan_version(revision_number)
    archived_by_source = {
        str(((row.get("metadata") or {}).get("detection_plan_history") or {}).get("archived_from_object_id") or ""):
        str(row.get("object_id") or "")
        for row in archived
        if row.get("object_type") == "query"
    }
    for updated in revised_queries:
        updated["review_status"] = "pending_review"
        updated["lifecycle_status"] = "pending_review"
        updated["updated_at"] = revised_at
        updated["updated_by"] = revised_by
        updated["semantic_version"] = semantic_version
        metadata = dict(updated.get("metadata") or {})
        metadata["detection_plan_revision"] = {
            "revision_number": revision_number,
            "revision_origin": "manual",
            "revision_reason": reason,
            "revised_at": revised_at,
            "revised_by": revised_by,
        }
        updated["metadata"] = metadata
        query_id = str(updated.get("query_id") or "")
        prior = archived_by_source.get(query_id)
        supersedes = [str(value) for value in updated.get("supersedes") or [] if str(value)]
        if prior:
            supersedes.append(prior)
        updated["supersedes"] = list(dict.fromkeys(supersedes))

    revised_set = dict(query_set)
    revised_set["review_status"] = "pending_review"
    revised_set["lifecycle_status"] = "pending_review"
    revised_set["updated_at"] = revised_at
    revised_set["updated_by"] = revised_by
    revised_set["semantic_version"] = semantic_version
    revised_set["scenario_coverage"] = [str(row.get("query_intent") or "") for row in revised_queries]
    revised_records = [*revised_queries, revised_set]
    fingerprint, _ = _fingerprint_persisted_query_set(revised_records)
    set_metadata = dict(revised_set.get("metadata") or {})
    set_metadata["detection_plan_revision"] = {
        "revision_number": revision_number,
        "revision_origin": "manual",
        "revision_reason": reason,
        "candidate_fingerprint": fingerprint,
        "revised_at": revised_at,
        "revised_by": revised_by,
    }
    revised_set["metadata"] = set_metadata
    for row in revised_queries:
        metadata = dict(row.get("metadata") or {})
        metadata["detection_plan_revision"]["candidate_fingerprint"] = fingerprint
        row["metadata"] = metadata
    return archived, revised_records, fingerprint, revision_number, semantic_version, changed_count

class IntegratedOperationsAdminService(ProductionRoutedOperationsAdminService):
    """M11 control plane integrated with the MiniProgram customer boundary.

    MiniProgram remains an intake/customer-view surface. M01-M10 remain business authorities.
    This service only orchestrates governed commands and projects their status back to customers.
    """

    def __init__(
        self,
        *args: Any,
        miniprogram_bridge: MiniProgramBridgeClient | None = None,
        **kwargs: Any,
    ):
        super().__init__(*args, **kwargs)
        self.miniprogram_bridge = miniprogram_bridge

    def operator_actions(self, principal) -> dict[str, Any]:
        self._require(principal, "workspace.read")
        capabilities = self.execution_capabilities(principal)
        return {
            "items": list(action_registry()),
            "integration": {
                "miniprogram_bridge": {
                    "status": "available" if self.miniprogram_bridge is not None else "not_configured",
                    "reason": None if self.miniprogram_bridge is not None else "GEOGI_MINIPROGRAM_BRIDGE_URL/TOKEN_not_configured",
                },
                "m04_capture": capabilities.get("m04_capture", {}),
                "m07_materialize_execution": capabilities.get("m07_materialize_execution", {}),
                "m07_run_retest": capabilities.get("m07_run_retest", {}),
                "m09_release_report": capabilities.get("m09_release_report", {}),
            },
        }

    def list_industry_packs(self, principal) -> list[dict[str, Any]]:
        self._require(principal, "workspace.read")
        return _approved_industry_packs()

    def list_miniprogram_intakes(self, principal) -> list[dict[str, Any]]:
        self._require(principal, "workspace.read")
        if self.miniprogram_bridge is None:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        return self.miniprogram_bridge.list_intakes()

    def payment_dashboard(self, principal) -> dict[str, Any]:
        self._require(principal, "order.read")
        if self.miniprogram_bridge is None:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        result = self.miniprogram_bridge.list_payments()
        permissions = set(self.policy.get("permissions", {}).get(principal.role, []))
        result["permissions"] = {
            "can_refund": "order.write" in permissions,
        }
        return result

    def miniprogram_user_dashboard(self, principal) -> dict[str, Any]:
        self._require(principal, "order.read")
        if self.miniprogram_bridge is None:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        result = self.miniprogram_bridge.miniprogram_users()
        permissions = set(self.policy.get("permissions", {}).get(principal.role, []))
        result["permissions"] = {
            "can_write": "order.write" in permissions,
        }
        return result

    def save_miniprogram_user(self, principal, user_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        self._require(principal, "order.write")
        if self.miniprogram_bridge is None:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        user = self.miniprogram_bridge.update_miniprogram_user(user_id, dict(payload))
        return {
            "user": user,
            "updated_by": principal.actor_id,
        }

    def channel_dashboard(self, principal) -> dict[str, Any]:
        self._require(principal, "order.read")
        if self.miniprogram_bridge is None:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        result = self.miniprogram_bridge.channel_dashboard()
        permissions = set(self.policy.get("permissions", {}).get(principal.role, []))
        result["permissions"] = {
            "can_write": "order.write" in permissions,
            "can_settle": "order.write" in permissions,
        }
        return result

    def save_channel(self, principal, payload: Mapping[str, Any]) -> dict[str, Any]:
        self._require(principal, "order.write")
        if self.miniprogram_bridge is None:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        channel = self.miniprogram_bridge.upsert_channel(dict(payload))
        return {
            "channel": channel,
            "updated_by": principal.actor_id,
        }

    def save_source(self, principal, payload: Mapping[str, Any]) -> dict[str, Any]:
        self._require(principal, "order.write")
        if self.miniprogram_bridge is None:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        source = self.miniprogram_bridge.upsert_source(dict(payload))
        return {
            "source": source,
            "updated_by": principal.actor_id,
        }

    def generate_source_miniprogram_code(self, principal, source_id: str) -> dict[str, Any]:
        self._require(principal, "order.write")
        if self.miniprogram_bridge is None:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        return self.miniprogram_bridge.generate_source_miniprogram_code(source_id)

    def settle_channel_month(
        self,
        principal,
        channel_id: str,
        period: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        self._require(principal, "order.write")
        if self.miniprogram_bridge is None:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        payout_reference = str(payload.get("payout_reference") or "").strip()
        if not payout_reference:
            raise ValueError("channel_payout_reference_required")
        return self.miniprogram_bridge.settle_channel_period(
            channel_id,
            period,
            operator_id=principal.actor_id,
            payout_reference=payout_reference,
        )

    def refund_miniprogram_payment(
        self,
        principal,
        out_trade_no: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        self._require(principal, "order.write")
        if self.miniprogram_bridge is None:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        reason = str(payload.get("reason") or "").strip()
        if not reason:
            raise ValueError("refund_reason_required")
        raw_amount = payload.get("amount_fen")
        amount_fen = None if raw_amount in (None, "") else int(raw_amount)
        if amount_fen is not None and amount_fen <= 0:
            raise ValueError("refund_amount_must_be_positive")
        result = self.miniprogram_bridge.refund_payment(
            out_trade_no,
            amount_fen=amount_fen,
            reason=reason,
            operator_id=principal.actor_id,
        )
        return {
            "payment": result,
            "refund_requested_by": principal.actor_id,
            "refund_reason": reason,
        }

    def accept_miniprogram_intake(
        self,
        principal,
        external_project_id: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        self._require(principal, "profile.write")
        if self.miniprogram_bridge is None:
            raise MiniProgramBridgeError("miniprogram_bridge_not_configured")
        external_project_id = str(external_project_id or "").strip()
        industry_pack_reference_id = str(payload.get("industry_pack_reference_id") or "").strip()
        if not external_project_id:
            raise ValueError("external_project_id_required")
        if not industry_pack_reference_id:
            raise ValueError("industry_pack_reference_id_required")

        approved_pack_ids = _approved_industry_pack_ids()
        if industry_pack_reference_id not in approved_pack_ids:
            raise ValueError("approved_active_industry_pack_reference_required")

        intakes = self.miniprogram_bridge.list_intakes()
        intake = next((item for item in intakes if str(item.get("projectId") or "") == external_project_id), None)
        if intake is None:
            raise KeyError("miniprogram_intake_not_found")
        payment = intake.get("payment") or {}
        payment_status = str(payment.get("status") or "").strip()
        admission_mode = str(intake.get("paymentAdmissionMode") or "").strip()
        legacy_exemption = intake.get("legacyPaymentExemption") or {}
        legacy_admission = (
            admission_mode == "legacy_pre_payment"
            and legacy_exemption.get("eligible") is True
            and str(legacy_exemption.get("reason") or "") == LEGACY_PAYMENT_EXEMPTION_REASON
            and str(legacy_exemption.get("cutoffAt") or "") == PAID_DIAGNOSTIC_LAUNCH_CUTOFF
        )
        paid_admission = (
            admission_mode in {"", "paid"}
            and payment_status in {"paid", "partially_refunded"}
        )
        channel_offer_admission = (
            admission_mode == "channel_offer"
            and payment_status == "free"
        )
        if intake.get("paymentEligibleForProcessing") is not True or not (
            paid_admission or channel_offer_admission or legacy_admission
        ):
            raise ValueError("paid_diagnostic_order_required")

        if paid_admission or channel_offer_admission:
            list_price_fen = int(payment.get("listPriceFen") or GEOGI_DIAGNOSTIC_LIST_PRICE_FEN)
            paid_amount_fen = int(payment.get("amountTotal") or 0)
            if list_price_fen != GEOGI_DIAGNOSTIC_LIST_PRICE_FEN:
                raise ValueError("diagnostic_list_price_must_equal_19900")
            if paid_admission and not (0 < paid_amount_fen <= GEOGI_DIAGNOSTIC_LIST_PRICE_FEN):
                raise ValueError("diagnostic_paid_amount_invalid")
            if channel_offer_admission and paid_amount_fen != 0:
                raise ValueError("free_channel_offer_amount_must_equal_zero")
            discounted = paid_amount_fen < list_price_fen
            if discounted and not (
                str(payment.get("channelId") or "").strip()
                and str(payment.get("sourceId") or "").strip()
            ):
                raise ValueError("discounted_order_requires_channel_source_attribution")

        payment_admission = {
            "mode": (
                "paid"
                if paid_admission
                else ("channel_offer" if channel_offer_admission else "legacy_pre_payment")
            ),
            "payment_required": bool(intake.get("paymentRequired")),
            "list_price_fen": int(payment.get("listPriceFen") or GEOGI_DIAGNOSTIC_LIST_PRICE_FEN) if not legacy_admission else 0,
            "paid_amount_fen": int(payment.get("amountTotal") or 0) if not legacy_admission else 0,
            "channel_id": str(payment.get("channelId") or "") if not legacy_admission else "",
            "source_id": str(payment.get("sourceId") or "") if not legacy_admission else "",
            "source_name": str(payment.get("sourceName") or "") if not legacy_admission else "",
            "source_type": str(payment.get("sourceType") or "") if not legacy_admission else "",
            "legacy_reason": str(legacy_exemption.get("reason") or "") if legacy_admission else "",
            "legacy_cutoff_at": str(legacy_exemption.get("cutoffAt") or "") if legacy_admission else "",
        }
        external_customer_id = str(intake.get("clientId") or "").strip()
        brand_name = str(intake.get("brandName") or "").strip()
        if not external_customer_id or not brand_name:
            raise ValueError("miniprogram_intake_identity_incomplete")

        intake_attachment_id = _customer_intake_attachment_id(intake)
        customer_goals = _split_customer_values(intake.get("goals"))
        bundle = build_prospect_foundation_bundle(
            external_customer_id=external_customer_id,
            external_project_id=external_project_id,
            brand_name=brand_name,
            industry_pack_reference_id=industry_pack_reference_id,
            intake_attachment_id=intake_attachment_id,
            submitted_at=str(intake.get("submittedAt") or "") or None,
            project_owner=principal.actor_id,
            created_by=principal.actor_id,
            source_system="wechat_miniprogram",
            project_objectives=customer_goals or None,
        )
        blockers = validate_prospect_foundation_bundle(
            bundle,
            existing_object_ids=approved_pack_ids,
        )
        if blockers:
            raise ValueError("m01_prospect_onboarding_blocked:" + ",".join(blockers))

        for record in bundle.objects():
            self._sync(record)

        now = _now()
        intake_record = _customer_intake_record(
            intake=intake,
            attachment_id=intake_attachment_id,
            canonical_client_id=bundle.canonical_client_id,
            canonical_project_id=bundle.canonical_project_id,
            created_at=now,
            created_by=principal.actor_id,
        )
        self._sync(intake_record)

        self.store.append_journal(record_operation_event(
            client_id=bundle.canonical_client_id,
            project_id=bundle.canonical_project_id,
            occurred_at=now,
            actor_type="operator",
            actor_id=principal.actor_id,
            actor_role=principal.role,
            operation_type="miniprogram_intake_accepted",
            target_module="M01",
            target_object_references=[
                bundle.canonical_client_id,
                bundle.canonical_project_id,
                intake_attachment_id,
                industry_pack_reference_id,
            ],
            summary="MiniProgram customer intake accepted through governed M01 prospect onboarding.",
            customer_visible=True,
            result_status="success",
            details={
                "external_customer_id": external_customer_id,
                "external_project_id": external_project_id,
                "source_system": "wechat_miniprogram",
                "identity_status": "client_asserted",
                "customer_profile_received": True,
                "payment_admission": payment_admission,
                "paid_diagnostic_order": ({
                    "out_trade_no": payment.get("outTradeNo"),
                    "transaction_id": payment.get("transactionId"),
                    "amount_total": payment.get("amountTotal"),
                    "amount_yuan": payment.get("amountYuan"),
                    "currency": payment.get("currency"),
                    "status": payment_status,
                    "paid_at": payment.get("paidAt"),
                } if paid_admission else None),
                "channel_offer_order": ({
                    "out_trade_no": payment.get("outTradeNo"),
                    "channel_id": payment.get("channelId"),
                    "channel_name": payment.get("channelName"),
                    "source_id": payment.get("sourceId"),
                    "source_name": payment.get("sourceName"),
                    "source_type": payment.get("sourceType"),
                    "list_price_fen": payment.get("listPriceFen"),
                    "amount_total": payment.get("amountTotal"),
                    "amount_yuan": payment.get("amountYuan"),
                    "status": payment_status,
                    "eligible_at": payment.get("paidAt"),
                } if channel_offer_admission else None),
                "customer_intake_snapshot": _customer_intake_snapshot(intake),
            },
        ))
        stage_projection = self.miniprogram_bridge.update_project_stage(external_project_id, "ONBOARDING")
        return {
            "external_customer_id": external_customer_id,
            "external_project_id": external_project_id,
            "canonical_client_id": bundle.canonical_client_id,
            "canonical_project_id": bundle.canonical_project_id,
            "brand_entity_id": bundle.brand_entity["entity_profile_id"],
            "brand_identity_anchor_id": bundle.brand_identity_anchor["brand_identity_anchor_id"],
            "industry_pack_reference_id": industry_pack_reference_id,
            "intake_attachment_id": intake_attachment_id,
            "identity_status": "client_asserted",
            "customer_profile_received": True,
            "payment_admission": payment_admission,
            "payment": ({
                "status": payment_status,
                "amount_yuan": payment.get("amountYuan"),
                "out_trade_no": payment.get("outTradeNo"),
                "transaction_id": payment.get("transactionId"),
                "channel_id": payment.get("channelId"),
                "source_id": payment.get("sourceId"),
                "source_name": payment.get("sourceName"),
                "source_type": payment.get("sourceType"),
            } if (paid_admission or channel_offer_admission) else None),
            "miniprogram_stage": stage_projection,
        }

    def prepare_detection_plan_candidates(self, principal, client_id: str, project_id: str) -> dict[str, Any]:
        """Create M03 pending-review planning objects from an accepted real intake.

        This does not authorize capture. It intentionally stops at candidate wording and
        persona/journey inference so that an authorized reviewer can approve exact query bytes.
        """
        self._require(principal, "profile.write")
        client = self.store.get_client_payload(client_id) or {}
        canonical_client_id = str(client.get("canonical_client_id") or "") or str(client_id or "")
        if not canonical_client_id.startswith("client_"):
            raise ValueError("canonical_client_binding_required")
        _, records = self._canonical_workspace_records(canonical_client_id, project_id)
        project = next((row for row in records if row.get("object_type") == "project" and row.get("project_id") == project_id), None)
        anchor = next((row for row in records if row.get("object_type") == "brand_identity_anchor"), None)
        attachment = next((row for row in records if row.get("object_type") == "customer_attachment" and row.get("assertion_status") == "client_asserted"), None)
        canonical_client = next((row for row in records if row.get("object_type") == "client"), None)
        if canonical_client is None:
            canonical_client = dict(client)
            canonical_client["client_id"] = canonical_client_id
        if not project or not anchor or not attachment:
            raise ValueError("m03_planning_requires_project_anchor_and_customer_attachment")

        intelligence_profiles = [
            row for row in records
            if row.get("object_type") == "customer_intelligence_profile"
            and row.get("lifecycle_status") == "active"
        ]
        if not intelligence_profiles:
            raise ValueError("customer_intelligence_profile_required_before_detection_planning")
        intelligence_profile = sorted(
            intelligence_profiles,
            key=lambda row: str(row.get("generated_at") or row.get("created_at") or ""),
            reverse=True,
        )[0]
        readiness = intelligence_profile.get("readiness") or {}
        if readiness.get("status") != "READY_FOR_DIAGNOSIS":
            blockers = list(readiness.get("critical_blockers") or [])
            warnings = list(readiness.get("warnings") or [])
            raise ValueError(
                "customer_intelligence_not_ready_for_detection_planning:"
                + "|".join(blockers + warnings)
            )

        manual_profile_fields = dict(client.get("brand_profile_manual_fields") or {})
        planning_intelligence_profile = dict(intelligence_profile)
        planning_intelligence_profile["enterprise_profile"] = apply_manual_brand_profile_fields(
            intelligence_profile.get("enterprise_profile") or {},
            manual_profile_fields,
        )
        generated_at = _now()
        plan = build_enterprise_service_detection_candidates(
            client=canonical_client,
            project=project,
            brand_identity_anchor=anchor,
            customer_attachment=attachment,
            created_by=principal.actor_id,
            created_at=generated_at,
            customer_intelligence_profile=planning_intelligence_profile,
        )
        revision_number, semantic_version = _stamp_generated_detection_plan_revision(
            list(plan.records),
            existing_records=[dict(row) for row in records],
            candidate_fingerprint=plan.candidate_fingerprint,
            generated_at=generated_at,
            generated_by=principal.actor_id,
            profile_id=str(intelligence_profile.get("customer_intelligence_profile_id") or ""),
            profile_version=str(intelligence_profile.get("profile_version") or ""),
        )
        for record in plan.records:
            self._sync(record)

        now = generated_at
        self.store.append_journal(record_operation_event(
            client_id=canonical_client_id,
            project_id=project_id,
            occurred_at=now,
            actor_type="operator",
            actor_id=principal.actor_id,
            actor_role=principal.role,
            operation_type="detection_plan_candidates_prepared",
            target_module="M03",
            target_object_references=[plan.query_set_id, *[qid for qid, _ in plan.query_texts]],
            summary="Prepared fail-closed M03 persona, journey and 12-query detection candidates for exact human review.",
            customer_visible=False,
            result_status="pending_review",
            details={
                "candidate_fingerprint": plan.candidate_fingerprint,
                "query_count": len(plan.query_texts),
                "customer_intelligence_profile_id": intelligence_profile.get("customer_intelligence_profile_id"),
                "customer_intelligence_score": readiness.get("score"),
                "operator_profile_override_count": len(manual_profile_fields),
                "customer_intelligence_profile_version": intelligence_profile.get("profile_version"),
                "planning_source": "brand_enterprise_intelligence_profile",
                "revision_number": revision_number,
                "semantic_version": semantic_version,
            },
        ))
        generated_queries = [
            dict(row) for row in plan.records if row.get("object_type") == "query"
        ]
        persona_by_id = {
            str(row.get("persona_graph_id") or row.get("object_id") or ""): str(row.get("persona_name") or "")
            for row in plan.records if row.get("object_type") == "persona_graph"
        }
        return {
            "client_id": canonical_client_id,
            "project_id": project_id,
            "query_set_id": plan.query_set_id,
            "candidate_fingerprint": plan.candidate_fingerprint,
            "review_status": "pending_review",
            "capture_ready": False,
            "planning_source": "brand_enterprise_intelligence_profile",
            "customer_intelligence_profile_id": intelligence_profile.get("customer_intelligence_profile_id"),
            "customer_intelligence_profile_version": intelligence_profile.get("profile_version"),
            "customer_intelligence_score": readiness.get("score"),
            "query_candidates": [
                {
                    "query_id": row.get("query_id") or row.get("object_id"),
                    "query_text": row.get("query_text"),
                    "query_type": row.get("query_type"),
                    "query_intent": row.get("query_intent"),
                    "journey_stage": row.get("journey_stage"),
                    "persona_name": persona_by_id.get(str(row.get("persona_graph_id") or "")),
                    "brand_awareness_level": row.get("brand_awareness_level"),
                    "brand_mention_policy": row.get("brand_mention_policy"),
                    "profile_basis": list((row.get("constraint_bundle") or {}).get("profile_basis") or []),
                }
                for row in generated_queries
            ],
            "persona_graph_ids": list(plan.persona_graph_ids),
            "journey_graph_id": plan.journey_graph_id,
            "revision_number": revision_number,
            "semantic_version": semantic_version,
        }

    def revise_detection_plan(self, principal, client_id: str, project_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        """Revise exact pending query wording without mutating an approved/frozen baseline."""
        self._require(principal, "profile.write")
        client = self.store.get_client_payload(client_id) or {}
        canonical_client_id = str(client.get("canonical_client_id") or "") or str(client_id or "")
        if not canonical_client_id.startswith("client_"):
            raise ValueError("canonical_client_binding_required")
        _, records = self._canonical_workspace_records(canonical_client_id, project_id)
        candidates = [
            dict(row)
            for row in records
            if row.get("object_type") in {"query", "query_set"}
            and str(row.get("review_status") or "") in {"pending_review", "changes_requested"}
            and str(row.get("lifecycle_status") or "") not in {"superseded", "archived", "rejected"}
        ]
        revised_at = _now()
        archived, revised, fingerprint, revision_number, semantic_version, changed_count = _revise_pending_queryset_version(
            candidates,
            edits=[dict(item) for item in (payload.get("queries") or []) if isinstance(item, Mapping)],
            revised_at=revised_at,
            revised_by=principal.actor_id,
            reason=str(payload.get("revision_reason") or ""),
        )
        for record in archived:
            self._sync(record)
        for record in revised:
            self._sync(record)

        query_set = next(row for row in revised if row.get("object_type") == "query_set")
        changed_query_ids = [
            str(item.get("query_id") or "")
            for item in (payload.get("queries") or [])
            if isinstance(item, Mapping) and str(item.get("query_id") or "")
        ]
        archived_set = next((row for row in archived if row.get("object_type") == "query_set"), None)
        self.store.append_journal(record_operation_event(
            client_id=canonical_client_id,
            project_id=project_id,
            occurred_at=revised_at,
            actor_type="operator",
            actor_id=principal.actor_id,
            actor_role=principal.role,
            operation_type="detection_plan_revised",
            target_module="M03",
            target_object_references=[str(query_set.get("query_set_id") or ""), *changed_query_ids],
            summary="Operator revised pending detection-plan wording; previous exact wording was retained as a superseded history snapshot.",
            customer_visible=False,
            result_status="pending_review",
            details={
                "candidate_fingerprint": fingerprint,
                "revision_number": revision_number,
                "semantic_version": semantic_version,
                "changed_query_count": changed_count,
                "revision_reason": str(payload.get("revision_reason") or "").strip(),
                "archived_query_set_id": str((archived_set or {}).get("query_set_id") or ""),
            },
        ))
        return {
            "client_id": canonical_client_id,
            "project_id": project_id,
            "query_set_id": query_set.get("query_set_id"),
            "candidate_fingerprint": fingerprint,
            "review_status": "pending_review",
            "capture_ready": False,
            "revision_number": revision_number,
            "semantic_version": semantic_version,
            "changed_query_count": changed_count,
            "archived_query_set_id": (archived_set or {}).get("query_set_id"),
        }

    def approve_detection_plan(self, principal, client_id: str, project_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        """Materialize M04-ready objects only after an authorized reviewer approves exact bytes."""
        self._require(principal, "intervention.decide")
        if principal.role not in {"geo_lead", "qa_reviewer"}:
            raise PermissionError("queryset_approval_requires_geo_lead_or_qa_reviewer")
        approved_fingerprint = str(payload.get("candidate_fingerprint") or "").strip()
        if not approved_fingerprint.startswith("sha256:"):
            raise ValueError("candidate_fingerprint_required")

        client = self.store.get_client_payload(client_id) or {}
        canonical_client_id = str(client.get("canonical_client_id") or "") or str(client_id or "")
        _, records = self._canonical_workspace_records(canonical_client_id, project_id)
        candidate_types = {"persona_graph", "journey_graph", "query_signal", "query_scenario", "query_family", "query", "query_set"}
        candidates = [row for row in records if row.get("object_type") in candidate_types and row.get("review_status") == "pending_review"]
        candidate_fingerprint, query_pairs = _fingerprint_persisted_query_set(candidates)
        if candidate_fingerprint != approved_fingerprint:
            raise ValueError("candidate_fingerprint_not_exactly_approved")
        ordered_candidates = _materialization_order(candidates, query_pairs)

        approved = materialize_approved_detection_plan(
            candidate_records=ordered_candidates,
            candidate_fingerprint=candidate_fingerprint,
            approved_fingerprint=approved_fingerprint,
            created_by=principal.actor_id,
            created_at=_now(),
        )
        for record in approved.governed_records:
            self._sync(record)
        self._sync(approved.prompt_template)
        for record in approved.prompt_instances:
            self._sync(record)
        self._sync(approved.platform_test_plan)
        self._sync(approved.observation_batch)

        now = _now()
        self.store.append_journal(record_operation_event(
            client_id=canonical_client_id,
            project_id=project_id,
            occurred_at=now,
            actor_type="operator",
            actor_id=principal.actor_id,
            actor_role=principal.role,
            operation_type="detection_plan_approved",
            target_module="M03",
            target_object_references=[approved.platform_test_plan["platform_test_plan_id"], approved.observation_batch["observation_batch_id"]],
            summary="Authorized M03 reviewer approved exact query wording and materialized the five-platform capture plan.",
            customer_visible=False,
            result_status="approved",
            details={
                "candidate_fingerprint": candidate_fingerprint,
                "query_count": len(query_pairs),
                "prompt_instance_count": len(approved.prompt_instances),
            },
        ))
        return {
            "client_id": canonical_client_id,
            "project_id": project_id,
            "candidate_fingerprint": candidate_fingerprint,
            "query_set_id": approved.platform_test_plan["query_set_id"],
            "platform_test_plan_id": approved.platform_test_plan["platform_test_plan_id"],
            "observation_batch_id": approved.observation_batch["observation_batch_id"],
            "prompt_instance_count": len(approved.prompt_instances),
            "capture_ready": True,
        }
