"""GeoGi virtual-payment overlay native release hooks, using the existing production symlink layout."""
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
            import os, stat
            private=Path(os.environ['GEOGI_VIRTUAL_PAYMENT_SETUP_FILE'])
            assert private.is_file() and not private.is_symlink() and stat.S_IMODE(private.stat().st_mode)==0o600
            remote='/tmp/geogi-vpay-'+context.source_sha
            subprocess.run(['ssh','-o','BatchMode=yes','geogi-prod','mkdir -p '+remote+'/src/services '+remote+'/src/scripts '+remote+'/tests && chmod 700 '+remote],check=True,capture_output=True)
            for relative in ['src/services/wechat-virtual-payment.js', 'src/services/wechat-virtual-payment-router.js', 'src/services/wechat-message-push.js', 'src/services/payment-store.js', 'src/services/payment-service.js', 'src/scripts/configure-wechat-virtual-payment.js', 'tests/wechat_message_push_regression.js', 'tests/wechat_virtual_payment_regression.js', 'tests/virtual_payment_router_client_regression.js']:
                subprocess.run(['scp',str(root/'server'/relative),'geogi-prod:'+remote+'/'+relative],check=True,capture_output=True)
            subprocess.run(['scp',str(root/'utils/virtual-payment.js'),'geogi-prod:'+remote+'/virtual-payment-client.js'],check=True,capture_output=True)
            subprocess.run(['scp','-p',str(private),'geogi-prod:'+remote+'/appkeys.private.json'],check=True,capture_output=True)
        command='python3 - '+shlex.quote(context.phase)+' '+shlex.quote(context.source_sha)
        result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','geogi-prod',command],
                              input=(Path(__file__).with_name('native.py')).read_text(),capture_output=True,text=True,check=True,timeout=800)
        receipt=json.loads(result.stdout)
        if context.phase=='stage':
            import hashlib
            for relative, expected in receipt['artifact_hashes'].items():
                assert hashlib.sha256((root/'server'/relative).read_bytes()).hexdigest()==expected
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
