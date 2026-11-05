"""Standalone toolkit verifier/installer. Exported as bootstrap.py in every kit.

Uses only the Python standard library; works before GeoGi tooling is installed.
Never executes an adapter, touches a live runtime, or changes Git history.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile

CORE_FILES = (
    'Makefile', 'AGENTS.md', 'DEVELOPER_TASK.md', 'README_TOOLKIT.md', 'bootstrap.py',
    'tools/__init__.py', 'tools/live/geogi_release.py',
    'tools/releasing/__init__.py', 'tools/releasing/manager.py',
    'tools/releasing/onboarding.py', 'tools/releasing/adapter.py',
    'tools/releasing/sdk.py', 'tools/releasing/bootstrap.py', 'tools/releasing/distribution.py',
    'tools/ci/geogi_release_gate.py', 'tools/ci/requirements-release-test.txt',
    'tools/releasing/requirements-tests.txt',
    'tests/__init__.py', 'tests/business/__init__.py',
    'tests/business/test_geogi_unified_release.py',
    'tests/business/test_geogi_release_onboarding.py',
    'tests/business/test_geogi_release_distribution.py',
    'docs/development/GEOGI_RELEASE_HANDOFF.md',
    'docs/engineering/geogi-unified-release.md', 'deploy/releases/README.md',
)
STARTERS = ('dev3-admin', 'dev3-worker', 'report')
REQUIRED_FILES = CORE_FILES + tuple('deploy/releases/' + module + '/' + name
                                   for module in STARTERS for name in ('release.json', 'adapter.py'))
RELEASE_TARGET = '''# BEGIN GEOGI RELEASE TOOL
.PHONY: release
release:
\t$(or $(PYTHON_BIN),python3.12) -m tools.live.geogi_release $(ARGS)
# END GEOGI RELEASE TOOL
'''
OWNER_BEGIN = '<!-- BEGIN GEOGI RELEASE OWNER -->'
OWNER_END = '<!-- END GEOGI RELEASE OWNER -->'


class KitError(RuntimeError):
    pass


def need(ok, message):
    if not ok:
        raise KitError(message)


def safe_path(root, name):
    need(isinstance(name, str) and name and '\\' not in name and '\0' not in name, 'unsafe_package_path')
    need(PurePosixPath(name).as_posix() == name and name != '.', 'unsafe_package_path')
    parts = PurePosixPath(name).parts
    need(not name.startswith('/') and '..' not in parts and '.' not in parts, 'unsafe_package_path')
    target = root.joinpath(*parts)
    need(all(not root.joinpath(*parts[:i]).is_symlink() for i in range(1, len(parts) + 1)),
         'symlink_in_package_path')
    need(target.resolve().is_relative_to(root.resolve()), 'package_path_outside_root')
    return target


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'duplicate_manifest_key')
        result[key] = value
    return result


def validate(package):
    package = package.resolve()
    manifest_path = safe_path(package, 'toolkit-manifest.json')
    manifest = json.loads(manifest_path.read_bytes(), object_pairs_hook=unique)
    need(isinstance(manifest, dict) and type(manifest.get('schema_version')) is int and
         manifest['schema_version'] == 1, 'unsupported_toolkit_manifest')
    files = manifest.get('files')
    need(isinstance(files, dict) and set(REQUIRED_FILES) <= set(files), 'incomplete_toolkit_source')
    for name, expected in files.items():
        target = safe_path(package, name)
        need(name in REQUIRED_FILES or re.fullmatch(r'tools/releasing/[A-Za-z_][A-Za-z0-9_]*\.py', name),
             'unexpected_toolkit_file')
        need(isinstance(expected, str) and re.fullmatch('[0-9a-f]{64}', expected), 'invalid_file_digest')
        need(target.is_file() and sha(target.read_bytes()) == expected, 'toolkit_file_missing_or_changed:' + name)
        if name.endswith('.py'):
            ast.parse(target.read_text(encoding='utf-8'), filename=name)
    need(files['bootstrap.py'] == files['tools/releasing/bootstrap.py'], 'standalone_installer_version_mismatch')
    # Validate the tool/test source closure, not just a list of documents.
    for name in files:
        if not name.endswith('.py'):
            continue
        tree = ast.parse(safe_path(package, name).read_text(encoding='utf-8'))
        for node in ast.walk(tree):
            imports = [alias.name for alias in node.names] if isinstance(node, ast.Import) else (
                [node.module] if isinstance(node, ast.ImportFrom) and not node.level and node.module else [])
            for module in imports:
                if module.startswith(('tools.', 'tests.')):
                    stem = module.replace('.', '/')
                    need(stem + '.py' in files or stem + '/__init__.py' in files,
                         'toolkit_dependency_missing:' + module)
    need('pytest==' in safe_path(package, 'tools/releasing/requirements-tests.txt').read_text(),
         'test_dependencies_missing')
    need('tools.live.geogi_release' in safe_path(package, 'Makefile').read_text(), 'make_release_target_missing')
    owner_section(safe_path(package, 'AGENTS.md').read_text())
    return {'status': 'complete_toolkit', 'files': len(files), 'production_changed': False}


def owner_section(text):
    need(text.count(OWNER_BEGIN) == text.count(OWNER_END) == 1, 'invalid_release_owner_section')
    return text[text.index(OWNER_BEGIN):text.index(OWNER_END) + len(OWNER_END)]


def _atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.geogi-kit-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def install(package, target, *, update_tools=False):
    package, target = package.resolve(), target.resolve()
    validate(package)
    need(target.is_dir() and (target / '.git').exists(), 'existing_git_checkout_required')
    need(not package.is_relative_to(target), 'extract_toolkit_outside_destination_checkout')
    manifest = json.loads((package / 'toolkit-manifest.json').read_bytes())
    changes, kept, conflicts = {}, [], []
    for name in manifest['files']:
        if name in ('bootstrap.py', 'README_TOOLKIT.md', 'DEVELOPER_TASK.md'):
            continue
        incoming = safe_path(package, name).read_bytes()
        dest = safe_path(target, name)
        current = dest.read_bytes() if dest.is_file() else None
        if current == incoming:
            kept.append(name)
            continue
        if name == 'Makefile':
            text = current.decode() if current is not None else ''
            targets = list(re.finditer(r'^([^#\t\n][^:=\n]*):(?!=)[^\n]*(?:\n|$)', text, re.M))
            matches = [item for item in targets if 'release' in item.group(1).split()]
            if matches:
                match = matches[0]
                following = [item.start() for item in targets if item.start() > match.start()]
                block = text[match.end():min(following) if following else len(text)]
                commands = '\n'.join(line for line in block.splitlines() if line.startswith('\t')
                                     and not line.lstrip().startswith('#'))
                if len(matches) == 1 and 'tools.live.geogi_release' in commands:
                    kept.append(name)
                else:
                    conflicts.append(name)
            else:
                changes[name] = (text.rstrip() + '\n\n' + RELEASE_TARGET).encode()
            continue
        if name == 'AGENTS.md':
            text = current.decode() if current is not None else ''
            section = owner_section(incoming.decode())
            if OWNER_BEGIN in text:
                try:
                    existing = owner_section(text)
                    if existing == section:
                        kept.append(name)
                    elif update_tools:
                        changes[name] = text.replace(existing, section).encode()
                    else:
                        conflicts.append(name)
                except KitError:
                    conflicts.append(name)
            else:
                changes[name] = (text.rstrip() + '\n\n' + section + '\n').encode()
            continue
        if current is not None:
            # Owner-written runtime hooks, native gates and package markers are
            # never replaced by a generic distribution kit.
            if name.startswith('deploy/releases/') or name in (
                    'tools/__init__.py', 'tests/__init__.py', 'tests/business/__init__.py',
                    'tools/ci/requirements-release-test.txt'):
                kept.append(name)
            elif name == 'tools/ci/geogi_release_gate.py':
                names = {node.id for node in ast.walk(ast.parse(current)) if isinstance(node, ast.Name)}
                if {'BRANCH', 'GENERATED', 'REPOSITORY'} <= names:
                    kept.append(name)
                else:
                    conflicts.append(name)
            elif not update_tools:
                conflicts.append(name)
            else:
                changes[name] = incoming
        else:
            changes[name] = incoming
    need(not conflicts, 'developer_merge_required:' + ','.join(sorted(conflicts)))
    changes = {name: data for name, data in changes.items()
               if not safe_path(target, name).is_file() or safe_path(target, name).read_bytes() != data}
    originals = {name: safe_path(target, name).read_bytes() if safe_path(target, name).is_file() else None
                 for name in changes}
    backup = Path(tempfile.mkdtemp(prefix='geogi-toolkit-install-'))
    os.chmod(backup, 0o700)
    for name, old in originals.items():
        if old is not None:
            _atomic(safe_path(backup, name), old)
    written = []
    try:
        for name, incoming in changes.items():
            dest = safe_path(target, name)
            # Do not overwrite an edit made after the conflict/backup pass.
            current = dest.read_bytes() if dest.is_file() else None
            need(current == originals[name], 'destination_changed_during_install:' + name)
            _atomic(dest, incoming)
            written.append(name)
    except BaseException:
        for name in reversed(written):
            old = originals[name]
            if old is None:
                safe_path(target, name).unlink()
            else:
                _atomic(safe_path(target, name), old)
        raise
    result = {'status': 'installed', 'written': sorted(written), 'preserved': sorted(kept),
              'backup_directory': str(backup), 'production_changed': False,
              'next': 'Read docs/development/GEOGI_RELEASE_HANDOFF.md; implement native hooks, then doctor/prepare/publish.'}
    _atomic(backup / 'installation.json', (json.dumps(result, indent=2) + '\n').encode())
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('check', 'install'))
    parser.add_argument('--package', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--target', type=Path)
    parser.add_argument('--update-tools', action='store_true', help='Developer-reviewed common-tool update; keeps native adapters and gates')
    args = parser.parse_args(argv)
    try:
        need(args.action != 'install' or args.target is not None, 'install_target_required')
        result = validate(args.package) if args.action == 'check' else install(
            args.package, args.target, update_tools=args.update_tools)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except (KitError, OSError, ValueError, SyntaxError, TypeError) as error:
        print(json.dumps({'status': 'blocked', 'owner': 'version_developer',
                          'reason': str(error) if isinstance(error, KitError) else type(error).__name__,
                          'next': 'Developer validates/imports the complete toolkit; do not ask the user to relay source files, commits or credentials.'}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
