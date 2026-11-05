"""Complete, portable developer delivery; no runtime secrets or release history."""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

from tools.releasing.bootstrap import (CORE_FILES, REQUIRED_FILES, safe_path, sha,
                                       validate)
from tools.releasing.manager import outside_source, require
from tools.releasing.onboarding import adapter_source

DEVELOPER_TASK = '''# 开发者直接执行的发布接入任务

你负责当前版本的统一发布接入与交付。先运行本包 bootstrap.py check，再运行
bootstrap.py install --target 你的现有 GeoGi 仓库；已有公共工具更新可在审查差异后
加 --update-tools。安装器不会覆盖已有模块原生适配器、原生门禁或其他 Makefile 目标。
工具齐全后读取 docs/development/GEOGI_RELEASE_HANDOFF.md，选择真实模块范围，
自行完成九个原生动作，运行 doctor、正式测试门禁、prepare，并按现有明确授权 publish。
工具会读取当前提交，生成计划、完整开发工具包和恢复记录。
不要再要求用户查找分支、PR、SHA、单独补传工具源码或拼装命令；这些由版本开发者处理。
只在缺少真实业务决策、权限或生产授权时说明具体缺项。不创建授权、不发送新平台问题。
'''
README = '''# GeoGi 完整发布工具包

本包同时包含工具源码、Handoff、工程说明、模板、专项测试、测试依赖、完整性清单和
无需预装 GeoGi 模块的独立 bootstrap.py。应直接把本包交给版本开发者；用户无需补文件。
Python 3.12 + Git + macOS/Linux。工具运行本身仅使用 Python 标准库。

在开发环境解压到现有仓库以外的目录，开发者依次执行：

    python3.12 bootstrap.py check
    python3.12 bootstrap.py install --target /实际/GeoGi仓库

如公共工具与目标仓库已有版本不同，开发者审查差异后可加 --update-tools。
安装器会保留原生门禁、已实现的模块适配器与现有 Makefile 其他目标；现有公共工具
更新有私有备份。冲突由开发者合并；安装失败恢复已写文件，不修改 Git 历史或生产。

专项依赖见 tools/releasing/requirements-tests.txt。包内源码可独立运行三个 release
专项测试文件。正式 PG16/Chromium 全仓门禁仍使用实际应用仓库已有执行器。
完整性摘要检测文件缺失/意外改动，不是第三方签名或生产授权。

安装后遵循 DEVELOPER_TASK.md 和 docs/development/GEOGI_RELEASE_HANDOFF.md。
模板故意不默认成功；原生动作未完成时 doctor/prepare 会阻止发布。
'''
TEST_FILES = ('tests/business/test_geogi_unified_release.py',
              'tests/business/test_geogi_release_onboarding.py',
              'tests/business/test_geogi_release_distribution.py')


def isolated_test_environment(source):
    # Distribution is usable alongside an older native gate exposing only the
    # three source-policy constants used by the release manager. Do not replace
    # that gate merely to obtain a test-runner helper.
    blocked = {'DATABASE_URL', 'POSTGRES_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD',
               'PGDATABASE', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'GEOGI_OPS_TOKENS_JSON',
               'GEOGI_MINIPROGRAM_BRIDGE_URL'}
    return {key: value for key, value in source.items() if key not in blocked and
            not key.endswith(('_DSN', '_API_KEY', '_SECRET', '_PASSWORD', '_TOKEN'))}


