"""Remote atomic overlay using the existing /opt/geogi-mini-program/server symlink.
Only research.js and its dependency are changed; shared customer data is untouched.
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
folder = root/'releases'/('ux-'+sha)
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
            for p in sorted((server/'src').rglob('*')) if p.is_file() and p.relative_to(server).as_posix()!='src/services/research.js'}

def load():
    return json.loads(receipt.read_text())

def save(data):
    receipt.write_text(json.dumps(data,sort_keys=True)); receipt.chmod(0o600)

def baseline(data):
    assert str(live.resolve())==data['baseline'], 'live_baseline_changed'
    assert hashes(live)==data['protected'], 'protected_source_changed'
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
    data={'sha':sha,'baseline':str(live.resolve()),'protected':hashes(live),'baseline_research_sha256':hashlib.sha256((live/'src/services/research.js').read_bytes()).hexdigest()}
    # The previous immutable release stays in place as the verified rollback artifact.
    assert (live/'package-lock.json').is_file() and (live/'node_modules').is_dir()
    save(data)
    print(json.dumps({'verified':True,'baseline':data['baseline'],'backup':str(receipt)}))
elif phase=='stage':
    data=load(); baseline(data)
    candidate=folder/'server'
    assert not candidate.exists()
    shutil.copytree(live.resolve(),candidate,symlinks=True)
    incoming=Path('/tmp/geogi-research-'+sha+'.js')
    shutil.copyfile(incoming,candidate/'src/services/research.js')
    data['research_sha256']=hashlib.sha256(incoming.read_bytes()).hexdigest()
    # Preserve the production lockfile and all existing code; add the pure-JS dependency.
    run(['npm','install','--save-exact','sanitize-html@2.17.0','--ignore-scripts','--omit=dev','--no-audit','--no-fund'],candidate)
    run([node,'--check',str(candidate/'src/services/research.js')])
    assert hashes(candidate)==data['protected']
    assert os.readlink(candidate/'data')==os.readlink(live/'data')
    assert os.readlink(candidate/'uploads')==os.readlink(live/'uploads')
    test="const assert=require('assert');const r=require('./src/services/research');(async()=>{const x=await r.getResearchArticle('2026-china-brand-ai-visibility-report');assert(x.ok&&x.article.body.length>1000);assert(!(await r.getResearchArticle('../private')).ok);console.log('staged_research_real_content=PASS');})().catch(e=>{console.error(e);process.exit(1)});"
    run([node,'-e',test],candidate)
    probe=folder/'rollback-probe'
    probe.symlink_to(candidate); assert probe.resolve()==candidate
    probe.unlink(); probe.symlink_to(data['baseline']); assert str(probe.resolve())==data['baseline']
    probe.unlink()
    data['candidate']=str(candidate); data['stage_verified']=True;save(data)
    print(json.dumps({'verified':True,'candidate':str(candidate),'research_sha256':data['research_sha256'],'rollback_rehearsal':'passed'}))
elif phase=='before_switch':
    data=load();baseline(data)
    assert data['stage_verified'] and hashes(Path(data['candidate']))==data['protected']
    assert hashlib.sha256((Path(data['candidate'])/'src/services/research.js').read_bytes()).hexdigest()==data['research_sha256']
    print(json.dumps({'verified':True,'baseline_unchanged':True}))
elif phase=='switch':
    data=load();baseline(data)
    swap(data['candidate'])
    print(json.dumps({'verified':True,'live':str(live.resolve())}))
elif phase=='verify':
    data=load();assert str(live.resolve())==data['candidate']
    assert hashes(live)==data['protected']
    health()
    article=json.load(urllib.request.urlopen('http://127.0.0.1:3107/api/articles/2026-china-brand-ai-visibility-report',timeout=45))
    assert article['ok'] and len(article['article']['body'])>1000
    for endpoint in ['/api/customer/projects','/api/customer/channel-dashboard']:
        try:
            urllib.request.urlopen('http://127.0.0.1:3107'+endpoint,timeout=10)
            raise AssertionError('unauthenticated_customer_access')
        except urllib.error.HTTPError as error:
            assert error.code==401
    print(json.dumps({'verified':True,'live':str(live.resolve()),'body_length':len(article['article']['body']),'protected_sources_unchanged':True,'customer_denials':True}))
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
    assert hashlib.sha256((live/'src/services/research.js').read_bytes()).hexdigest()==data['baseline_research_sha256']
    print(json.dumps({'verified':True,'baseline_restored':True}))
else:
    raise RuntimeError('unknown_phase')
