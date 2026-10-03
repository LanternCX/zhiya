"""Private, bounded HTTP entry point for the Go material worker."""

import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit

from parser import MAX_BYTES


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Filenames are query parameters; do not include them in access logs.
        pass

    def do_GET(self):
        self.send_response(200 if self.path == "/health" else 404)
        self.end_headers()

    def do_POST(self):
        self.connection.settimeout(15)
        url = urlsplit(self.path)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if url.path != "/parse" or not 0 < size <= MAX_BYTES:
                raise ValueError("Invalid request")
            name = parse_qs(url.query).get("name", [""])[0]
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError("Incomplete upload")
            # Native converters run in a disposable process so a timeout or crash
            # cannot leave the HTTP service stuck on this document.
            output = subprocess.run(
                [sys.executable, "parser.py", name], input=data, capture_output=True,
                timeout=120, check=True,
            ).stdout
            if len(output) > 64 * 1024 * 1024:
                raise ValueError("Result exceeds size limit")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(output)))
            self.end_headers()
            self.wfile.write(output)
        except (ValueError, OSError, subprocess.SubprocessError):
            self.send_error(422, "Document parsing failed")


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8090), Handler).serve_forever()