def payload(root):
    root = root.resolve()
    data = {}
    generated = {'bootstrap.py', 'README_TOOLKIT.md', 'DEVELOPER_TASK.md'}
    for name in CORE_FILES:
        if name in generated:
            continue
        path = safe_path(root, name)
        require(path.is_file(), 'toolkit_source_missing:' + name)
        data[name] = path.read_bytes()
    # Include every common implementation file so adding a module cannot create
    # a docs-only or missing-import distribution on the next handoff.
    for path in sorted((root / 'tools/releasing').glob('*.py')):
        require(not path.is_symlink(), 'toolkit_symlink_not_allowed')
        data[str(path.relative_to(root))] = path.read_bytes()
    for module, profile, runtime, resource in (
            ('dev3-admin', 'dev3', 'admin', 'geogi-admin'),
            ('dev3-worker', 'dev3', 'worker', 'capture-worker'),
            ('report', 'report', 'admin', 'geogi-admin')):
        base = 'deploy/releases/' + module + '/'
        # Generic distribution never exports a feature owner's live adapter or
        # credentials. Fresh starters are generated from the shared contract.
        data[base + 'adapter.py'] = adapter_source(module).encode()
        spec = {'schema_version': 1, 'profile': profile, 'module': module, 'runtime': runtime,
                'resource': resource, 'scope': 'software_deployment',
                'adapter': base + 'adapter.py', 'timeout_seconds': 900}
        data[base + 'release.json'] = (json.dumps(spec, sort_keys=True, indent=2) + '\n').encode()
    data['bootstrap.py'] = data['tools/releasing/bootstrap.py']
    data['README_TOOLKIT.md'] = README.encode()
    data['DEVELOPER_TASK.md'] = DEVELOPER_TASK.encode()
    require(set(REQUIRED_FILES) <= set(data), 'incomplete_toolkit_source')
    manifest = {'schema_version': 1, 'kind': 'geogi-developer-release-toolkit',
                'files': {name: sha(content) for name, content in sorted(data.items())},
                'production_changed': False}
    data['toolkit-manifest.json'] = (json.dumps(manifest, sort_keys=True, indent=2) + '\n').encode()
    return data


def unpack(archive, destination):
    """Verified private extraction used by checks and isolated artifact tests."""
    with zipfile.ZipFile(io.BytesIO(archive)) as stream:
        require(len(stream.namelist()) == len(set(stream.namelist())), 'duplicate_toolkit_archive_path')
        for item in stream.infolist():
            require(not item.is_dir() and stat.S_IFMT(item.external_attr >> 16) in (0, stat.S_IFREG),
                    'non_regular_toolkit_archive_entry')
            target = safe_path(destination, item.filename)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(stream.read(item))
    return validate(destination)


def bundle(root, output, *, verify_tests=False):
    root, output = root.resolve(), output.absolute()
    outside_source(output.resolve(), root)
    require(not output.exists() and not output.is_symlink(), 'toolkit_output_already_exists')
    data = payload(root)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(data.items()):
            item = zipfile.ZipInfo(name)
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(item, content)
    binary = buffer.getvalue()
    test_status = 'not_run'
    verification_evidence = None
    test_results = None
    with tempfile.TemporaryDirectory(prefix='geogi-kit-check-') as temporary:
        extracted = Path(temporary)
        checked = unpack(binary, extracted)
        if verify_tests:
            output.parent.mkdir(parents=True, exist_ok=True)
            evidence = Path(tempfile.mkdtemp(prefix=output.name + '.verify-', dir=output.parent))
            verification_evidence = str(evidence)
            log_path = evidence / 'tests.log'
            junit = evidence / 'tests.xml'
            env = dict(isolated_test_environment(os.environ), PYTHONPATH=str(extracted),
                       PYTHONDONTWRITEBYTECODE='1', PYTEST_DISABLE_PLUGIN_AUTOLOAD='1', PYTEST_ADDOPTS='')
            env.pop('PYTEST_PLUGINS', None)
            with log_path.open('xb') as log:
                os.chmod(log_path, 0o600)
                proc = subprocess.run([sys.executable, '-m', 'pytest', *TEST_FILES, '-q', '--tb=short',
                                       '-p', 'no:cacheprovider', '--junitxml=' + str(junit)],
                                      cwd=extracted, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=180)
            require(proc.returncode == 0, 'portable_toolkit_tests_failed:' + str(evidence))
            require(junit.is_file(), 'portable_toolkit_junit_missing:' + str(evidence))
            suites = list(ET.parse(junit).getroot().iter('testsuite'))
            result = {key: sum(int(suite.get(key, 0)) for suite in suites)
                      for key in ('tests', 'failures', 'errors', 'skipped')}
            require(result['tests'] > 0 and all(result[key] == 0 for key in ('failures', 'errors', 'skipped')),
                    'portable_toolkit_tests_not_all_passed')
            test_status = 'passed'
            test_results = result
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as stream:
        os.chmod(output, 0o600)
        stream.write(binary)
    return {'status': 'complete_toolkit', 'archive': str(output), 'files': checked['files'],
            'self_tests': test_status, 'verification_evidence': verification_evidence,
            'test_results': test_results, 'production_changed': False,
            'developer_entrypoint': 'Extract outside checkout; python3.12 bootstrap.py check; python3.12 bootstrap.py install --target CHECKOUT',
            'owner': 'version_developer', 'user_source_relay_required': False}
