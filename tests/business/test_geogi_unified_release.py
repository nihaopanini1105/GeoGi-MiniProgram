"""Real subprocess/temporary Git tests; all runtime and gate data are synthetic."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from tools.live.geogi_release import main
from tools.releasing import manager as m

DRIVER = '''import json, os, pathlib, signal, sys, time
phase = sys.argv[1]
run = pathlib.Path(os.environ['GEOGI_RELEASE_RUN'])
ctx = json.loads(pathlib.Path(os.environ['GEOGI_RELEASE_CONTEXT']).read_text())
assert ctx['phase'] == phase and ctx['target'] == 'synthetic-host'
assert ctx['source_sha'] == os.environ['GEOGI_RELEASE_SHA']
assert ctx['resource'] == 'shared-admin'
assert pathlib.Path.cwd() == pathlib.Path(__file__).parent
with (run / 'calls.txt').open('a') as f: f.write(phase + '\\n')
fail = pathlib.Path(ctx.get('unused', str(run.parent / 'fail')))
if fail.exists() and fail.read_text() == phase:
    if phase == 'switch': (run / 'runtime').write_text('partial')
    sys.exit(17)
if phase == 'backup': (run / 'backup').write_text('baseline')
if phase == 'switch':
    (run / 'runtime').write_text('candidate')
    if (run.parent / 'interrupt').exists(): os.kill(os.getppid(), signal.SIGTERM); time.sleep(20)
    if (run.parent / 'timeout').exists(): time.sleep(20)
if phase == 'verify': assert (run / 'runtime').read_text() == 'candidate'
if phase == 'rollback': (run / 'runtime').write_text((run / 'backup').read_text())
if phase == 'verify_rollback': assert (run / 'runtime').read_text() == 'baseline'
'''


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.PIPE).decode().strip()


@pytest.fixture
def candidate(tmp_path):
    root = tmp_path / 'checkout'
    root.mkdir()
    git(root, 'init', '-b', m.BRANCH)
    git(root, 'config', 'user.name', 'Synthetic Release Test')
    git(root, 'config', 'user.email', 'synthetic@example.invalid')
    git(root, 'remote', 'add', 'origin', f'https://github.com/{m.REPOSITORY}.git')
    (root / 'driver.py').write_text(DRIVER)
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'synthetic release driver')
    sha = git(root, 'rev-parse', 'HEAD')
    recipe = {'schema_version': 1, 'profile': 'dev3', 'module': 'capture', 'version': 'r8',
              'target': 'synthetic-host', 'resource': 'shared-admin', 'scope': 'software_deployment',
              'commands': {phase: ['{python}', '{source}/driver.py', phase] for phase in m.PHASES},
              'timeout_seconds': 5}
    recipe_path = tmp_path / 'recipe.json'
    m.save(recipe_path, recipe, exclusive=True)
    evidence = tmp_path / 'synthetic-gate'
    evidence.mkdir()
    (evidence / 'tests.log').write_text('SYNTHETIC gate fixture, not actual release evidence')
    identity = m.source_identity(root, sha)
    gate = {'status': 'automation_passed', 'head_sha': sha, 'expected_sha': sha,
            'git_tree': identity['tree'], 'source_sha256': identity['fingerprint'],
            'final_source_sha256': identity['fingerprint'], 'repository': m.REPOSITORY,
            'branch': m.BRANCH,
            'stages': [{'name': name, 'exit_code': 0,
                        'results': {'tests': 1, 'failures': 0, 'errors': 0, 'skipped': 0}}
                       for name in m.REQUIRED_STAGE_NAMES],
            'evidence_files': {'tests.log': m.file_hash(evidence / 'tests.log')}}
    m.save(evidence / 'summary.json', gate, exclusive=True)
    plan_path = tmp_path / 'plan.json'
    result = m.make_plan(root, recipe_path, sha, evidence / 'summary.json', plan_path)
    state_root = tmp_path / 'release-state'
    state_root.mkdir(mode=0o700)
    return root, recipe_path, evidence, plan_path, result['plan_sha256'], state_root


def deploy(candidate):
    _, _, _, plan, plan_hash, state = candidate
    return m.publish(plan, plan_hash, state, 'SYNTHETIC_OPERATOR_AUTHORIZATION')


def run_folder(candidate):
    return next(candidate[-1].glob('run-*'))


def test_success_runs_real_subprocesses_and_records_private_logs(candidate):
    result = deploy(candidate)
    folder = Path(result['run_directory'])
    assert result['status'] == 'deployed'
    assert result['runtime_state'] == 'candidate_verified'
    assert result['customer_report_published'] is False
    assert (folder / 'calls.txt').read_text().splitlines() == list(m.PHASES[:6])
    assert result['phases'][-1] == {'name': 'verify', 'exit_code': 0}
    assert all(p.stat().st_mode & 0o777 == 0o600 for p in folder.glob('*.log'))
    assert list(folder.glob('event-*.json'))
    assert git(candidate[0], 'status', '--porcelain') == ''


@pytest.mark.parametrize('profile', ['dev3', 'report', 'feature'])
def test_all_profiles_share_the_same_pipeline(candidate, profile):
    recipe = m.read_json(candidate[1])
    recipe['profile'] = profile
    m.save(candidate[1], recipe)
    path = candidate[3].with_name('other-plan.json')
    data = m.make_plan(candidate[0], candidate[1], git(candidate[0], 'rev-parse', 'HEAD'),
                       candidate[2] / 'summary.json', path)
    assert m.publish(path, data['plan_sha256'], candidate[-1], 'SYNTHETIC')['profile'] == profile


@pytest.mark.parametrize('phase', ['check', 'backup', 'stage', 'before_switch', 'switch', 'verify'])
def test_failures_before_and_after_partial_switch(candidate, phase):
    (candidate[-1] / 'fail').write_text(phase)
    with pytest.raises(m.ReleaseError, match='release_failed:'):
        deploy(candidate)
    folder = run_folder(candidate)
    result = m.status(folder)
    calls = (folder / 'calls.txt').read_text().splitlines()
    if phase in ('switch', 'verify'):
        assert result['status'] == 'rolled_back'
        assert calls[-3:] == list(m.PHASES[-3:])
        assert (folder / 'runtime').read_text() == 'baseline'
    else:
        assert result['status'] == 'failed_before_switch'
        assert 'switch' not in calls and 'rollback' not in calls


def test_rollback_failure_blocks_new_publish_and_recovers_from_frozen_source(candidate):
    deploy(candidate)
    folder = run_folder(candidate)
    (candidate[-1] / 'fail').write_text('rollback')
    with pytest.raises(m.ReleaseError, match='rollback_failed_manual_recovery_required'):
        m.rollback(folder, candidate[4], 'SYNTHETIC_RECOVERY')
    with pytest.raises(m.ReleaseError, match='unfinished_release_requires_recovery'):
        deploy(candidate)
    (candidate[-1] / 'fail').unlink()
    (candidate[0] / 'driver.py').write_text('raise RuntimeError("changed checkout")')
    assert m.rollback(folder, candidate[4], 'SYNTHETIC_RECOVERY')['status'] == 'rolled_back'


def test_changed_recovery_source_is_rejected(candidate):
    deploy(candidate)
    folder = run_folder(candidate)
    (folder / 'source' / 'driver.py').write_text('print("tampered")')
    with pytest.raises(m.ReleaseError, match='rollback_failed'):
        m.rollback(folder, candidate[4], 'SYNTHETIC_RECOVERY')
    assert m.status(folder)['runtime_state'] == 'unknown'


@pytest.mark.parametrize('change', ['source', 'plan', 'gate', 'evidence', 'untracked', 'origin'])
def test_changed_inputs_block_before_commands(candidate, change):
    root, _, evidence, plan, plan_hash, state = candidate
    if change == 'source':
        (root / 'driver.py').write_text('changed')
    elif change == 'plan':
        plan.write_text(plan.read_text() + ' ')
    elif change == 'gate':
        (evidence / 'summary.json').write_text('{}')
    elif change == 'evidence':
        (evidence / 'tests.log').write_text('changed')
    elif change == 'untracked':
        (root / 'untracked').touch()
    else:
        git(root, 'remote', 'set-url', 'origin', 'https://example.invalid/repo.git')
    with pytest.raises(m.ReleaseError):
        m.publish(plan, plan_hash, state, 'SYNTHETIC')
    assert not list(state.glob('run-*'))


@pytest.mark.parametrize('counts', [dict(tests=0), dict(failures=1), dict(errors=1), dict(skipped=1), dict(skipped=False)])
def test_missing_or_nonpassing_gate_counts_are_rejected(candidate, counts):
    gate_path = candidate[2] / 'summary.json'
    gate = m.read_json(gate_path)
    gate['stages'][1]['results'].update(counts)
    m.save(gate_path, gate)
    with pytest.raises(m.ReleaseError, match='gate_tests_not_all_passed'):
        m.gate_identity(gate_path, m.read_json(candidate[3])['source'])


@pytest.mark.parametrize('name', ['../outside', '/etc/passwd'])
def test_evidence_traversal_rejected(candidate, name):
    gate = m.read_json(candidate[2] / 'summary.json')
    gate['evidence_files'] = {name: 'f' * 64}
    m.save(candidate[2] / 'summary.json', gate)
    with pytest.raises(m.ReleaseError):
        m.gate_identity(candidate[2] / 'summary.json', m.read_json(candidate[3])['source'])


def test_shared_resource_lock_blocks_other_profile(candidate):
    fd = os.open(candidate[-1] / 'shared-admin.lock', os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(m.ReleaseError, match='release_resource_busy'):
            deploy(candidate)
    finally:
        os.close(fd)


def test_manual_rollback_and_replay_guard(candidate):
    deploy(candidate)
    folder = run_folder(candidate)
    assert m.rollback(folder, candidate[4], 'SYNTHETIC')['status'] == 'rolled_back'
    with pytest.raises(m.ReleaseError, match='no_pending_or_deployed_switch'):
        m.rollback(folder, candidate[4], 'SYNTHETIC')


def test_old_release_cannot_rollback_over_newer_release(candidate):
    first = Path(deploy(candidate)['run_directory'])
    new_plan = candidate[3].with_name('next-plan.json')
    result = m.make_plan(candidate[0], candidate[1], git(candidate[0], 'rev-parse', 'HEAD'),
                         candidate[2] / 'summary.json', new_plan)
    second = Path(m.publish(new_plan, result['plan_sha256'], candidate[-1], 'SYNTHETIC')['run_directory'])
    assert first != second
    with pytest.raises(m.ReleaseError, match='newer_release_exists'):
        m.rollback(first, candidate[4], 'SYNTHETIC')


def test_interrupted_run_requires_recovery(candidate):
    deploy(candidate)
    folder = run_folder(candidate)
    state = m.read_json(folder / 'status.json')
    state['status'] = 'switching'
    m.save(folder / 'status.json', state)
    with pytest.raises(m.ReleaseError, match='unfinished_release_requires_recovery'):
        deploy(candidate)
    assert m.rollback(folder, candidate[4], 'SYNTHETIC')['status'] == 'rolled_back'


def test_switch_timeout_compensates_using_real_subprocess(candidate):
    recipe = m.read_json(candidate[1])
    recipe['timeout_seconds'] = 1
    m.save(candidate[1], recipe)
    plan = candidate[3].with_name('timeout-plan.json')
    result = m.make_plan(candidate[0], candidate[1], git(candidate[0], 'rev-parse', 'HEAD'),
                         candidate[2] / 'summary.json', plan)
    (candidate[-1] / 'timeout').touch()
    with pytest.raises(m.ReleaseError, match='release_failed:'):
        m.publish(plan, result['plan_sha256'], candidate[-1], 'SYNTHETIC')
    assert m.status(run_folder(candidate))['status'] == 'rolled_back'


def test_cli_init_status_and_shell_metacharacters_are_literal(candidate, capsys):
    recipe = m.read_json(candidate[1])
    recipe['commands']['check'] += ['$(touch DO_NOT_CREATE)']
    commands = candidate[1].with_name('commands.json')
    m.save(commands, recipe['commands'], exclusive=True)
    output = candidate[1].with_name('initialized.json')
    assert main(['init', '--profile', 'report', '--module', 'report', '--version', 'r9',
                 '--target', 'synthetic-host', '--resource', 'shared-admin', '--commands', str(commands),
                 '--output', str(output)]) == 0
    assert m.read_json(output)['commands']['check'][-1] == '$(touch DO_NOT_CREATE)'
    result = deploy(candidate)
    assert main(['status', '--run', result['run_directory']]) == 0
    assert 'deployed' in capsys.readouterr().out


def test_incomplete_commands_or_missing_authorization_are_rejected(candidate):
    recipe = m.read_json(candidate[1])
    del recipe['commands']['verify_rollback']
    with pytest.raises(m.ReleaseError, match='all_runtime_phases_required'):
        m.validate_recipe(recipe)
    with pytest.raises(m.ReleaseError, match='explicit_approval_reference_required'):
        m.publish(candidate[3], candidate[4], candidate[-1], '')


def test_plan_is_read_only_and_status_does_not_run_native_commands(candidate):
    assert not list(candidate[-1].glob('run-*'))
    deploy(candidate)
    folder = run_folder(candidate)
    before = (folder / 'calls.txt').read_bytes()
    m.status(folder)
    assert (folder / 'calls.txt').read_bytes() == before


def test_published_plan_cannot_be_replayed(candidate):
    deploy(candidate)
    before = (run_folder(candidate) / 'calls.txt').read_bytes()
    with pytest.raises(m.ReleaseError, match='plan_already_switched_create_new_plan'):
        deploy(candidate)
    assert (run_folder(candidate) / 'calls.txt').read_bytes() == before


def test_symlink_evidence_and_duplicate_json_are_rejected(candidate):
    evidence = candidate[2] / 'tests.log'
    evidence.unlink()
    evidence.symlink_to(candidate[0] / 'driver.py')
    with pytest.raises(m.ReleaseError, match='unsafe_relative_path'):
        deploy(candidate)
    duplicate = candidate[1].with_name('duplicate.json')
    duplicate.write_text('{"a":1,"a":2}')
    with pytest.raises(m.ReleaseError, match='duplicate_json_key'):
        m.read_json(duplicate)


def test_switch_signal_is_compensated_in_isolated_cli_process(candidate):
    # Never signal the pytest process. A dedicated CLI process owns signal
    # handling and the real sleeping switch child; all runtime data are synthetic.
    (candidate[-1] / 'interrupt').touch()
    proc = subprocess.run([sys.executable, '-m', 'tools.live.geogi_release', 'publish',
                           '--plan', str(candidate[3]), '--plan-sha256', candidate[4],
                           '--state-root', str(candidate[-1]), '--approval-ref', 'SYNTHETIC'],
                          capture_output=True, text=True, timeout=20,
                          env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
    assert proc.returncode == 2
    assert 'release_failed:' in proc.stderr
    assert m.status(run_folder(candidate))['status'] == 'rolled_back'


def test_recovery_of_crash_before_switch_releases_blocker(candidate):
    (candidate[-1] / 'fail').write_text('stage')
    with pytest.raises(m.ReleaseError, match='release_failed:'):
        deploy(candidate)
    folder = run_folder(candidate)
    state = m.read_json(folder / 'status.json')
    state['status'] = 'running'
    m.save(folder / 'status.json', state)
    before = (folder / 'calls.txt').read_bytes()
    result = m.rollback(folder, candidate[4], 'SYNTHETIC_RECOVERY')
    assert result['status'] == 'failed_before_switch'
    assert (folder / 'calls.txt').read_bytes() == before
    (candidate[-1] / 'fail').unlink()
    assert deploy(candidate)['status'] == 'deployed'


def test_recovery_preserves_orphan_context_after_crash(candidate):
    deploy(candidate)
    folder = run_folder(candidate)
    orphan = folder / 'context-007-before_rollback.json'
    orphan.write_text('orphan from a crash before journal status save')
    assert m.rollback(folder, candidate[4], 'SYNTHETIC')['status'] == 'rolled_back'
    assert orphan.read_text().startswith('orphan')
    assert (folder / 'context-008-before_rollback.json').exists()
