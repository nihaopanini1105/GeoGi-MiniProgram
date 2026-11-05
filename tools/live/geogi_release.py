"""Unified GeoGi software deployment CLI (no GitHub Actions)."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import subprocess

from tools.releasing.bootstrap import KitError
from tools.releasing.onboarding import inspect_module, prepare, scaffold

from tools.releasing.manager import (PHASES, ReleaseError, file_hash, make_plan, publish,
                                     read_json, rollback, save, status, validate_recipe)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='action', required=True)
    for action, help_text in [('scaffold', 'Generate a version-independent native adapter kit'),
                              ('doctor', 'Inspect module readiness without importing or executing it'),
                              ('prepare', 'Generate recipe and exact-HEAD plan for a finished module')]:
        command = sub.add_parser(action, help=help_text)
        command.add_argument('--module', required=True)
        command.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
        if action == 'scaffold':
            command.add_argument('--profile', choices=('dev3', 'report', 'feature'), required=True)
            command.add_argument('--runtime', choices=('admin', 'worker', 'custom'), required=True)
            command.add_argument('--resource')
        elif action == 'prepare':
            command.add_argument('--version', required=True)
            command.add_argument('--target', required=True)
            command.add_argument('--gate', type=Path, required=True)
            command.add_argument('--output', type=Path, required=True)
            command.add_argument('--expected-sha')
    export = sub.add_parser('bundle', help='Deliver complete source, docs, tests and standalone installer')
    export.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    export.add_argument('--output', type=Path, required=True)
    export.add_argument('--verify', action='store_true', help='Run dedicated tests from the extracted archive')
    init = sub.add_parser('init', help='Create a reusable recipe from reviewed runtime commands')
    init.add_argument('--profile', choices=('dev3', 'report', 'feature'), required=True)
    for field in ('module', 'version', 'target', 'resource'):
        init.add_argument('--' + field, required=True)
    init.add_argument('--commands', type=Path, required=True,
                      help='JSON mapping every runtime phase to an argv array')
    init.add_argument('--output', type=Path, required=True)
    init.add_argument('--timeout-seconds', type=int, default=900)
    plan = sub.add_parser('plan', help='Freeze recipe, source SHA and verified gate evidence; no runtime commands')
    plan.add_argument('--recipe', type=Path, required=True)
    plan.add_argument('--expected-sha', required=True)
    plan.add_argument('--gate', type=Path, required=True, help='Authoritative gate summary.json')
    plan.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    plan.add_argument('--output', type=Path, required=True)
    release = sub.add_parser('publish', help='Execute an explicitly authorized, reviewed plan')
    release.add_argument('--plan', type=Path, required=True)
    release.add_argument('--plan-sha256', required=True)
    release.add_argument('--state-root', type=Path, required=True,
                         help='Private persistent directory shared by publishers on this host')
    release.add_argument('--approval-ref', required=True, help='Existing operator authorization reference; not a grant')
    recover = sub.add_parser('rollback', help='Restore the recorded baseline, including after an interrupted run')
    recover.add_argument('--run', type=Path, required=True)
    recover.add_argument('--plan-sha256', required=True)
    recover.add_argument('--approval-ref', required=True)
    inspect = sub.add_parser('status', help='Read release status without running commands')
    inspect.add_argument('--run', type=Path, required=True)
    sub.add_parser('phases', help='List the runtime adapter contract')
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.action == 'bundle':
            from tools.releasing.distribution import bundle
            result = bundle(args.root, args.output, verify_tests=args.verify)
        elif args.action == 'scaffold':
            result = scaffold(args.root, args.module, args.profile, args.runtime, args.resource)
        elif args.action == 'doctor':
            result = inspect_module(args.root, args.module)
            print(json.dumps(result, ensure_ascii=False, sort_keys=True))
            return 0 if result['status'] == 'adapter_contract_ready' else 2
        elif args.action == 'prepare':
            result = prepare(args.root, args.module, args.version, args.target, args.gate, args.output,
                             args.expected_sha)
        elif args.action == 'init':
            recipe = validate_recipe({'schema_version': 1, 'profile': args.profile, 'module': args.module,
                                      'version': args.version, 'target': args.target, 'resource': args.resource,
                                      'scope': 'software_deployment', 'commands': read_json(args.commands),
                                      'timeout_seconds': args.timeout_seconds})
            save(args.output, recipe, exclusive=True)
            result = {'recipe': str(args.output), 'recipe_sha256': file_hash(args.output),
                      'production_changed': False}
        elif args.action == 'plan':
            result = make_plan(args.root, args.recipe, args.expected_sha, args.gate, args.output)
        elif args.action == 'publish':
            result = publish(args.plan, args.plan_sha256, args.state_root, args.approval_ref)
        elif args.action == 'rollback':
            result = rollback(args.run.resolve(), args.plan_sha256, args.approval_ref)
        elif args.action == 'status':
            result = status(args.run.resolve())
        else:
            result = {'phases': list(PHASES), 'placeholders': ['{python}', '{source}'],
                      'context_environment': ['GEOGI_RELEASE_CONTEXT', 'GEOGI_RELEASE_RUN',
                                              'GEOGI_RELEASE_PHASE', 'GEOGI_RELEASE_SHA']}
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except (ReleaseError, KitError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        # Native stdout/stderr are private logs, never echoed into a chat/terminal.
        print(json.dumps({'status': 'blocked', 'reason': str(error) if isinstance(error, (ReleaseError, KitError))
                          else type(error).__name__}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
