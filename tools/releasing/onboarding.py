"""Version-independent release adapter scaffolds and read-only readiness checks."""
from __future__ import annotations

import ast
from pathlib import Path

from tools.releasing.manager import (NAME, PHASES, ReleaseError, child, file_hash, git,
                                     make_plan, outside_source, read_json, require, save)

CONTRACT = {
    'check': 'Read the live baseline, exact candidate artifact, target and permissions; do not mutate production.',
    'backup': 'Create and verify the baseline backup; save native recovery information in context.run_directory.',
    'stage': 'Rehearse candidate and rollback in isolation; do not switch production.',
    'before_switch': 'Recheck baseline, idle/in-flight jobs, backup, permissions and native release locks.',
    'switch': 'Switch only the declared software resource; retain native locks and recovery fencing.',
    'verify': 'Verify actual version, health, tenant denials and unchanged protected services/originals.',
    'before_rollback': 'Fence remote switch processes and confirm this run still owns the live instance.',
    'rollback': 'Restore this run baseline idempotently from its backup; use no original checkout paths.',
    'verify_rollback': 'Read back baseline version, health, protected services and immutable originals.',
}
RUNTIMES = {'admin': 'geogi-admin', 'worker': 'capture-worker'}


def module_files(root, module):
    require(isinstance(module, str) and NAME.fullmatch(module), 'invalid_release_module')
    folder = child(root, 'deploy/releases/' + module)
    return folder, folder / 'release.json'


def adapter_source(module):
    lines = ['"""Native release hooks for ' + module + '; implement before release.\n',
             'Do not send platform prompts, mutate customer data or publish customer reports.\n',
             'A hook must verify its real condition and return {"verified": True}.\n',
             '"""\n', 'from tools.releasing.sdk import ReleaseAdapter\n\n\n',
             'class Adapter(ReleaseAdapter):\n']
    for phase in PHASES:
        lines += ['    def ' + phase + '(self, context):\n',
                  '        """' + CONTRACT[phase] + '"""\n',
                  '        raise NotImplementedError("native_' + phase + '_required")\n\n']
    return ''.join(lines)


def scaffold(root, module, profile, runtime, resource=None):
    root = root.resolve()
    folder, descriptor = module_files(root, module)
    require(profile in ('dev3', 'report', 'feature'), 'unknown_release_profile')
    require(runtime in ('admin', 'worker', 'custom'), 'unknown_release_runtime')
    resource = resource or RUNTIMES.get(runtime)
    require(isinstance(resource, str) and NAME.fullmatch(resource), 'custom_resource_required')
    require(runtime not in RUNTIMES or resource == RUNTIMES[runtime], 'shared_runtime_resource_required')
    require(not folder.exists(), 'release_module_already_exists')
    folder.mkdir(parents=True)
    adapter = folder / 'adapter.py'
    adapter.write_text(adapter_source(module), encoding='utf-8')
    save(descriptor, {'schema_version': 1, 'profile': profile, 'module': module, 'runtime': runtime,
                      'resource': resource, 'scope': 'software_deployment',
                      'adapter': str(adapter.relative_to(root)), 'timeout_seconds': 900}, exclusive=True)
    return {'module': module, 'descriptor': str(descriptor), 'adapter': str(adapter),
            'status': 'needs_native_hooks', 'production_changed': False}


