"""Pure configuration tests: never touches live Nginx or the network."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("security", Path(__file__).with_name("configure-edgeone-security.py"))
security = importlib.util.module_from_spec(spec)
spec.loader.exec_module(security)
SITE = """server {
    listen 443 ssl;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header X-Real-IP $custodysim_client_ip;
        client_max_body_size 26m;
    }
}
server {
    if ($host = example.test) { return 301 https://$host$request_uri; }
    listen 80;
}
"""


class ConfigurationTest(unittest.TestCase):
    def test_preserves_forwarding_and_http_acme(self):
        changed = security.configured_site(SITE)
        self.assertEqual(changed.count(security.INCLUDE), 1)
        self.assertIn("X-Real-IP $custodysim_client_ip", changed)
        self.assertEqual(changed.split("server {")[-1], SITE.split("server {")[-1])
        self.assertEqual(security.configured_site(changed).count(security.INCLUDE), 1)

    def test_auth_body_limit_retains_upstream_headers(self):
        location = security.auth_location(SITE)
        self.assertIn("client_max_body_size 16k", location)
        self.assertNotIn("26m", location)
        self.assertIn("X-Real-IP $custodysim_client_ip", location)
        self.assertIn("proxy_pass http://127.0.0.1:3000", location)

    def test_refuses_ambiguous_https_sites(self):
        with self.assertRaises(ValueError): security.configured_site(SITE + SITE)
        with self.assertRaises(ValueError): security.configured_site("server { listen 80; }")


if __name__ == "__main__": unittest.main()
