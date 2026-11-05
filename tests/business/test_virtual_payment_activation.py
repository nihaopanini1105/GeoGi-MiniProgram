"""Recovery, fencing and secret preservation for production readiness activation."""
import importlib.util
import json
from pathlib import Path
import stat
import pytest

MODULE = Path(__file__).resolve().parents[2]/'deploy/releases/wechat-virtual-payment-enable/native.py'
spec = importlib.util.spec_from_file_location('vpay_activation', MODULE)
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

@pytest.fixture
def activation(tmp_path):
    (tmp_path/'shared').mkdir(); (tmp_path/'releases').mkdir()
    deployed = tmp_path/'deployed'; (deployed/'src/services').mkdir(parents=True)
    (deployed/'src/services/payment.js').write_bytes(b'unchanged production service')
    (deployed/'src/server.js').write_text("require('./services/wechat-virtual-payment-router').createRouter();\nrequire('./services/wechat-virtual-payment').startReconciler();")
    (tmp_path/'server').symlink_to(deployed)
    config = {'appId':'wx1ac5bdb2d5bff31f', 'offerId':'1450709233',
        'productId':'geogi_diag_199', 'iosRefundPolicy':'reject_all',
        'attemptRoot':'/opt/geogi-mini-program/shared/virtual-payment-attempts',
        'productionAppKey':'A'*32, 'sandboxAppKey':'B'*32,
        'enabled':False, 'goodsPublished':False, 'iosEnabled':False,
        'futureSetting':{'preserve':True}}
    raw = (json.dumps(config, indent=2)+'\n').encode()
    native.atomic_write(tmp_path/'shared/wechat-virtual-payment.json', raw)
    controller = native.Activation(tmp_path, 'a'*40, 'run-test',
        {'src/services/payment.js':native.digest(b'unchanged production service')})
    return controller, raw

def staged(controller):
    for phase in ('check','backup','stage','before_switch'):
        assert controller.phase(phase)['verified']

def test_activation_preserves_secrets_and_exact_rollback(activation):
    c, original = activation; staged(c)
    assert c.config.read_bytes() == original  # staging has no live effects
    assert c.phase('switch')['verified']; assert c.phase('verify')['verified']
    before, after = json.loads(original), json.loads(c.config.read_bytes())
    for key in native.FLAGS:
        assert after.pop(key) is True; before.pop(key)
    assert after == before
    assert stat.S_IMODE(c.config.stat().st_mode) == 0o600
    for phase in ('before_rollback','rollback','rollback','verify_rollback'):
        assert c.phase(phase)['verified']
    assert c.config.read_bytes() == original

def test_concurrent_configuration_change_blocks_switch_and_rollback(activation):
    c, _ = activation; staged(c)
    changed = json.loads(c.config.read_bytes()); changed['futureSetting'] = 'newer owner change'
    native.atomic_write(c.config, json.dumps(changed).encode())
    for phase in ('switch','before_rollback','rollback'):
        with pytest.raises(AssertionError): c.phase(phase)
    assert json.loads(c.config.read_bytes())['futureSetting'] == 'newer owner change'

def test_later_deployment_blocks_restore(activation):
    c, _ = activation; staged(c); c.phase('switch')
    (c.live/'src/server.js').write_text('new production version')
    with pytest.raises(AssertionError): c.phase('rollback')
    assert json.loads(c.config.read_bytes())['enabled'] is True

def test_tampered_candidate_is_not_published(activation):
    c, original = activation; staged(c)
    native.atomic_write(c.folder/'candidate.private.json', b'{}')
    with pytest.raises(AssertionError): c.phase('switch')
    assert c.config.read_bytes() == original

@pytest.mark.parametrize('kind', ['symlink','world_readable','wrong_product','already_enabled'])
def test_untrusted_or_changed_configuration_rejected(activation, kind):
    c, original = activation
    if kind == 'symlink':
        private = c.config.with_name('elsewhere.json'); c.config.rename(private); c.config.symlink_to(private)
    elif kind == 'world_readable': c.config.chmod(0o644)
    else:
        config = json.loads(original)
        config['productId' if kind == 'wrong_product' else 'enabled'] = 'other' if kind == 'wrong_product' else True
        native.atomic_write(c.config, json.dumps(config).encode())
    with pytest.raises(AssertionError): c.phase('check')
