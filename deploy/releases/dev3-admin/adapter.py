"""Native release hooks for dev3-admin; implement before release.
Do not send platform prompts, mutate customer data or publish customer reports.
A hook must verify its real condition and return {"verified": True}.
"""
from tools.releasing.sdk import ReleaseAdapter


class Adapter(ReleaseAdapter):
    def check(self, context):
        """Read the live baseline, exact candidate artifact, target and permissions; do not mutate production."""
        raise NotImplementedError("native_check_required")

    def backup(self, context):
        """Create and verify the baseline backup; save native recovery information in context.run_directory."""
        raise NotImplementedError("native_backup_required")

    def stage(self, context):
        """Rehearse candidate and rollback in isolation; do not switch production."""
        raise NotImplementedError("native_stage_required")

    def before_switch(self, context):
        """Recheck baseline, idle/in-flight jobs, backup, permissions and native release locks."""
        raise NotImplementedError("native_before_switch_required")

    def switch(self, context):
        """Switch only the declared software resource; retain native locks and recovery fencing."""
        raise NotImplementedError("native_switch_required")

    def verify(self, context):
        """Verify actual version, health, tenant denials and unchanged protected services/originals."""
        raise NotImplementedError("native_verify_required")

    def before_rollback(self, context):
        """Fence remote switch processes and confirm this run still owns the live instance."""
        raise NotImplementedError("native_before_rollback_required")

    def rollback(self, context):
        """Restore this run baseline idempotently from its backup; use no original checkout paths."""
        raise NotImplementedError("native_rollback_required")

    def verify_rollback(self, context):
        """Read back baseline version, health, protected services and immutable originals."""
        raise NotImplementedError("native_verify_rollback_required")

