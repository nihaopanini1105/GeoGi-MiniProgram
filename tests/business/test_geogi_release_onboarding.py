"""Future module onboarding, with real synthetic adapter subprocesses only."""
import json
from pathlib import Path

import pytest

from tools.live.geogi_release import main
from tools.releasing import manager as m
from tools.releasing import onboarding as o
from tests.business.test_geogi_unified_release import candidate, git


@pytest.mark.parametrize('module,profile,runtime,resource', [
    ('dev3-admin', 'dev3', 'admin', 'geogi-admin'),
    ('dev3-worker', 'dev3', 'worker', 'capture-worker'),
    ('report', 'report', 'admin', 'geogi-admin'),
    ('future-feature', 'feature', 'custom', 'custom-service'),
])
def test_scaffold_is_version_independent_and_reports_missing_hooks(tmp_path, module, profile, runtime, resource):
    result = o.scaffold(tmp_path, module, profile, runtime, resource)
    descriptor = m.read_json(Path(result['descriptor']))
    assert descriptor['resource'] == resource
    assert not {'branch', 'version', 'sha', 'target'} & descriptor.keys()
    check = o.inspect_module(tmp_path, module)
    assert check['status'] == 'needs_implementation'
    assert {item['phase'] for item in check['issues']} == set(m.PHASES)
    assert check['production_changed'] is False
    with pytest.raises(m.ReleaseError, match='release_module_already_exists'):
        o.scaffold(tmp_path, module, profile, runtime, resource)


def test_doctor_never_imports_adapter_and_cannot_publish_stubs(tmp_path):
    result = o.scaffold(tmp_path, 'report', 'report', 'admin')
    adapter = Path(result['adapter'])
    adapter.write_text('raise RuntimeError("MUST_NOT_IMPORT_DURING_DOCTOR")\n' + adapter.read_text())
    assert len(o.inspect_module(tmp_path, 'report')['issues']) == len(m.PHASES)
    with pytest.raises(m.ReleaseError, match='native_adapter_not_ready_run_doctor'):
        o.prepare(tmp_path, 'report', 'r1', 'synthetic-host', tmp_path/'missing-gate', tmp_path/'output')
    assert not (tmp_path/'output').exists()


@pytest.mark.parametrize('module', ['../escape', '/absolute', '', 'contains space'])
def test_scaffold_rejects_unsafe_module(tmp_path, module):
    with pytest.raises(m.ReleaseError, match='invalid_release_module'):
        o.scaffold(tmp_path, module, 'feature', 'admin')


def test_shared_admin_lock_cannot_be_renamed_by_scaffold(tmp_path):
    with pytest.raises(m.ReleaseError, match='shared_runtime_resource_required'):
        o.scaffold(tmp_path, 'report', 'report', 'admin', 'report-only-lock')
    assert not (tmp_path/'deploy').exists()


def install_synthetic_adapter(candidate, module='report', profile='report', runtime='admin'):
    root = candidate[0]
    repo = Path(__file__).resolve().parents[2]
    # A finished module contains this common SDK; no imports from the real
    # working directory are used by either forward or recovery subprocesses.
    from tools.releasing.distribution import payload
    for name, content in payload(repo).items():
        if (name.startswith('deploy/releases/') and name != 'deploy/releases/README.md') or name in (
                'bootstrap.py', 'README_TOOLKIT.md', 'DEVELOPER_TASK.md', 'toolkit-manifest.json'):
            continue
        target = root/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    result = o.scaffold(root, module, profile, runtime)
    bodies = {
        'check': "assert context.target == 'synthetic-host'",
        'backup': "context.write_json('baseline.json', {'version': 'baseline'})",
        'stage': "context.path('isolated-stage').write_text('synthetic rehearsal')",
        'before_switch': "assert context.read_json('baseline.json')['version'] == 'baseline'",
        'switch': "context.path('runtime').write_text('candidate')",
        'verify': "assert context.path('runtime').read_text() == 'candidate'",
        'before_rollback': "assert context.path('runtime').read_text() == 'candidate'",
        'rollback': "context.path('runtime').write_text(context.read_json('baseline.json')['version'])",
        'verify_rollback': "assert context.path('runtime').read_text() == 'baseline'",
    }
    source = 'from tools.releasing.adapter import ReleaseAdapter\nclass Adapter(ReleaseAdapter):\n'
    for phase in m.PHASES:
        source += f"    def {phase}(self, context):\n        {bodies[phase]}\n        return {{'verified': True}}\n"
    Path(result['adapter']).write_text(source)
    return result


def refresh_synthetic_gate(candidate):
    root = candidate[0]
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'synthetic completed module and release SDK')
    sha = git(root, 'rev-parse', 'HEAD')
    identity = m.source_identity(root, sha)
    gate = m.read_json(candidate[2]/'summary.json')
    gate.update(head_sha=sha, expected_sha=sha, git_tree=identity['tree'],
                source_sha256=identity['fingerprint'], final_source_sha256=identity['fingerprint'])
    m.save(candidate[2]/'summary.json', gate)
    return sha


