from __future__ import annotations

from http import HTTPStatus
from urllib.parse import unquote, urlparse

from .extended_handler import ExtendedOperationsAdminHandler
from .miniprogram_bridge import MiniProgramBridgeError
from .operations_reporting import build_operations_overview


class IntegratedOperationsAdminHandler(ExtendedOperationsAdminHandler):
    """HTTP surface for M11 orchestration that never replaces M01-M10 authority."""

    def _bridge_error(self, exc: Exception) -> None:
        if isinstance(exc, MiniProgramBridgeError):
            code = str(exc)
            status = HTTPStatus.SERVICE_UNAVAILABLE if "not_configured" in code or "unreachable" in code else HTTPStatus.BAD_GATEWAY
            self._json(status, {"error": code})
            return
        self._handle_error(exc)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/")
        if path == "/api/operator-actions":
            try:
                principal = self._principal()
                self._json(HTTPStatus.OK, self.service.operator_actions(principal))
            except Exception as exc:
                self._bridge_error(exc)
            return
        if path == "/api/industry-packs":
            try:
                principal = self._principal()
                self._json(HTTPStatus.OK, {"items": self.service.list_industry_packs(principal)})
            except Exception as exc:
                self._bridge_error(exc)
            return
        if path == "/api/payments":
            try:
                principal = self._principal()
                self._json(HTTPStatus.OK, self.service.payment_dashboard(principal))
            except Exception as exc:
                self._bridge_error(exc)
            return
        if path == "/api/channels":
            try:
                principal = self._principal()
                self._json(HTTPStatus.OK, self.service.channel_dashboard(principal))
            except Exception as exc:
                self._bridge_error(exc)
            return
        if path == "/api/miniprogram-users":
            try:
                principal = self._principal()
                self._json(HTTPStatus.OK, self.service.miniprogram_user_dashboard(principal))
            except Exception as exc:
                self._bridge_error(exc)
            return
        if path == "/api/intakes":
            try:
                principal = self._principal()
                self._json(HTTPStatus.OK, {"items": self.service.list_miniprogram_intakes(principal)})
            except Exception as exc:
                self._bridge_error(exc)
            return
        if path == "/api/operations-overview":
            try:
                principal = self._principal()
                clients = self.service.list_clients(principal)
                dashboard = self.service.dashboard(principal)
                try:
                    intakes = self.service.list_miniprogram_intakes(principal)
                except Exception:
                    intakes = []
                pending_intakes = sum(
                    item.get("paymentEligibleForProcessing") is True
                    and str((item.get("project") or {}).get("stage") or "INTAKE") in {"", "INTAKE", "PAYMENT_PENDING"}
                    for item in intakes
                )
                overview = build_operations_overview(
                    clients=clients,
                    workspace_loader=lambda client_id: self.service.get_client_workspace(principal, client_id),
                    pending_intakes=pending_intakes,
                    intervention_count=len(dashboard.get("interventions") or []),
                    active_order_count=len(dashboard.get("orders") or []),
                    monitoring_count=len(dashboard.get("monitoring") or []),
                )
                self._json(HTTPStatus.OK, overview)
            except Exception as exc:
                self._bridge_error(exc)
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/")
        parts = path.split("/")
        if path == "/api/channels":
            try:
                principal = self._principal()
                self._json(HTTPStatus.OK, self.service.save_channel(principal, self._body()))
            except Exception as exc:
                self._bridge_error(exc)
            return
        if (
            len(parts) == 4
            and parts[1:3] == ["api", "miniprogram-users"]
        ):
            try:
                principal = self._principal()
                user_id = unquote(parts[3])
                self._json(
                    HTTPStatus.OK,
                    self.service.save_miniprogram_user(principal, user_id, self._body()),
                )
            except Exception as exc:
                self._bridge_error(exc)
            return

        if path == "/api/sources":
            try:
                principal = self._principal()
                self._json(HTTPStatus.OK, self.service.save_source(principal, self._body()))
            except Exception as exc:
                self._bridge_error(exc)
            return
        if (
            len(parts) == 5
            and parts[1:3] == ["api", "sources"]
            and parts[4] == "miniprogram-code"
        ):
            try:
                principal = self._principal()
                source_id = unquote(parts[3])
                result = self.service.generate_source_miniprogram_code(principal, source_id)
                self._json(HTTPStatus.OK, result)
            except Exception as exc:
                self._bridge_error(exc)
            return
        if (
            len(parts) == 6
            and parts[1:3] == ["api", "channels"]
            and parts[4] == "settlements"
        ):
            try:
                principal = self._principal()
                channel_id = unquote(parts[3])
                period = unquote(parts[5])
                result = self.service.settle_channel_month(
                    principal,
                    channel_id,
                    period,
                    self._body(),
                )
                self._json(HTTPStatus.OK, result)
            except Exception as exc:
                self._bridge_error(exc)
            return
        if (
            len(parts) == 5
            and parts[1:3] == ["api", "payments"]
            and parts[4] == "refund"
        ):
            try:
                principal = self._principal()
                out_trade_no = unquote(parts[3])
                result = self.service.refund_miniprogram_payment(
                    principal,
                    out_trade_no,
                    self._body(),
                )
                self._json(HTTPStatus.OK, result)
            except Exception as exc:
                self._bridge_error(exc)
            return
        if len(parts) == 5 and parts[1:3] == ["api", "intakes"] and parts[4] == "accept":
            try:
                principal = self._principal()
                external_project_id = unquote(parts[3])
                result = self.service.accept_miniprogram_intake(principal, external_project_id, self._body())
                self._json(HTTPStatus.OK, result)
            except Exception as exc:
                self._bridge_error(exc)
            return
        if len(parts) == 6 and parts[1] == "api" and parts[2] == "clients" and parts[4] == "projects" and parts[5] == "prepare-detection-plan":
            try:
                principal = self._principal()
                client_id = unquote(parts[3])
                body = self._body()
                project_id = str(body.get("project_id") or "")
                result = self.service.prepare_detection_plan_candidates(principal, client_id, project_id)
                self._json(HTTPStatus.OK, result)
            except Exception as exc:
                self._bridge_error(exc)
            return
        if len(parts) == 6 and parts[1] == "api" and parts[2] == "clients" and parts[4] == "projects" and parts[5] == "revise-detection-plan":
            try:
                principal = self._principal()
                client_id = unquote(parts[3])
                body = self._body()
                project_id = str(body.get("project_id") or "")
                result = self.service.revise_detection_plan(principal, client_id, project_id, body)
                self._json(HTTPStatus.OK, result)
            except Exception as exc:
                self._bridge_error(exc)
            return
        if len(parts) == 6 and parts[1] == "api" and parts[2] == "clients" and parts[4] == "projects" and parts[5] == "approve-detection-plan":
            try:
                principal = self._principal()
                client_id = unquote(parts[3])
                body = self._body()
                project_id = str(body.get("project_id") or "")
                result = self.service.approve_detection_plan(principal, client_id, project_id, body)
                self._json(HTTPStatus.OK, result)
            except Exception as exc:
                self._bridge_error(exc)
            return
        super().do_POST()
