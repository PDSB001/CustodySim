"""Exercise installed Nginx in a separate temporary instance, never production ports/config.

Run on Linux with nginx available. Uses fixture authentication, not any real key.
"""
import http.client
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parent.parent


class Upstream(BaseHTTPRequestHandler):
    hits = 0

    def do_GET(self):
        type(self).hits += 1
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *_args): pass


with tempfile.TemporaryDirectory(prefix="custodysim-nginx-test-") as directory:
    directory = Path(directory)
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        port = reserved.getsockname()[1]
    http_config = (ROOT / "deploy/nginx/edgeone-security-http.conf").read_text()
    # Fixtures originate on loopback; disable its health-check exemption to test the gate.
    http_config = http_config.replace("127.0.0.1 1;", "127.0.0.1 0;")
    server = (ROOT / "deploy/nginx/edgeone-security-server.conf").read_text()
    server = server.replace("/var/log/nginx/", str(directory) + "/")
    module_spec = importlib.util.spec_from_file_location("security", ROOT / "scripts/configure-edgeone-security.py")
    security = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(security)
    root = "location / {\nproxy_pass http://127.0.0.1:3000;\nproxy_set_header X-Real-IP $custodysim_client_ip;\n}\n"
    auth = security.auth_location(root)
    upstream_url = f"http://127.0.0.1:{upstream.server_port}"
    root = root.replace("http://127.0.0.1:3000", upstream_url)
    auth = auth.replace("http://127.0.0.1:3000", upstream_url)
    config = directory / "nginx.conf"
    config.write_text(f"""
pid {directory}/nginx.pid;
error_log {directory}/error.log;
events {{ worker_connections 128; }}
http {{
  access_log off;
  client_body_temp_path {directory}/body;
  proxy_temp_path {directory}/proxy;
  map $http_x_fixture_edge $custodysim_edgeone_authenticated {{ default 0; fixture 1; }}
  map $http_x_fixture_ip $custodysim_client_ip {{ default $http_x_fixture_ip; "" $remote_addr; }}
  {http_config}
  server {{ listen 127.0.0.1:{port}; server_name fixture;
    {server}
    {auth}
    {root}
  }}
}}
""")
    command = ["nginx", "-p", str(directory) + "/", "-c", str(config)]
    subprocess.run(command + ["-t"], check=True, capture_output=True)
    subprocess.run(command, check=True, capture_output=True)

    def request(path="/api/auth/login", authenticated=True, ip="198.51.100.1", body=None):
        headers = {"X-Fixture-Ip": ip, "Host": "fixture"}
        if authenticated: headers["X-Fixture-Edge"] = "fixture"
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            connection.request("GET", path, body=body, headers=headers)
            response = connection.getresponse()
            status = response.status
            response.read()
            return status
        finally: connection.close()

    try:
        assert request(authenticated=False) == 403
        assert Upstream.hits == 0, "unauthenticated origin request must not reach the app"
        assert request(body=b"x" * 17000) == 413
        assert Upstream.hits == 0, "oversized auth body must not reach the app"
        assert request() == 200
        results = [request() for _ in range(8)]
        assert 429 in results, results
        time.sleep(1.1)
        assert request(ip="198.51.100.2") == 200
        assert request("/login") == 200, "page loads must not consume auth API quota"
        assert request("/api/auth/refresh", ip="198.51.100.3") == 200
        print("PASS real Nginx: origin gate, auth body bound, 429 before upstream, independent client, page/refresh access")
    finally:
        subprocess.run(command + ["-s", "quit"], check=True, capture_output=True)
        upstream.shutdown()
        upstream.server_close()
        time.sleep(0.2)
