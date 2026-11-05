"""Exact-source release plans and a recoverable, resource-locked deployment journal.

Runtime-specific commands remain owned by the existing Admin/Worker publisher.
This module does not implement SQL, platform sends, or customer report delivery.
"""
from __future__ import annotations

import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import tarfile

from tools.ci.geogi_release_gate import BRANCH, GENERATED, REPOSITORY
import tools.ci.geogi_release_gate as gate_policy

REQUIRED_STAGE_NAMES = getattr(gate_policy, "REQUIRED_STAGE_NAMES", ("architecture_version", "postgres_isolation", "business", "outside_business"))

PHASES = ('check', 'backup', 'stage', 'before_switch', 'switch', 'verify',
          'before_rollback', 'rollback', 'verify_rollback')
SHA = re.compile(r'[0-9a-f]{40}')
HASH = re.compile(r'[0-9a-f]{64}')
NAME = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}')


class ReleaseError(RuntimeError):
    """Fixed diagnostic code safe to show outside private command logs."""


def require(condition, code):
    if not condition:
        raise ReleaseError(code)


def now():
    return datetime.now(timezone.utc).isoformat()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    require(path.is_file() and not path.is_symlink(), 'regular_file_required')
    return digest(path.read_bytes())


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate_json_key')
            result[key] = value
        return result
    require(path.is_file() and not path.is_symlink(), 'json_file_missing_or_symlink')
    return json.loads(path.read_bytes(), object_pairs_hook=unique)


def save(path, value, *, exclusive=False):
    data = encoded(value)
    if exclusive:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    else:
        fd, name = tempfile.mkstemp(prefix='.journal-', dir=path.parent)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.PIPE)


def source_fingerprint(root):
    # Same algorithm and sole generated-data exception as the authoritative gate.
    rows = []
    for raw in git(root, 'ls-files', '-z').split(b'\0'):
        if raw:
            name = os.fsdecode(raw)
            if name in GENERATED:
                continue
            path = root / name
            data = os.fsencode(os.readlink(path)) if path.is_symlink() else path.read_bytes()
            rows.append((name, stat.S_IMODE(path.lstat().st_mode), digest(data)))
    return digest(json.dumps(rows, separators=(',', ':')).encode())


def source_identity(root, expected_sha):
    require(SHA.fullmatch(expected_sha or ''), 'full_source_sha_required')
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == expected_sha, 'source_sha_changed')
    require(not git(root, 'status', '--porcelain', '--untracked-files=all'), 'clean_source_checkout_required')
    origin = git(root, 'remote', 'get-url', 'origin').decode().strip()
    require(origin in (f'https://github.com/{REPOSITORY}.git', f'https://github.com/{REPOSITORY}',
                       f'git@github.com:{REPOSITORY}.git', f'ssh://git@github.com/{REPOSITORY}.git'),
            'official_origin_required')
    return {'sha': expected_sha, 'tree': git(root, 'rev-parse', 'HEAD^{tree}').decode().strip(),
            'branch': git(root, 'branch', '--show-current').decode().strip(),
            'fingerprint': source_fingerprint(root)}


def child(root, name):
    require(isinstance(name, str) and name and not Path(name).is_absolute(), 'relative_path_required')
    parts = Path(name).parts
    require('..' not in parts and all(not (root.joinpath(*parts[:i])).is_symlink()
                                    for i in range(1, len(parts) + 1)), 'unsafe_relative_path')
    path = root / name
    require(path.resolve().is_relative_to(root.resolve()), 'path_outside_root')
    return path


def validate_recipe(recipe):
    require(isinstance(recipe, dict) and type(recipe.get('schema_version')) is int and
            recipe['schema_version'] == 1, 'recipe_schema_invalid')
    require(recipe.get('profile') in ('dev3', 'report', 'feature'), 'unknown_release_profile')
    for key in ('module', 'version', 'target', 'resource'):
        require(isinstance(recipe.get(key), str) and NAME.fullmatch(recipe[key]), 'invalid_recipe_' + key)
    require(recipe.get('scope') == 'software_deployment', 'software_deployment_scope_required')
    commands = recipe.get('commands')
    require(isinstance(commands, dict) and set(commands) == set(PHASES), 'all_runtime_phases_required')
    for argv in commands.values():
        require(isinstance(argv, list) and argv and all(isinstance(arg, str) and arg and '\0' not in arg
                                                     for arg in argv), 'commands_must_be_argv_arrays')
    timeout = recipe.get('timeout_seconds', 900)
    require(type(timeout) is int and 1 <= timeout <= 7200, 'invalid_command_timeout')
    return recipe


