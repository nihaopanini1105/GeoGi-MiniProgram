"""Standard native adapter ABI used by generated Dev3/Report/feature recipes."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

from tools.releasing.sdk import ReleaseAdapter, ReleaseContext

from tools.releasing.manager import (NAME, PHASES, SHA, ReleaseError, child, read_json,
                                     require, save)


def execute(adapter_path, phase):
    require(phase in PHASES, 'unknown_release_phase')
    context_path = Path(os.environ.get('GEOGI_RELEASE_CONTEXT', ''))
    payload = read_json(context_path)
    require(payload['phase'] == phase == os.environ.get('GEOGI_RELEASE_PHASE'), 'adapter_phase_mismatch')
    require(SHA.fullmatch(payload['source_sha'] or ''), 'adapter_source_sha_required')
    require(payload['source_sha'] == os.environ.get('GEOGI_RELEASE_SHA'), 'adapter_source_sha_mismatch')
    require(NAME.fullmatch(payload['target']) and NAME.fullmatch(payload['resource']), 'adapter_scope_invalid')
    run = Path(payload['run_directory'])
    require(run.is_absolute() and run.is_dir() and str(run) == os.environ.get('GEOGI_RELEASE_RUN'),
            'adapter_run_directory_mismatch')
    adapter_path = adapter_path.absolute()
    # Publish runs from the clean checkout, recovery from the frozen snapshot.
    # The generated command may only import an adapter from that source root.
    relative = adapter_path.relative_to(Path.cwd())
    require(child(Path.cwd(), str(relative)).is_file(), 'native_adapter_file_missing')
    spec = importlib.util.spec_from_file_location('geogi_native_release_adapter', adapter_path)
    require(spec is not None and spec.loader is not None, 'native_adapter_import_failed')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    adapter_class = getattr(module, 'Adapter', None)
    require(isinstance(adapter_class, type) and issubclass(adapter_class, ReleaseAdapter),
            'native_adapter_class_required')
    require(NAME.fullmatch(payload['module']) and NAME.fullmatch(payload['version']) and
            payload['profile'] in ('dev3', 'report', 'feature'), 'adapter_module_version_invalid')
    context = ReleaseContext(phase, run, payload['source_sha'], payload['target'], payload['resource'],
                             payload['approval_ref'], payload['module'], payload['version'], payload['profile'])
    result = getattr(adapter_class(), phase)(context)
    require(isinstance(result, dict) and result.get('verified') is True, 'native_hook_verified_receipt_required')
    receipt = {'phase': phase, 'source_sha': context.source_sha, 'target': context.target,
               'resource': context.resource, 'module': context.module, 'version': context.version,
               'profile': context.profile, 'verified': True}
    save(run / (context_path.stem + '.adapter-result.json'), receipt, exclusive=True)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adapter', required=True, type=Path)
    parser.add_argument('--phase', required=True, choices=PHASES)
    args = parser.parse_args(argv)
    try:
        result = execute(args.adapter, args.phase)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        # Native details are kept in the owner's private receipts, not stdout.
        print(json.dumps({'status': 'failed', 'phase': args.phase,
                          'reason': str(error) if isinstance(error, ReleaseError) else type(error).__name__}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
