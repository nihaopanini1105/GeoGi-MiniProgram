"""Portable source delivery and conflict-safe installation, no live runtimes."""
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile

import pytest

from tools.releasing import bootstrap as b
from tools.releasing import distribution as d
from tools.releasing import manager as m

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def kit(tmp_path):
    package = tmp_path/'package'
    package.mkdir()
    for name, value in d.payload(ROOT).items():
        target = package/name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value)
    return package


@pytest.fixture
def destination(tmp_path):
    target = tmp_path/'feature-checkout'
    target.mkdir()
    subprocess.run(['git','init',str(target)],check=True,capture_output=True)
    (target/'feature.py').write_text('existing business feature\n')
    (target/'Makefile').write_text('.PHONY: feature\nfeature:\n\t@echo existing\n')
    (target/'AGENTS.md').write_text('# Existing branch instructions\nKeep tenant isolation.\n')
    return target


def test_complete_bundle_contains_code_handoff_tests_bootstrap_and_dependency_closure(tmp_path):
    archive = tmp_path/'toolkit.zip'
    result = d.bundle(ROOT, archive)
    assert result['status'] == 'complete_toolkit'
    assert result['user_source_relay_required'] is False
    extracted = tmp_path/'extracted'
    extracted.mkdir()
    assert d.unpack(archive.read_bytes(),extracted)['status'] == 'complete_toolkit'
    assert set(b.REQUIRED_FILES) <= set(zipfile.ZipFile(archive).namelist())
    assert not any('.env' in name or '__pycache__' in name or name.endswith('.log')
                   for name in zipfile.ZipFile(archive).namelist())
    for name in ('dev3-admin','dev3-worker','report'):
        assert 'NotImplementedError' in (extracted/'deploy/releases'/name/'adapter.py').read_text()


def test_standalone_bootstrap_runs_without_installed_geogi_package(kit,destination):
    result = subprocess.run([sys.executable,str(kit/'bootstrap.py'),'check'],cwd=kit,
                            text=True,capture_output=True,check=True)
    assert json.loads(result.stdout)['status'] == 'complete_toolkit'
    proc = subprocess.run([sys.executable,str(kit/'bootstrap.py'),'install','--target',str(destination)],
                          cwd=kit,text=True,capture_output=True,check=True)
    assert json.loads(proc.stdout)['status'] == 'installed'
    assert (destination/'tools/live/geogi_release.py').is_file()
    check = subprocess.run([sys.executable,'-m','tools.live.geogi_release','doctor','--module','report'],
                           cwd=destination,text=True,capture_output=True)
    assert check.returncode == 2
    assert json.loads(check.stdout)['status'] == 'needs_implementation'


def test_installer_preserves_branch_code_native_hooks_gate_and_make_targets(kit,destination):
    native = destination/'deploy/releases/report/adapter.py'
    native.parent.mkdir(parents=True)
    native.write_text('owner-specific deployment implementation\n')
    gate = destination/'tools/ci/geogi_release_gate.py'
    gate.parent.mkdir(parents=True)
    gate.write_text("BRANCH='newer-native-policy'\nGENERATED=set()\nREPOSITORY='owner/repo'\n")
    result = b.install(kit,destination)
    assert native.read_text() == 'owner-specific deployment implementation\n'
    assert 'newer-native-policy' in gate.read_text()
    assert (destination/'feature.py').read_text() == 'existing business feature\n'
    assert '@echo existing' in (destination/'Makefile').read_text()
    assert (destination/'Makefile').read_text().count('release:') == 1
    assert 'Keep tenant isolation.' in (destination/'AGENTS.md').read_text()
    assert b.OWNER_BEGIN in (destination/'AGENTS.md').read_text()
    assert 'deploy/releases/report/adapter.py' in result['preserved']
    assert result['production_changed'] is False
    probe = subprocess.run([sys.executable,'-c',
                            'import tools.releasing.distribution; print("IMPORT_OK")'],
                           cwd=destination,text=True,capture_output=True)
    assert probe.returncode == 0, probe.stderr