def inspect_module(root, module):
    """Parse source only: never import an unfinished adapter during inspection."""
    root = root.resolve()
    _, descriptor = module_files(root, module)
    issues = []
    try:
        spec = read_json(descriptor)
        require(isinstance(spec, dict) and type(spec.get('schema_version')) is int and
                spec['schema_version'] == 1, 'module_descriptor_schema_invalid')
        require(spec.get('module') == module, 'module_descriptor_name_mismatch')
        require(spec.get('profile') in ('dev3', 'report', 'feature'), 'unknown_release_profile')
        require(spec.get('scope') == 'software_deployment', 'software_deployment_scope_required')
        runtime, resource = spec.get('runtime'), spec.get('resource')
        require(runtime in ('admin', 'worker', 'custom'), 'unknown_release_runtime')
        require(isinstance(resource, str) and NAME.fullmatch(resource), 'invalid_release_resource')
        require(runtime not in RUNTIMES or resource == RUNTIMES[runtime], 'shared_runtime_resource_required')
        require(type(spec.get('timeout_seconds', 900)) is int and
                1 <= spec.get('timeout_seconds', 900) <= 7200, 'invalid_command_timeout')
        adapter = child(root, spec.get('adapter'))
        require(adapter.suffix == '.py' and adapter.is_file(), 'native_adapter_file_missing')
        tree = ast.parse(adapter.read_text(encoding='utf-8'))
        classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Adapter']
        require(len(classes) == 1 and any(isinstance(base, ast.Name) and base.id == 'ReleaseAdapter'
                                         for base in classes[0].bases), 'native_adapter_class_required')
        methods = {node.name: node for node in classes[0].body if isinstance(node, ast.FunctionDef)}
        for phase in PHASES:
            node = methods.get(phase)
            body = [] if node is None else [item for item in node.body if not
                (isinstance(item, ast.Expr) and isinstance(item.value, ast.Constant) and
                 isinstance(item.value.value, str))]
            unfinished = not body or all(isinstance(item, ast.Pass) or
                (isinstance(item, ast.Expr) and isinstance(item.value, ast.Constant) and
                 item.value.value is Ellipsis) for item in body)
            if node is not None:
                unfinished = unfinished or any(isinstance(item, ast.Name) and item.id == 'NotImplementedError'
                                               for item in ast.walk(node))
            else:
                unfinished = True
            if unfinished:
                issues.append({'code': 'native_hook_not_implemented', 'phase': phase,
                               'required': CONTRACT[phase]})
        result = {'module': module, 'profile': spec['profile'], 'runtime': runtime,
                  'resource': resource, 'adapter': str(adapter.relative_to(root)),
                  'adapter_sha256': file_hash(adapter), 'descriptor': str(descriptor),
                  'timeout_seconds': spec.get('timeout_seconds', 900)}
    except (OSError, ValueError, TypeError, KeyError, SyntaxError, ReleaseError) as error:
        issues.append({'code': str(error) if isinstance(error, ReleaseError) else type(error).__name__})
        result = {'module': module}
    return {**result, 'status': 'adapter_contract_ready' if not issues else 'needs_implementation',
            'issues': issues, 'production_changed': False,
            'owner': 'version_developer', 'user_source_relay_required': False,
            'next': 'Developer resolves the listed hooks or installs the complete toolkit via bootstrap; follow docs/development/GEOGI_RELEASE_HANDOFF.md.',
            'readiness_scope': 'static_adapter_contract_only_not_production_acceptance'}


def prepare(root, module, version, target, gate, output, expected_sha=None):
    root = root.resolve()
    require(NAME.fullmatch(version or '') and NAME.fullmatch(target or ''), 'version_and_target_required')
    readiness = inspect_module(root, module)
    require(readiness['status'] == 'adapter_contract_ready', 'native_adapter_not_ready_run_doctor')
    expected_sha = expected_sha or git(root, 'rev-parse', 'HEAD').decode().strip()
    output = output.resolve()
    outside_source(output, root)
    # Freeze source and gate before creating output. make_plan repeats these
    # checks so a source edit during preparation cannot produce a valid plan.
    from tools.releasing.manager import gate_identity, source_identity
    identity = source_identity(root, expected_sha)
    tracked = {name.decode() for name in git(root, 'ls-files', '-z').split(b'\0') if name}
    require(readiness['adapter'] in tracked and
            str(Path(readiness['descriptor']).relative_to(root)) in tracked,
            'adapter_and_descriptor_must_be_committed')
    gate_identity(gate.resolve(), identity)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    from tools.releasing.distribution import bundle
    toolkit = bundle(root, output / 'developer-toolkit.zip')
    commands = {phase: ['{python}', '-m', 'tools.releasing.adapter', '--adapter',
                        '{source}/' + readiness['adapter'], '--phase', phase] for phase in PHASES}
    recipe = {'schema_version': 1, 'profile': readiness['profile'], 'module': module,
              'version': version, 'target': target, 'resource': readiness['resource'],
              'scope': 'software_deployment', 'timeout_seconds': readiness['timeout_seconds'],
              'commands': commands}
    recipe_path = output / 'recipe.json'
    save(recipe_path, recipe, exclusive=True)
    result = make_plan(root, recipe_path, expected_sha, gate, output / 'plan.json')
    result['developer_toolkit'] = toolkit['archive']
    result['developer_entrypoint'] = toolkit['developer_entrypoint']
    result['user_source_relay_required'] = False
    save(output / 'preparation.json', result, exclusive=True)
    return result
