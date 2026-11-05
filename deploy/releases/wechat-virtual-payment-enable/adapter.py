"""Activate the deployed virtual-payment implementation through shared release fencing."""
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
from tools.releasing.sdk import ReleaseAdapter

FILES = ('wechat-virtual-payment.js', 'wechat-virtual-payment-router.js',
         'wechat-message-push.js', 'payment-service.js', 'payment-store.js')

class Adapter(ReleaseAdapter):
    def execute(self, context):
        assert context.target == 'geogi-prod-miniprogram-api'
        assert context.resource == 'wechat-miniprogram'
        root = Path(__file__).resolve().parents[3]
        manifest = {'src/services/'+name: hashlib.sha256(
            (root/'server/src/services'/name).read_bytes()).hexdigest() for name in FILES}
        command = 'python3 - ' + ' '.join(shlex.quote(value) for value in (
            context.phase, context.source_sha, context.run_directory.name,
            json.dumps(manifest, separators=(',', ':'))))
        result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                                 'geogi-prod', command],
            input=Path(__file__).with_name('native.py').read_text(), capture_output=True,
            text=True, timeout=180, check=False)
        if result.returncode:
            raise RuntimeError('virtual_payment_activation_' + context.phase + '_failed')
        receipt = json.loads(result.stdout)
        context.write_json('native-'+context.phase+'.json', receipt)
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