def test_repeated_install_is_idempotent(kit,destination):
    b.install(kit,destination)
    result = b.install(kit,destination)
    assert result['written'] == []
    assert (destination/'AGENTS.md').read_text().count(b.OWNER_BEGIN) == 1


def test_modified_common_tool_requires_developer_review_and_has_backup(kit,destination):
    b.install(kit,destination)
    path = destination/'tools/releasing/sdk.py'
    path.write_text('# local tool modification\n')
    with pytest.raises(b.KitError,match='developer_merge_required:tools/releasing/sdk.py'):
        b.install(kit,destination)
    assert path.read_text() == '# local tool modification\n'
    result = b.install(kit,destination,update_tools=True)
    assert path.read_bytes() == (kit/'tools/releasing/sdk.py').read_bytes()
    assert (Path(result['backup_directory'])/'tools/releasing/sdk.py').read_text() == '# local tool modification\n'


def test_unrelated_release_make_target_is_not_overwritten(kit,destination):
    original = 'release:\n\t@echo native-publisher\n'
    (destination/'Makefile').write_text(original)
    with pytest.raises(b.KitError,match='developer_merge_required:Makefile'):
        b.install(kit,destination,update_tools=True)
    assert (destination/'Makefile').read_text() == original
    assert not (destination/'tools/releasing').exists()


@pytest.mark.parametrize('name',['tools/releasing/manager.py','tools/live/geogi_release.py',
                                 'docs/development/GEOGI_RELEASE_HANDOFF.md'])
def test_missing_or_changed_source_cannot_be_handed_off(kit,name):
    (kit/name).unlink()
    with pytest.raises(b.KitError,match='toolkit_file_missing_or_changed'):
        b.validate(kit)


def test_missing_source_in_export_fails_before_delivering_docs_only(tmp_path):
    with pytest.raises(m.ReleaseError,match='toolkit_source_missing'):
        d.bundle(tmp_path,tmp_path.parent/'not-delivered.zip')


