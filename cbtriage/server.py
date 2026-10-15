#!/usr/bin/env python3
"""cbtriage: local web UI for deterministic Couchbase log triage (no LLM).

Usage: python3 cbtriage/server.py --root ~/Downloads/couchbaselogs/support [--port 8765]
Binds to 127.0.0.1 only.
"""
import argparse
import json
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
ROOT = None
CACHE = {}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj))

    def _path(self, qs):
        raw = qs["path"][0]
        suffix = "/*" if raw.endswith("/*") else ""
        return core.safe_path(ROOT, raw[:-2] if suffix else raw) + suffix

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        g = lambda k, d="": qs.get(k, [d])[0]  # noqa: E731
        try:
            if u.path == "/":
                with open(os.path.join(STATIC, "index.html"), "rb") as f:
                    return self._send(200, f.read(), "text/html; charset=utf-8")
            if u.path == "/api/tickets":
                return self._json({"root": ROOT, "tickets": core.list_tickets(ROOT)})
            if u.path == "/api/collections":
                return self._json(core.list_collections(ROOT, g("ticket")))
            if u.path == "/api/inventory":
                p = self._path(qs)
                key = ("inv", p)
                if key not in CACHE or g("refresh"):
                    CACHE[key] = core.inventory(p)
                return self._json(CACHE[key])
            if u.path == "/api/scan":
                p = self._path(qs)
                key = ("scan", p)
                if key not in CACHE or g("refresh"):
                    CACHE[key] = core.scan(p)
                return self._json(CACHE[key])
            if u.path == "/api/logfiles":
                return self._json(core.list_logfiles(self._path(qs)))
            if u.path == "/api/timeline":
                files = [f for f in g("files").split(",") if f]
                nodes = [n for n in g("nodes").split(",") if n] or None
                return self._json(core.timeline(self._path(qs), core.parse_user_ts(g("at")),
                                                float(g("window", "5")) * 60, files, g("regex") or None, nodes))
            if u.path == "/api/access":
                tf = core.parse_user_ts(g("from")) if g("from") else None
                tt = core.parse_user_ts(g("to")) if g("to") else None
                return self._json(core.access(self._path(qs), g("pattern") or None, g("group", "user"), tf, tt))
            if u.path == "/api/search":
                files = [f for f in g("files").split(",") if f]
                nodes = [n for n in g("nodes").split(",") if n] or None
                return self._json(core.search(self._path(qs), g("regex"), files, nodes, g("icase", "1") == "1",
                                              int(g("context", "0"))))
            if u.path == "/api/signatures":
                return self._json(core.load_signatures())
            return self._json({"error": "not found"}, 404)
        except Exception as e:  # noqa
            return self._json({"error": "%s: %s" % (type(e).__name__, e)}, 400)

    def do_POST(self):
        u = urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(n) or b"{}")
            if u.path == "/api/report":
                fp = core.write_report(ROOT, body["ticket"], body.get("items", []), body.get("header", ""))
                return self._json({"file": fp})
            return self._json({"error": "not found"}, 404)
        except Exception as e:  # noqa
            return self._json({"error": "%s: %s" % (type(e).__name__, e)}, 400)


def main():
    global ROOT
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.expanduser("~/Downloads/couchbaselogs/support"))
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-open", action="store_true")
    a = ap.parse_args()
    ROOT = os.path.realpath(a.root)
    if not os.path.isdir(ROOT):
        sys.exit("root not found: %s" % ROOT)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), H)
    url = "http://127.0.0.1:%d/" % a.port
    print("cbtriage on %s (root %s)" % (url, ROOT))
    if not a.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