def gate_identity(path, identity):
    gate = read_json(path)
    require(isinstance(gate, dict), 'gate_summary_must_be_object')
    require(gate.get('status') == 'automation_passed', 'exact_sha_automation_not_passed')
    require(gate.get('head_sha') == gate.get('expected_sha') == identity['sha'], 'gate_source_sha_mismatch')
    require(gate.get('git_tree') == identity['tree'] and
            gate.get('source_sha256') == gate.get('final_source_sha256') == identity['fingerprint'],
            'gate_source_fingerprint_mismatch')
    require(gate.get('repository') == REPOSITORY and gate.get('branch') == identity['branch'] == BRANCH,
            'authoritative_gate_branch_required')
    stages = gate.get('stages', [])
    require(isinstance(stages, list) and all(isinstance(stage, dict) for stage in stages),
            'gate_stages_invalid')
    for name in REQUIRED_STAGE_NAMES:
        matched = [stage for stage in stages if stage.get('name') == name]
        require(len(matched) == 1 and matched[0].get('exit_code') == 0, 'gate_stage_missing_or_failed')
        if name != 'architecture_version':
            counts = matched[0].get('results', {})
            require(isinstance(counts, dict) and type(counts.get('tests')) is int and counts['tests'] > 0 and
                    all(type(counts.get(key)) is int and counts[key] == 0
                        for key in ('failures', 'errors', 'skipped')), 'gate_tests_not_all_passed')
    files = gate.get('evidence_files')
    require(isinstance(files, dict) and files, 'gate_evidence_files_missing')
    for name, expected in files.items():
        require(isinstance(expected, str) and HASH.fullmatch(expected), 'gate_evidence_hash_invalid')
        require(file_hash(child(path.parent, name)) == expected, 'gate_evidence_hash_mismatch')
    return {'path': str(path), 'sha256': file_hash(path)}


def outside_source(path, root):
    require(not path.is_relative_to(root), 'release_state_must_be_outside_source')


def make_plan(root, recipe_path, expected_sha, gate_path, output):
    root, recipe_path, gate_path, output = [p.resolve() for p in (root, recipe_path, gate_path, output)]
    outside_source(output, root)
    recipe = validate_recipe(read_json(recipe_path))
    identity = source_identity(root, expected_sha)
    gate = gate_identity(gate_path, identity)
    plan = {'schema_version': 1, 'source_root': str(root), 'source': identity,
            'recipe': recipe, 'gate': gate, 'created_at': now(),
            'production_changed': False, 'customer_report_published': False}
    output.parent.mkdir(parents=True, exist_ok=True)
    save(output, plan, exclusive=True)
    return {'plan': str(output), 'plan_sha256': file_hash(output), 'source_sha': expected_sha,
            'profile': recipe['profile'], 'target': recipe['target'], 'resource': recipe['resource'],
            'production_changed': False}


def load_plan(path, expected_hash):
    require(isinstance(expected_hash, str) and HASH.fullmatch(expected_hash), 'plan_sha256_required')
    require(file_hash(path) == expected_hash, 'plan_hash_mismatch')
    plan = read_json(path)
    require(plan.get('schema_version') == 1, 'plan_schema_invalid')
    validate_recipe(plan['recipe'])
    return plan


def verify_source(plan):
    require(source_identity(Path(plan['source_root']), plan['source']['sha']) == plan['source'],
            'planned_source_changed')


def verify_plan_inputs(plan):
    verify_source(plan)
    gate = plan['gate']
    require(file_hash(Path(gate['path'])) == gate['sha256'], 'planned_gate_changed')
    gate_identity(Path(gate['path']), plan['source'])


@contextlib.contextmanager
def locked(state_root, resource):
    state_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not state_root.is_symlink() and stat.S_IMODE(state_root.stat().st_mode) == 0o700,
            'private_state_root_0700_required')
    fd = os.open(state_root / (resource + '.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ReleaseError('release_resource_busy') from error
        yield
    finally:
        os.close(fd)


@contextlib.contextmanager
def interruption_guard():
    previous = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGHUP)}
    def interrupted(*_):
        raise ReleaseError('release_interrupted')
    try:
        for sig in previous:
            signal.signal(sig, interrupted)
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def run_command(argv, *, root, env, log, timeout):
    # Stop local descendants on timeout/interruption. Remote controllers must
    # provide their own cancellation/fencing in before_rollback; killing SSH
    # alone cannot prove the remote operation has stopped.
    with log.open('xb') as stream:
        os.chmod(log, 0o600)
        proc = subprocess.Popen(argv, cwd=root, env=env, stdout=stream, stderr=subprocess.STDOUT,
                                start_new_session=True)
        try:
            return proc.wait(timeout=timeout)
        except BaseException:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.wait()
            raise


