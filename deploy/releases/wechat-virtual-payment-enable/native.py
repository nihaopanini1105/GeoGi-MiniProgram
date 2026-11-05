"""Readiness-only activation. Preserve live software, keys and all business data."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import urllib.error
import urllib.request

FLAGS = ('enabled', 'goodsPublished', 'iosEnabled')

def digest(data):
    return hashlib.sha256(data).hexdigest()

def private_read(path):
    mode = path.lstat().st_mode
    assert stat.S_ISREG(mode) and stat.S_IMODE(mode) == 0o600
    return path.read_bytes()

def validate(raw):
    c = json.loads(raw)
    assert c['appId'] == 'wx1ac5bdb2d5bff31f'
    assert c['offerId'] == '1450709233' and c['productId'] == 'geogi_diag_199'
    assert c['iosRefundPolicy'] == 'reject_all'
    assert all(type(c[key]) is bool for key in FLAGS)
    assert all(isinstance(c[key], str) and c[key].isascii() and c[key].isalnum()
               and 16 <= len(c[key]) <= 128 for key in ('productionAppKey', 'sandboxAppKey'))
    assert c['attemptRoot'] == '/opt/geogi-mini-program/shared/virtual-payment-attempts'
    return c

def activate(raw):
    c = validate(raw)
    assert all(c[key] is False for key in FLAGS), 'baseline_readiness_changed'
    c.update({key: True for key in FLAGS})
    return (json.dumps(c, sort_keys=True) + '\n').encode()

def atomic_write(path, raw):
    temp = path.with_name(path.name + '.activation-' + os.urandom(8).hex())
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(raw); out.flush(); os.fsync(out.fileno())
        os.replace(temp, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        if temp.exists(): temp.unlink()

class Activation:
    def __init__(self, root, sha, run_id, manifest):
        assert len(sha) == 40 and all(ch in '0123456789abcdef' for ch in sha)
        assert run_id.startswith('run-') and all(ch.isalnum() or ch in '-_' for ch in run_id)
        assert manifest and all(Path(p).parts[:2] == ('src', 'services') and '..' not in Path(p).parts for p in manifest)
        self.root, self.manifest = root, manifest
        self.live = root/'server'
        self.config = root/'shared/wechat-virtual-payment.json'
        self.folder = root/'releases'/('vpay-enable-'+sha+'-'+run_id)
        self.receipt = self.folder/'activation.json'

    def source(self):
        assert self.live.is_symlink() and self.live.resolve().is_dir()
        for relative, expected in self.manifest.items():
            assert digest((self.live/relative).read_bytes()) == expected, 'deployed_source_changed'
        server = (self.live/'src/server.js').read_text()
        assert "require('./services/wechat-virtual-payment-router').createRouter()" in server
        assert "require('./services/wechat-virtual-payment').startReconciler()" in server
        return {'live': str(self.live.resolve()), 'server_hash': digest(server.encode())}

    def load(self):
        return json.loads(private_read(self.receipt))

    def save(self, data):
        atomic_write(self.receipt, (json.dumps(data, sort_keys=True)+'\n').encode())

    def baseline(self, data):
        assert self.source() == data['source'], 'live_software_changed'
        assert digest(private_read(self.config)) == data['baseline_hash'], 'live_config_changed'

    def phase(self, phase):
        if phase == 'check':
            self.source(); activate(private_read(self.config))
            assert not self.folder.exists()
        elif phase == 'backup':
            source = self.source(); raw = private_read(self.config); activate(raw)
            self.folder.mkdir(mode=0o700)
            atomic_write(self.folder/'baseline.private.json', raw)
            self.save({'source': source, 'baseline_hash': digest(raw)})
        elif phase == 'stage':
            data = self.load(); self.baseline(data)
            raw = private_read(self.folder/'baseline.private.json')
            assert digest(raw) == data['baseline_hash']
            candidate = activate(raw)
            atomic_write(self.folder/'candidate.private.json', candidate)
            probe = self.folder/'recovery-probe.private.json'
            atomic_write(probe, candidate); assert private_read(probe) == candidate
            atomic_write(probe, raw); assert private_read(probe) == raw
            probe.unlink()
            data['candidate_hash'] = digest(candidate); self.save(data)
        elif phase in ('before_switch', 'switch'):
            data = self.load(); self.baseline(data)
            candidate = private_read(self.folder/'candidate.private.json')
            assert digest(candidate) == data['candidate_hash']
            assert candidate == activate(private_read(self.folder/'baseline.private.json'))
            if phase == 'switch': atomic_write(self.config, candidate)
        elif phase == 'verify':
            data = self.load()
            assert self.source() == data['source']
            assert digest(private_read(self.config)) == data['candidate_hash']
            assert all(validate(private_read(self.config))[key] is True for key in FLAGS)
        elif phase in ('before_rollback', 'rollback', 'verify_rollback'):
            data = self.load(); assert self.source() == data['source'], 'later_software_release'
            current = digest(private_read(self.config))
            assert current in (data['baseline_hash'], data.get('candidate_hash')), 'later_config_change'
            baseline = private_read(self.folder/'baseline.private.json')
            assert digest(baseline) == data['baseline_hash']
            if phase == 'rollback' and current != data['baseline_hash']:
                atomic_write(self.config, baseline)
            if phase == 'verify_rollback': self.baseline(data)
        else:
            raise ValueError('unknown_phase')
        return {'verified': True, 'phase': phase, 'software_unchanged': True,
                'virtual_payment_enabled': phase == 'verify'}

def runtime_probe(root):
    node = '/root/.nvm/versions/node/v24.19.0/bin/node'
    code = "require('dotenv').config();const c=require('./src/services/wechat-virtual-payment').loadConfig();if(!['enabled','goodsPublished','iosEnabled'].every(k=>c[k]===true))process.exit(2)"
    subprocess.run([node, '-e', code], cwd=root/'server', capture_output=True, check=True)

def network_probe():
    subprocess.run(['systemctl', 'is-active', '--quiet', 'geogi-api'], check=True, capture_output=True)
    for base in ('http://127.0.0.1:3107', 'https://api.geogi.cn'):
        with urllib.request.urlopen(base+'/health', timeout=10) as r:
            data = json.load(r); assert data['ok'] and data['businessAuthority'] == 'GeoGi OS'
        for endpoint, expected in (('/api/customer/projects', 401), ('/api/wechat/message-push', 403)):
            try:
                urllib.request.urlopen(base+endpoint, timeout=10)
            except urllib.error.HTTPError as e:
                assert e.code == expected
            else:
                raise AssertionError('unauthenticated_request_allowed')

def main():
    phase, sha, run_id, manifest = sys.argv[1:5]
    root = Path('/opt/geogi-mini-program')
    with (root/'.software-release.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if phase in ('check', 'before_switch'): network_probe()
        result = Activation(root, sha, run_id, json.loads(manifest)).phase(phase)
        if phase == 'verify': runtime_probe(root); network_probe()
        if phase == 'verify_rollback': network_probe()
        print(json.dumps(result))

if __name__ == '__main__':
    try: main()
    except Exception:
        print(json.dumps({'native_failure': True}), file=sys.stderr)
        sys.exit(2)
