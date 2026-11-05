"""Stable native adapter types shared by CLI and imported owner adapters."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from tools.releasing.manager import PHASES, ReleaseError, child, read_json, save


@dataclass(frozen=True)
class ReleaseContext:
    phase: str
    run_directory: Path
    source_sha: str
    target: str
    resource: str
    approval_ref: str
    module: str
    version: str
    profile: str

    def path(self, name):
        """A path for native backup/receipts inside this private release run."""
        return child(self.run_directory, name)

    def write_json(self, name, value):
        save(self.path(name), value, exclusive=True)

    def read_json(self, name):
        return read_json(self.path(name))


class ReleaseAdapter:
    """Base ABI; all nine native hooks must be supplied by a runtime owner."""

    def __getattr__(self, name):
        if name in PHASES:
            raise ReleaseError('native_hook_not_implemented_' + name)
        raise AttributeError(name)