class Journal:
    def __init__(self, folder, state):
        self.folder, self.state = folder, state

    def record(self, status, **details):
        self.state.update(status=status, updated_at=now(), **details)
        number = len(list(self.folder.glob('event-*.json'))) + 1
        save(self.folder / f'event-{number:04d}.json', self.state, exclusive=True)
        save(self.folder / 'status.json', self.state)

    def phase(self, name):
        plan = self.state['plan']
        # Recovery must remain possible after the candidate checkout changes.
        # Commands for rollback run from a private copy of tracked controller
        # sources captured before switch (see snapshot_source).
        recovery = name in ('before_rollback', 'rollback', 'verify_rollback')
        root = self.folder / 'source' if recovery else Path(plan['source_root'])
        if recovery:
            verify_recovery(self)
        else:
            verify_source(plan)
        # Count durable context files as well as completed journal phases: a
        # crash may leave a context/log before status.json was updated. Never
        # reuse that filename during recovery.
        sequence = len(list(self.folder.glob('context-*.json'))) + 1
        context = self.folder / f'context-{sequence:03d}-{name}.json'
        save(context, {'phase': name, 'run_directory': str(self.folder),
                       'plan_sha256': self.state['plan_sha256'], 'source_sha': plan['source']['sha'],
                       'target': plan['recipe']['target'], 'resource': plan['recipe']['resource'],
                       'module': plan['recipe']['module'], 'version': plan['recipe']['version'],
                       'profile': plan['recipe']['profile'],
                       'approval_ref': self.state.get('rollback_approval_ref', self.state['approval_ref'])
                       if recovery else self.state['approval_ref']}, exclusive=True)
        argv = [str(root) if arg == '{source}' else sys.executable if arg == '{python}' else
                arg.replace('{source}/', str(root) + '/')
                for arg in plan['recipe']['commands'][name]]
        env = dict(os.environ, GEOGI_RELEASE_CONTEXT=str(context), GEOGI_RELEASE_RUN=str(self.folder),
                   GEOGI_RELEASE_PHASE=name, GEOGI_RELEASE_SHA=plan['source']['sha'],
                   PYTHONDONTWRITEBYTECODE='1', PYTHONPATH=str(root))
        log = self.folder / f'{sequence:03d}-{name}.log'
        result = {'name': name, 'started_at': now(), 'log': log.name}
        self.state['phases'].append(result)
        self.record('running', active_phase=name)
        try:
            code = run_command(argv, root=root, env=env, log=log,
                               timeout=plan['recipe'].get('timeout_seconds', 900))
            result.update(exit_code=code, finished_at=now(), log_sha256=file_hash(log))
            require(code == 0, 'runtime_phase_failed_' + name)
        except BaseException as error:
            result.update(finished_at=now(), error_type=type(error).__name__)
            self.record('phase_failed', active_phase=name)
            raise
        self.record('phase_passed', active_phase=name)


def snapshot_source(root, output):
    # Read Git objects, never recurse over local credentials/untracked files.
    output.mkdir(mode=0o700)
    archive = git(root, 'archive', '--format=tar', 'HEAD')
    with tarfile.open(fileobj=io.BytesIO(archive)) as stream:
        for member in stream:
            path = child(output, member.name.rstrip('/'))
            require(member.isdir() or member.isfile(), 'recovery_source_must_use_regular_files')
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            with stream.extractfile(member) as content:
                path.write_bytes(content.read())
            path.chmod(0o700 if member.mode & 0o111 else 0o600)
    return {str(p.relative_to(output)): file_hash(p) for p in sorted(output.rglob('*')) if p.is_file()}


def verify_recovery(journal):
    root = journal.folder / 'source'
    hashes = journal.state['recovery_source_sha256']
    require(set(hashes) == {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()},
            'recovery_source_files_changed')
    for name, value in hashes.items():
        require(file_hash(child(root, name)) == value, 'recovery_source_hash_mismatch')


def rollback_run(journal):
    verify_recovery(journal)
    journal.record('rolling_back')
    journal.phase('before_rollback')
    # Once compensation starts, repeated terminal interrupts must not abandon
    # the restoration halfway through. SIGKILL/host failure still needs recovery.
    previous = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    try:
        for sig in previous:
            signal.signal(sig, signal.SIG_IGN)
        journal.phase('rollback')
        journal.phase('verify_rollback')
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    journal.record('rolled_back', active_phase=None, runtime_state='baseline_verified')


def check_blocker(state_root, resource, plan_hash):
    for path in state_root.glob('run-*/status.json'):
        state = read_json(path)
        if state['plan']['recipe']['resource'] == resource:
            require(state['status'] in ('deployed', 'rolled_back', 'failed_before_switch'),
                    'unfinished_release_requires_recovery')
            require(not (state['plan_sha256'] == plan_hash and state['switch_attempted']),
                    'plan_already_switched_create_new_plan')


