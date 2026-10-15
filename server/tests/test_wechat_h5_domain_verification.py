"""Fail-closed lexical and vhost selection tests. No live network or production write."""
import importlib.util
from pathlib import Path
import unittest

FILE = Path(__file__).resolve().parents[1] / "scripts" / "wechat_h5_domain_verification.py"
SPEC = importlib.util.spec_from_file_location("geogi_wechat_h5_domain", FILE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class NginxVhostTests(unittest.TestCase):
    def test_http_redirect_and_exact_tls_vhost(self):
        conf = """server { listen 80; server_name api.geogi.cn; return 301 https://api.geogi.cn$request_uri; }
server { listen 443 ssl; server_name api.geogi.cn;
  location / { proxy_pass http://127.0.0.1:3107; }
}"""
        opening, closing, exists = MODULE.locate_https_block(conf)
        self.assertFalse(exists)
        self.assertEqual(conf[closing], "}")
        self.assertIn("443 ssl", conf[opening:closing])

    def test_mask_ignores_comments_and_string_braces(self):
        conf = """# server { listen 443; server_name api.geogi.cn; }
server { listen 443 ssl; server_name api.geogi.cn;
add_header X-Example "foo}bar"; # }
}"""
        self.assertEqual(conf[MODULE.locate_https_block(conf)[1]], "}")

    def test_duplicate_tls_hosts_fail_closed(self):
        conf = "server { listen 443 ssl; server_name api.geogi.cn; }\n"*2
        with self.assertRaisesRegex(MODULE.SafeAbort, "COUNT=2"):
            MODULE.locate_https_block(conf)

    def test_wrong_hostname_fail_closed(self):
        with self.assertRaisesRegex(MODULE.SafeAbort, "COUNT=0"):
            MODULE.locate_https_block("server { listen 443 ssl; server_name demo.example; }")

    def test_existing_location_fail_closed(self):
        conf = """server { listen 443 ssl; server_name api.geogi.cn;
location = /iBZMBKP6Yg.txt { root /tmp; }
}"""
        with self.assertRaisesRegex(MODULE.SafeAbort, "LOCATION_EXISTS"):
            MODULE.locate_https_block(conf)

    def test_canonical_path_and_https_source_fixed(self):
        self.assertEqual(str(MODULE.VHOST), "/www/server/panel/vhost/nginx/api.geogi.cn.conf")
        self.assertEqual(MODULE.URL, "https://api.geogi.cn/iBZMBKP6Yg.txt")

if __name__ == "__main__":
    unittest.main()