@pytest.mark.parametrize('module,profile,runtime', [
    ('dev3-admin', 'dev3', 'admin'), ('dev3-worker', 'dev3', 'worker'),
    ('report', 'report', 'admin'), ('future', 'feature', 'admin'),
])
def test_finished_module_can_prepare_publish_and_recover_without_branch_input(candidate, module, profile, runtime):
    install_synthetic_adapter(candidate, module, profile, runtime)
    assert o.inspect_module(candidate[0], module)['status'] == 'adapter_contract_ready'
    sha = refresh_synthetic_gate(candidate)
    bundle = candidate[3].parent/'prepared'
    plan = o.prepare(candidate[0], module, 'r20', 'synthetic-host', candidate[2]/'summary.json', bundle)
    assert plan['source_sha'] == sha
    assert Path(plan['developer_toolkit']).is_file()
    assert plan['user_source_relay_required'] is False
    assert m.read_json(bundle/'preparation.json')['plan_sha256'] == plan['plan_sha256']
    deployed = m.publish(bundle/'plan.json', plan['plan_sha256'], candidate[-1], 'SYNTHETIC_AUTHORIZATION')
    folder = Path(deployed['run_directory'])
    assert deployed['status'] == 'deployed'
    receipts = list(folder.glob('*.adapter-result.json'))
    assert len(receipts) == 6
    assert all(m.read_json(p)['verified'] is True for p in receipts)
    # A developer checkout change must not break frozen recovery.
    (candidate[0]/'deploy/releases'/module/'adapter.py').write_text('raise RuntimeError("changed")')
    assert m.rollback(folder, plan['plan_sha256'], 'SYNTHETIC_RECOVERY')['status'] == 'rolled_back'
    assert (folder/'runtime').read_text() == 'baseline'


def test_doctor_checks_syntax_and_noop_methods(tmp_path):
    result = o.scaffold(tmp_path, 'report', 'report', 'admin')
    adapter = Path(result['adapter'])
    adapter.write_text('from tools.releasing.adapter import ReleaseAdapter\nclass Adapter(ReleaseAdapter):\n'
                       '    def check(self, context):\n        pass\n')
    assert len(o.inspect_module(tmp_path, 'report')['issues']) == 9
    adapter.write_text('syntax error :')
    assert o.inspect_module(tmp_path, 'report')['issues'] == [{'code':'SyntaxError'}]


def test_cli_scaffold_and_doctor_are_usable_before_module_development(tmp_path, capsys):
    assert main(['scaffold', '--module','new-feature','--profile','feature','--runtime','admin',
                 '--root',str(tmp_path)]) == 0
    assert main(['doctor','--module','new-feature','--root',str(tmp_path)]) == 2
    lines = capsys.readouterr().out.splitlines()
    assert json.loads(lines[-1])['status'] == 'needs_implementation'
    assert not list(tmp_path.rglob('*.log'))


def test_existing_starter_kits_are_safe_and_future_versions_are_not_pinned():
    root = Path(__file__).resolve().parents[2]
    for module in ('dev3-admin','dev3-worker','report'):
        result = o.inspect_module(root, module)
        assert result['status'] == 'needs_implementation'
        assert len(result['issues']) == 9


def test_native_hook_must_return_verified_receipt(candidate):
    result = install_synthetic_adapter(candidate)
    adapter = Path(result['adapter'])
    adapter.write_text(adapter.read_text().replace("return {'verified': True}", 'return None'))
    refresh_synthetic_gate(candidate)
    bundle = candidate[3].parent/'prepared'
    plan = o.prepare(candidate[0],'report','r21','synthetic-host',candidate[2]/'summary.json',bundle)
    with pytest.raises(m.ReleaseError,match='release_failed:'):
        m.publish(bundle/'plan.json',plan['plan_sha256'],candidate[-1],'SYNTHETIC')
    folder = next(candidate[-1].glob('run-*'))
    assert m.status(folder)['status'] == 'failed_before_switch'
    assert 'native_hook_verified_receipt_required' in (folder/'001-check.log').read_text()


def test_cli_prepare_automatically_uses_current_head(candidate, capsys):
    install_synthetic_adapter(candidate)
    expected = refresh_synthetic_gate(candidate)
    output = candidate[3].parent/'cli-prepared'
    assert main(['prepare','--root',str(candidate[0]),'--module','report','--version','r22',
                 '--target','synthetic-host','--gate',str(candidate[2]/'summary.json'),
                 '--output',str(output)]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result['source_sha'] == expected
    assert m.read_json(output/'recipe.json')['version'] == 'r22'
    assert m.read_json(output/'plan.json')['recipe']['commands']['switch'][2] == 'tools.releasing.adapter'


def test_ignored_adapter_cannot_escape_source_provenance(candidate):
    result = install_synthetic_adapter(candidate)
    refresh_synthetic_gate(candidate)
    relative = str(Path(result['adapter']).relative_to(candidate[0]))
    git(candidate[0], 'rm', '--cached', '--', relative)
    (candidate[0]/'.gitignore').write_text(relative+'\n')
    refresh_synthetic_gate(candidate)
    with pytest.raises(m.ReleaseError, match='adapter_and_descriptor_must_be_committed'):
        o.prepare(candidate[0], 'report', 'r23', 'synthetic-host', candidate[2]/'summary.json',
                  candidate[3].parent/'ignored-adapter-plan')