def publish(plan_path, plan_hash, state_root, approval_ref):
    plan = load_plan(plan_path, plan_hash)
    require(isinstance(approval_ref, str) and approval_ref.strip(), 'explicit_approval_reference_required')
    state_root = state_root.absolute()
    outside_source(state_root.resolve(), Path(plan['source_root']).resolve())
    with locked(state_root, plan['recipe']['resource']), interruption_guard():
        check_blocker(state_root, plan['recipe']['resource'], plan_hash)
        verify_plan_inputs(plan)
        folder = Path(tempfile.mkdtemp(prefix='run-', dir=state_root))
        state = {'schema_version': 1, 'plan': plan, 'plan_sha256': plan_hash,
                 'approval_ref': approval_ref, 'created_at': now(), 'phases': [],
                 'switch_attempted': False, 'runtime_state': 'not_switched',
                 'customer_report_published': False}
        journal = Journal(folder, state)
        journal.record('preparing')
        try:
            state['recovery_source_sha256'] = snapshot_source(Path(plan['source_root']), folder / 'source')
            for phase in ('check', 'backup', 'stage', 'before_switch'):
                journal.phase(phase)
            verify_plan_inputs(plan)
            # Persist intent BEFORE invoking the switch: a nonzero/timeout may
            # mean partial cutover, and always requires verified compensation.
            journal.record('switching', switch_attempted=True, runtime_state='unknown')
            journal.phase('switch')
            journal.phase('verify')
            verify_source(plan)
            journal.record('deployed', active_phase=None, runtime_state='candidate_verified')
        except BaseException as error:
            if state['switch_attempted']:
                try:
                    rollback_run(journal)
                except BaseException as rollback_error:
                    journal.record('rollback_failed', runtime_state='unknown',
                                   error_type=type(error).__name__, rollback_error_type=type(rollback_error).__name__)
                    raise ReleaseError('rollback_failed_manual_recovery_required:' + str(folder)) from rollback_error
            else:
                journal.record('failed_before_switch', active_phase=None, error_type=type(error).__name__)
            raise ReleaseError('release_failed:' + str(folder)) from error
        return status(folder)


def rollback(folder, expected_plan_hash, approval_ref):
    state = read_json(folder / 'status.json')
    require(digest(encoded(state['plan'])) == expected_plan_hash, 'rollback_record_plan_changed')
    require(state['plan_sha256'] == expected_plan_hash, 'rollback_plan_hash_mismatch')
    require(bool(approval_ref.strip()), 'explicit_approval_reference_required')
    require(state['status'] not in ('rolled_back', 'failed_before_switch'), 'no_pending_or_deployed_switch')
    with locked(folder.parent, state['plan']['recipe']['resource']), interruption_guard():
        state = read_json(folder / 'status.json')
        require(digest(encoded(state['plan'])) == expected_plan_hash, 'rollback_record_plan_changed')
        require(state['status'] not in ('rolled_back', 'failed_before_switch'), 'no_pending_or_deployed_switch')
        if not state['switch_attempted']:
            # Stage is contractually isolated. No production compensation is
            # needed for a crash before the durable switching intent. Retain
            # the backup/stage artifacts and release the journal blocker.
            journal = Journal(folder, state)
            journal.record('failed_before_switch', active_phase=None,
                           recovery_approval_ref=approval_ref, runtime_state='not_switched')
            return status(folder)
        # Rollback of an old release must not overwrite a newer live release.
        later = [read_json(p) for p in folder.parent.glob('run-*/status.json') if p.parent != folder]
        require(not any(s['plan']['recipe']['resource'] == state['plan']['recipe']['resource'] and
                        s['created_at'] > state['created_at'] and s['switch_attempted'] for s in later),
                'newer_release_exists_use_its_recovery')
        journal = Journal(folder, state)
        state['rollback_approval_ref'] = approval_ref
        try:
            rollback_run(journal)
        except BaseException as error:
            journal.record('rollback_failed', runtime_state='unknown', rollback_error_type=type(error).__name__)
            raise ReleaseError('rollback_failed_manual_recovery_required:' + str(folder)) from error
        return status(folder)


def status(folder):
    state = read_json(folder / 'status.json')
    return {'run_directory': str(folder), 'status': state['status'],
            'source_sha': state['plan']['source']['sha'], 'plan_sha256': state['plan_sha256'],
            'profile': state['plan']['recipe']['profile'], 'target': state['plan']['recipe']['target'],
            'runtime_state': state['runtime_state'], 'customer_report_published': False,
            'phases': [{k: v for k, v in phase.items() if k in ('name', 'exit_code', 'error_type')}
                       for phase in state['phases']]}