def test_manifest_traversal_is_rejected(kit):
    manifest = json.loads((kit/'toolkit-manifest.json').read_bytes())
    manifest['files']['../escape.py'] = 'f'*64
    (kit/'toolkit-manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(b.KitError,match='unsafe_package_path'):
        b.validate(kit)


def test_missing_direct_dependency_is_rejected_even_if_manifest_is_rehashed(kit):
    name = 'tools/releasing/adapter.py'
    (kit/name).write_text('from tools.releasing.missing_dependency import thing\n')
    manifest = json.loads((kit/'toolkit-manifest.json').read_bytes())
    manifest['files'][name] = b.sha((kit/name).read_bytes())
    (kit/'toolkit-manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(b.KitError,match='toolkit_dependency_missing'):
        b.validate(kit)


def test_write_failure_restores_files_already_changed(kit,destination,monkeypatch):
    original = b._atomic
    fired = False
    def fail_on_sdk(path,data):
        nonlocal fired
        if path == destination/'tools/releasing/sdk.py' and not fired:
            fired = True
            raise OSError('injected write failure')
        return original(path,data)
    monkeypatch.setattr(b,'_atomic',fail_on_sdk)
    before_make = (destination/'Makefile').read_bytes()
    before_policy = (destination/'AGENTS.md').read_bytes()
    with pytest.raises(OSError,match='injected write failure'):
        b.install(kit,destination)
    assert (destination/'Makefile').read_bytes() == before_make
    assert (destination/'AGENTS.md').read_bytes() == before_policy
    assert not (destination/'tools/live/geogi_release.py').exists()


def test_distribution_rejects_archive_symlink_and_duplicate_entries(tmp_path):
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as archive:
        info=zipfile.ZipInfo('link')
        info.external_attr=0o120777<<16
        archive.writestr(info,'../outside')
    with pytest.raises(m.ReleaseError,match='non_regular_toolkit_archive_entry'):
        d.unpack(stream.getvalue(),tmp_path/'out')


@pytest.mark.parametrize('content',[
    'release another-target:\n\t@echo native\n',
    '# tools.live.geogi_release\nrelease:\n\t@echo native\n',
])
def test_makefile_native_release_is_not_confused_with_common_dispatcher(kit,destination,content):
    (destination/'Makefile').write_text(content)
    with pytest.raises(b.KitError,match='developer_merge_required:Makefile'):
        b.install(kit,destination)
    assert (destination/'Makefile').read_text() == content


def test_unexpected_business_file_cannot_be_imported_as_toolkit_source(kit):
    (kit/'feature.py').write_text('unrelated source')
    manifest = json.loads((kit/'toolkit-manifest.json').read_bytes())
    manifest['files']['feature.py'] = b.sha((kit/'feature.py').read_bytes())
    (kit/'toolkit-manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(b.KitError,match='unexpected_toolkit_file'):
        b.validate(kit)


def test_distribution_test_environment_drops_live_credentials():
    env = d.isolated_test_environment({'PATH':'/usr/bin','DATABASE_URL':'private',
        'GEOGI_OPS_POSTGRES_DSN':'private','PROCESSOR_API_KEY':'private','PGPASSWORD':'private',
        'GEOGI_OPS_TOKENS_JSON':'private','SERVICE_SECRET':'private','SERVICE_TOKEN':'private'})
    assert env == {'PATH':'/usr/bin'}


def test_standalone_installer_must_match_distributed_implementation(kit):
    name='bootstrap.py'
    (kit/name).write_text('# stale installer\n')
    manifest=json.loads((kit/'toolkit-manifest.json').read_bytes())
    manifest['files'][name]=b.sha((kit/name).read_bytes())
    (kit/'toolkit-manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(b.KitError,match='standalone_installer_version_mismatch'):
        b.validate(kit)


def test_failed_portable_verification_retains_evidence_and_can_retry_same_output(tmp_path,monkeypatch):
    archive=tmp_path/'toolkit.zip'
    def failed(argv,**options):
        options['stdout'].write(b'synthetic test failure\n')
        return subprocess.CompletedProcess(argv,1)
    monkeypatch.setattr(d.subprocess,'run',failed)
    with pytest.raises(m.ReleaseError,match='portable_toolkit_tests_failed:'):
        d.bundle(ROOT,archive,verify_tests=True)
    assert not archive.exists()
    first=list(tmp_path.glob('toolkit.zip.verify-*'))[0]
    def passed(argv,**options):
        junit=Path(next(arg.split('=',1)[1] for arg in argv if arg.startswith('--junitxml=')))
        junit.write_text('<testsuites><testsuite tests="1" failures="0" errors="0" skipped="0"/></testsuites>')
        return subprocess.CompletedProcess(argv,0)
    monkeypatch.setattr(d.subprocess,'run',passed)
    result=d.bundle(ROOT,archive,verify_tests=True)
    assert archive.is_file() and result['self_tests'] == 'passed'
    assert Path(result['verification_evidence']) != first
    assert (first/'tests.log').read_text() == 'synthetic test failure\n'


def test_local_release_owner_instructions_require_review_before_update(kit,destination):
    b.install(kit,destination)
    policy=destination/'AGENTS.md'
    customized=policy.read_text().replace('## 版本发布由版本开发者完成','## 本分支已有发布要求')
    policy.write_text(customized)
    with pytest.raises(b.KitError,match='developer_merge_required:AGENTS.md'):
        b.install(kit,destination)
    assert policy.read_text() == customized
    result=b.install(kit,destination,update_tools=True)
    assert '## 版本发布由版本开发者完成' in policy.read_text()
    assert (Path(result['backup_directory'])/'AGENTS.md').read_text() == customized
    assert '# Existing branch instructions' in policy.read_text()
