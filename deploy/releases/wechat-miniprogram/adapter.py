"""GeoGi API overlay native release hooks, using the existing production symlink layout."""
import json
from pathlib import Path
import shlex
import subprocess
from tools.releasing.sdk import ReleaseAdapter

class Adapter(ReleaseAdapter):
    def execute(self, context):
        assert context.target == 'geogi-prod-miniprogram-api'
        assert context.resource == 'wechat-miniprogram'
        root=Path(__file__).resolve().parents[3]
        if context.phase=='stage':
            subprocess.run(['scp',str(root/'server/src/services/research.js'),
                            'geogi-prod:/tmp/geogi-research-'+context.source_sha+'.js'],check=True,capture_output=True)
        command='python3 - '+shlex.quote(context.phase)+' '+shlex.quote(context.source_sha)
        result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','geogi-prod',command],
                              input=(Path(__file__).with_name('native.py')).read_text(),capture_output=True,text=True,check=True,timeout=800)
        receipt=json.loads(result.stdout)
        if context.phase=='stage':
            import hashlib
            assert receipt['research_sha256']==hashlib.sha256((root/'server/src/services/research.js').read_bytes()).hexdigest()
        context.write_json('native-'+context.phase+'.json',receipt)
        return receipt

    def check(self, context): return self.execute(context)
    def backup(self, context): return self.execute(context)
    def stage(self, context): return self.execute(context)
    def before_switch(self, context): return self.execute(context)
    def switch(self, context): return self.execute(context)
    def verify(self, context): return self.execute(context)
    def before_rollback(self, context): return self.execute(context)
    def rollback(self, context): return self.execute(context)
    def verify_rollback(self, context): return self.execute(context)
