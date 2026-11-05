"""Remote atomic overlay using the existing /opt/geogi-mini-program/server symlink.
Only the push module and its exact server mount are changed; original report modules remain intact.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

phase, sha = sys.argv[1:3]
root = Path('/opt/geogi-mini-program')
live = root/'server'
folder = root/'releases'/('vpay-'+sha)
receipt = folder/'release.json'
node = '/root/.nvm/versions/node/v24.19.0/bin/node'
env = dict(os.environ, PATH=str(Path(node).parent)+':'+os.environ['PATH'])
lock = open(root/'.software-release.lock','a')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)

def run(argv, cwd=None):
    return subprocess.run(argv,cwd=cwd,env=env,check=True,capture_output=True,text=True).stdout.strip()

def health():
    for attempt in range(30):
        try:
            data=json.load(urllib.request.urlopen('http://127.0.0.1:3107/health',timeout=5))
            assert data['ok'] and data['businessAuthority']=='GeoGi OS' and data['osOperationsBridge']=='configured'
            return data
        except Exception:
            time.sleep(1)
    raise RuntimeError('health_not_ready')

def hashes(server):
    return {str(p.relative_to(server)):hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((server/'src').rglob('*')) if p.is_file() and p.relative_to(server).as_posix() not in {'src/services/wechat-virtual-payment.js', 'src/server.js', 'src/services/payment-service.js', 'src/services/payment-store.js', 'src/scripts/configure-wechat-virtual-payment.js', 'src/services/wechat-message-push.js', 'src/services/wechat-virtual-payment-router.js'}}

def load():
    return json.loads(receipt.read_text())

def save(data):
    receipt.write_text(json.dumps(data,sort_keys=True)); receipt.chmod(0o600)

def baseline(data):
    assert str(live.resolve())==data['baseline'], 'live_baseline_changed'
    assert hashes(live)==data['protected'], 'protected_source_changed'
    assert hashlib.sha256((live/'src/server.js').read_bytes()).hexdigest()==data['baseline_server_sha256']
    assert run(['systemctl','is-active','geogi-api'])=='active'

def swap(target):
    temp=root/('.server-'+sha)
    if temp.is_symlink(): temp.unlink()
    temp.symlink_to(target)
    os.replace(temp,live)
    run(['systemctl','restart','geogi-api'])
    health()

if phase=='check':
    assert live.is_symlink() and live.resolve().is_dir()
    assert not folder.exists(), 'release_target_exists'
    run(['systemctl','is-active','geogi-api'])
    health()
    print(json.dumps({'verified':True,'baseline':str(live.resolve()),'protected':hashes(live)}))
elif phase=='backup':
    assert not folder.exists()
    folder.mkdir(mode=0o700)
    data={'sha':sha,'baseline':str(live.resolve()),'protected':hashes(live),'baseline_server_sha256':hashlib.sha256((live/'src/server.js').read_bytes()).hexdigest()}
    # The previous immutable release stays in place as the verified rollback artifact.
    assert (live/'package-lock.json').is_file() and (live/'node_modules').is_dir()
    save(data)
    print(json.dumps({'verified':True,'baseline':data['baseline'],'backup':str(receipt)}))
elif phase=='stage':
    data=load(); baseline(data)
    candidate=folder/'server'
    assert not candidate.exists()
    shutil.copytree(live.resolve(),candidate,symlinks=True)
    incoming=Path('/tmp/geogi-vpay-'+sha)
    expected_baseline = {
        'src/services/payment-store.js':'bb073a52847bec8ac0ec95b54fe165e9e840a661459358788e0aee45528aaf67',
        'src/services/payment-service.js':'7b0427c9508cd218c2f0a252070e9d8dc1b045c3881d4fa2c823b0ceee5d3c19',
        'src/services/wechat-message-push.js':'d4b410428d7669f5c78768636ebcbba9296c67d3c5d7e3ee17f336fe642ba664'
    }
    for relative, expected in expected_baseline.items():
        assert hashlib.sha256((candidate/relative).read_bytes()).hexdigest()==expected, 'production_source_diverged'
    changed = ['src/services/wechat-virtual-payment.js', 'src/services/wechat-virtual-payment-router.js', 'src/services/wechat-message-push.js', 'src/services/payment-store.js', 'src/services/payment-service.js', 'src/scripts/configure-wechat-virtual-payment.js', 'tests/wechat_message_push_regression.js', 'tests/wechat_virtual_payment_regression.js', 'tests/virtual_payment_router_client_regression.js']
    data['artifact_hashes']={}
    for relative in changed:
        target=candidate/relative;target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(incoming/relative,target)
        data['artifact_hashes'][relative]=hashlib.sha256(target.read_bytes()).hexdigest()
    (folder/'utils').mkdir()
    shutil.copyfile(incoming/'virtual-payment-client.js',folder/'utils/virtual-payment.js')
    original=(candidate/'src/server.js').read_text()
    anchor="app.use(require('./services/wechat-message-push').ENDPOINT, require('./services/wechat-message-push').createRouter());"
    assert original.count(anchor)==1 and 'services/wechat-virtual-payment-router' not in original
    patched=original.replace(anchor,anchor+"\napp.use(require('./services/wechat-virtual-payment-router').createRouter());\nrequire('./services/wechat-virtual-payment').startReconciler();")
    (candidate/'src/server.js').write_text(patched)
    data['candidate_server_sha256']=hashlib.sha256(patched.encode()).hexdigest()
    run([node,'--check',str(candidate/'src/server.js')])
    for test in ['wechat_message_push_regression.js','wechat_virtual_payment_regression.js','virtual_payment_router_client_regression.js']:
        run([node,str(candidate/'tests'/test)],candidate)
    assert hashes(candidate)==data['protected']
    assert os.readlink(candidate/'data')==os.readlink(live/'data')
    assert os.readlink(candidate/'uploads')==os.readlink(live/'uploads')
    probe=folder/'rollback-probe'
    probe.symlink_to(candidate); assert probe.resolve()==candidate
    probe.unlink(); probe.symlink_to(data['baseline']); assert str(probe.resolve())==data['baseline']
    probe.unlink()
    data['candidate']=str(candidate); data['stage_verified']=True;save(data)
    print(json.dumps({'verified':True,'candidate':str(candidate),'artifact_hashes':data['artifact_hashes'],'rollback_rehearsal':'passed'}))
elif phase=='before_switch':
    data=load();baseline(data)
    assert data['stage_verified'] and hashes(Path(data['candidate']))==data['protected']
    for relative, expected in data['artifact_hashes'].items():
        assert hashlib.sha256((Path(data['candidate'])/relative).read_bytes()).hexdigest()==expected
    assert hashlib.sha256((Path(data['candidate'])/'src/server.js').read_bytes()).hexdigest()==data['candidate_server_sha256']
    print(json.dumps({'verified':True,'baseline_unchanged':True}))
elif phase=='switch':
    data=load();baseline(data)
    run([node,str(Path(data['candidate'])/'src/scripts/configure-wechat-virtual-payment.js'),'/tmp/geogi-vpay-'+sha+'/appkeys.private.json'])
    swap(data['candidate'])
    print(json.dumps({'verified':True,'live':str(live.resolve())}))
elif phase=='verify':
    data=load();assert str(live.resolve())==data['candidate']
    assert hashes(live)==data['protected']
    health()
    assert hashlib.sha256((live/'src/server.js').read_bytes()).hexdigest()==data['candidate_server_sha256']
    vconfig=json.loads((root/'shared/wechat-virtual-payment.json').read_text())
    assert vconfig['enabled'] is False and vconfig['goodsPublished'] is False and vconfig['iosEnabled'] is False
    assert vconfig['iosRefundPolicy']=='reject_all'
    assert len(vconfig['productionAppKey'])>=16 and len(vconfig['sandboxAppKey'])>=16
    # Verify the public handshake without exposing credentials to logs.
    import urllib.parse
    config=json.loads((root/'shared/wechat-message-push.json').read_text())
    assert config['appId']=='wx1ac5bdb2d5bff31f'
    timestamp=str(int(time.time())); nonce='release-probe'; echo='geogi-push-ready'
    signature=hashlib.sha1(''.join(sorted([config['token'],timestamp,nonce])).encode()).hexdigest()
    query=urllib.parse.urlencode({'timestamp':timestamp,'nonce':nonce,'signature':signature,'echostr':echo})
    for base in ['http://127.0.0.1:3107','https://api.geogi.cn']:
        assert urllib.request.urlopen(base+'/api/wechat/message-push?'+query,timeout=15).read().decode()==echo
        try:
            urllib.request.urlopen(base+'/api/wechat/message-push',timeout=15)
            raise AssertionError('unsigned_push_accepted')
        except urllib.error.HTTPError as error:
            assert error.code==403
    post_probe = """
