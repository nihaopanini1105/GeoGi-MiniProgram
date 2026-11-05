"""Exact-main MiniProgram gate. No PostgreSQL component exists in this repository."""
from pathlib import Path
import argparse
import json
import os
import subprocess
import sys
import xml.etree.ElementTree as ET

BRANCH = 'main'
REPOSITORY = 'nihaopanini1105/GeoGi-MiniProgram'
GENERATED = set()
REQUIRED_STAGE_NAMES = ('mini_syntax', 'business', 'release_tools')

def main():
    from tools.releasing import manager as m
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    identity = m.source_identity(root, args.expected_sha)
    m.require(identity['branch'] == BRANCH, 'merged_main_required')
    m.require(m.git(root, 'rev-parse', 'origin/main').decode().strip() == args.expected_sha, 'current_main_required')
    out = args.evidence_dir.resolve()
    m.outside_source(out, root)
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    env = {k:v for k,v in os.environ.items() if not k.endswith(('_TOKEN', '_SECRET', '_PASSWORD', '_DSN', '_API_KEY')) and k not in ('DATABASE_URL','POSTGRES_URL')}
    stages = []
    files = list((root/'pages').rglob('*.js')) + list((root/'utils').glob('*.js')) + list((root/'server/src').rglob('*.js'))
    with (out/'syntax.log').open('w') as log:
        for path in files:
            subprocess.run(['node','--check',str(path)], cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
    stages.append({'name':'mini_syntax','exit_code':0,'results':{'tests':len(files),'failures':0,'errors':0,'skipped':0}})
    with (out/'business.log').open('w') as log:
        subprocess.run(['npm','test'],cwd=root/'server',env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
    # Every npm script in this sequential suite must have completed.
    scripts = json.loads((root/'server/package.json').read_text())['scripts']['test'].split(' && ')
    stages.append({'name':'business','exit_code':0,'results':{'tests':len(scripts),'failures':0,'errors':0,'skipped':0}})
    with (out/'release-tools.log').open('w') as log:
        subprocess.run([sys.executable,'-m','pytest','tests/business','-q','--junitxml='+str(out/'release-tools.xml')],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
    suites = list(ET.parse(out/'release-tools.xml').getroot().iter('testsuite'))
    counts = {k:sum(int(s.get(k,0)) for s in suites) for k in ('tests','failures','errors','skipped')}
    m.require(counts['tests'] > 0 and not any(counts[k] for k in ('failures','errors','skipped')), 'release_tests_incomplete')
    stages.append({'name':'release_tools','exit_code':0,'results':counts})
    m.require(m.source_identity(root,args.expected_sha) == identity, 'source_changed_during_gate')
    summary = {'status':'automation_passed','repository':REPOSITORY,'branch':BRANCH,'head_sha':args.expected_sha,'expected_sha':args.expected_sha,'git_tree':identity['tree'],'source_sha256':identity['fingerprint'],'final_source_sha256':identity['fingerprint'],'stages':stages,'production_changed':False,'evidence_files':{p.name:m.file_hash(p) for p in out.iterdir() if p.is_file()}}
    m.save(out/'summary.json',summary,exclusive=True)
    print(json.dumps({'status':'automation_passed','summary':str(out/'summary.json')}))

if __name__ == '__main__':
    main()