const fs=require('fs'),crypto=require('crypto');
const c=JSON.parse(fs.readFileSync('/opt/geogi-mini-program/shared/wechat-message-push.json'));
(async()=>{
 const data=Buffer.from(JSON.stringify({MsgType:'event',Event:'debug_demo',Content:'release-verification'}));
 const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
 const frame=Buffer.concat([crypto.randomBytes(16),len,data,Buffer.from(c.appId)]);
 const pad=32-frame.length%32,key=Buffer.from(c.encodingAESKey+'=','base64');
 const cipher=crypto.createCipheriv('aes-256-cbc',key,key.subarray(0,16));cipher.setAutoPadding(false);
 const encrypted=Buffer.concat([cipher.update(Buffer.concat([frame,Buffer.alloc(pad,pad)])),cipher.final()]).toString('base64');
 const timestamp=String(Math.floor(Date.now()/1000)),nonce='release-post-probe';
 const msg_signature=crypto.createHash('sha1').update([c.token,timestamp,nonce,encrypted].sort().join('')).digest('hex');
 const q=new URLSearchParams({timestamp,nonce,msg_signature,encrypt_type:'aes'});
 for(const base of ['http://127.0.0.1:3107','https://api.geogi.cn']){
  const r=await fetch(base+'/api/wechat/message-push?'+q,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({Encrypt:encrypted})});
  if(r.status!==200||await r.text()!=='success')throw Error('encrypted_push_probe_failed');
 }
 console.log('encrypted_push_probe=PASS');
})().catch(()=>{process.exitCode=1});
"""
    run([node,'-e',post_probe])
    for endpoint in ['/api/customer/projects','/api/customer/channel-dashboard']:
        try:
            urllib.request.urlopen('http://127.0.0.1:3107'+endpoint,timeout=10)
            raise AssertionError('unauthenticated_customer_access')
        except urllib.error.HTTPError as error:
            assert error.code==401
    print(json.dumps({'verified':True,'live':str(live.resolve()),'public_challenge_verified':True,'virtual_payment_enabled':False,'protected_sources_unchanged':True,'customer_denials':True}))
elif phase=='before_rollback':
    data=load();assert str(live.resolve()) in (data['baseline'],data.get('candidate'))
    # Acquiring this same remote lock fences an earlier synchronous switch process.
    print(json.dumps({'verified':True,'fenced':True}))
elif phase=='rollback':
    data=load();assert str(live.resolve()) in (data['baseline'],data.get('candidate'))
    if str(live.resolve())!=data['baseline']:swap(data['baseline'])
    print(json.dumps({'verified':True,'live':str(live.resolve())}))
elif phase=='verify_rollback':
    data=load();baseline(data);health()
    assert hashlib.sha256((live/'src/server.js').read_bytes()).hexdigest()==data['baseline_server_sha256']
    print(json.dumps({'verified':True,'baseline_restored':True}))
else:
    raise RuntimeError('unknown_phase')
