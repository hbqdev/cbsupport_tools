#!/usr/bin/env python3
"""cbtriage: local web UI for deterministic Couchbase log triage (no LLM).

Usage: python3 cbtriage/server.py --root ~/Downloads/couchbaselogs/support [--port 8765]
Binds to 127.0.0.1 only.
"""
import argparse
import json
import os
import sys
import re
import subprocess
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402
import searchx  # noqa: E402
import winprof as prof  # noqa: E402
import logfiles  # noqa: E402
import tickets  # noqa: E402
import config  # noqa: E402
import supportal  # noqa: E402

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
ROOT = None
CACHE = {}
JOBS = {}
HERE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREP = os.environ.get("CBTRIAGE_PREP") or os.path.join(PARENT, "prep_ticket_aws.sh")  # CBTRIAGE_PREP lets a test use a stand-in script


def parent_dir_tickets():
    """The folder the download script itself writes to (DIR_TICKETS in the parent repo's .env)."""
    try:
        with open(os.path.join(PARENT, ".env")) as f:
            for ln in f:
                m = re.match(r"\s*DIR_TICKETS\s*=\s*['\"]?([^'\"\n]+)", ln)
                if m:
                    return os.path.expanduser(m.group(1).strip())
    except OSError:
        pass
    return ""


def paths_info():
    s = parent_dir_tickets()
    n = len([t for t in os.listdir(ROOT) if re.fullmatch(r"\d{3,8}", t)]) if os.path.isdir(ROOT) else 0
    return {"logs_root": ROOT, "exists": os.path.isdir(ROOT), "tickets_here": n,
            "ticket_folder": os.path.join(ROOT, "<ticket number>"), "cbcollect": os.path.join(ROOT, "<ticket number>", "snapshots", "<snapshot>", "cbcollect_info_ns_1@<node>_<time>"),
            "cache": os.path.join(HERE_DIR, ".cache"), "config": config.CONF_DIR, "backups": config.BACKUPS, "settings_file": config.SETTINGS,
            "script": PREP, "script_exists": os.path.isfile(PREP), "script_logs_root": s, "mismatch": bool(s) and os.path.realpath(s) != os.path.realpath(ROOT)}


def apply_root(path):
    global ROOT
    ROOT = os.path.realpath(os.path.expanduser(path))
    CACHE.clear()
    for m, a in ((prof, "_IDX"), (logfiles, "_INV"), (tickets, "_CACHE"), (supportal, "_ID_CACHE")):
        getattr(m, a).clear()


def start_fetch(ticket, snaps=None):
    """Run the parent repo's prep_ticket_aws.sh for one ticket in the background and keep its output."""
    if not re.fullmatch(r"\d{3,8}", ticket or ""):
        raise ValueError("a ticket number is digits only, for example 81395")
    if not os.path.isfile(PREP):
        raise ValueError("prep_ticket_aws.sh not found next to cbtriage: %s" % PREP)
    j = JOBS.get(ticket)
    if j and j["proc"].poll() is None:
        return {"started": False, "running": True}
    logdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache", "jobs")
    os.makedirs(logdir, exist_ok=True)
    lp = os.path.join(logdir, "%s.log" % ticket)
    lf = open(lp, "w")
    env = dict(os.environ)
    if snaps is not None:  # which snapshots to fetch; an empty list means none (the ticket's own files and attachments still come)
        bad = [x for x in snaps if not re.fullmatch(r"https://supportal\.couchbase\.com/snapshot/[a-f0-9]+::\d+", x)]
        if bad:
            raise ValueError("not a snapshot address: %s" % bad[0])
        env["PREP_SNAPSHOTS"] = "\n".join(snaps) or "none"
    proc = subprocess.Popen(["bash", PREP, ticket], cwd=PARENT, env=env, stdout=lf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    JOBS[ticket] = {"proc": proc, "log": lp, "started": time.time()}
    return {"started": True, "running": True}


AWSLOGIN = {}


def aws_login_start():
    """Run `aws sso login` for the configured profile. It opens the browser on this computer; its output carries the address and code as a fallback."""
    j = AWSLOGIN.get("job")
    if j and j["proc"].poll() is None:
        return {"started": False, "running": True}
    profile = config.load_settings()["aws_profile"]
    if not re.fullmatch(r"[\w.@-]{1,64}", profile or ""):
        raise ValueError("the AWS profile name in Settings looks wrong")
    logdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache", "jobs")
    os.makedirs(logdir, exist_ok=True)
    lp = os.path.join(logdir, "awslogin.log")
    lf = open(lp, "w")
    try:
        proc = subprocess.Popen(["aws", "sso", "login", "--profile", profile], stdout=lf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    except FileNotFoundError:
        raise ValueError("the aws command is not installed")
    AWSLOGIN["job"] = {"proc": proc, "log": lp, "started": time.time(), "profile": profile}
    return {"started": True, "running": True}


def aws_login_status():
    j = AWSLOGIN.get("job")
    if not j:
        return {"job": False}
    rc = j["proc"].poll()
    try:
        txt = open(j["log"], errors="replace").read()
    except OSError:
        txt = ""
    m = re.search(r"https://\S+", txt)
    c = re.search(r"\b[A-Z]{4}-[A-Z]{4}\b", txt)
    out = {"job": True, "running": rc is None, "rc": rc, "url": m.group(0) if m else "", "code": c.group(0) if c else "", "log": txt[-800:], "seconds": int(time.time() - j["started"]), "profile": j["profile"]}
    if rc is not None:
        out["signed_in"] = rc == 0
    return out


def clear_logs(ticket):
    """Delete a ticket's whole folder from the disk, so the next download starts clean."""
    import shutil
    if not re.fullmatch(r"\d{3,8}", ticket or ""):
        raise ValueError("a ticket number is digits only")
    j = JOBS.get(ticket)
    if j and j["proc"].poll() is None:
        raise ValueError("a download is running for this ticket, cancel it first")
    d = os.path.realpath(os.path.join(ROOT, ticket))
    if os.path.dirname(d) != ROOT or not os.path.isdir(d):
        raise ValueError("there is no folder for ticket %s under %s" % (ticket, ROOT))
    size = dir_size(d)
    shutil.rmtree(d)
    CACHE.clear()
    for m, a in ((prof, "_IDX"), (logfiles, "_INV"), (tickets, "_CACHE")):
        getattr(m, a).clear()
    JOBS.pop(ticket, None)
    return {"deleted": d, "bytes": size}


def dir_size(path):
    total = 0
    for dp, _dn, fns in os.walk(path):
        for f in fns:
            try:
                total += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return total


def job_status(ticket):
    j = JOBS.get(ticket)
    tdir = os.path.join(ROOT, ticket) if re.fullmatch(r"\d{3,8}", ticket or "") else None
    has = bool(tdir and os.path.isdir(tdir) and core.find_node_dirs(tdir))
    out = {"ticket": ticket, "exists": bool(tdir and os.path.isdir(tdir)), "has_logs": has, "job": bool(j)}
    if j:
        rc = j["proc"].poll()
        try:
            with open(j["log"], errors="replace") as f:
                txt = f.read()
        except OSError:
            txt = ""
        stage = ""
        for ln in reversed(txt.splitlines()):
            if ln.strip():
                stage = ln.strip()[:160]
                if ln.startswith("==="):
                    break
        out.update({"auth_problem": rc not in (None, 0) and bool(re.search(r"token has expired|sso session|aws sso login|unable to locate credentials|expiredtoken|error when retrieving token|security token", txt, re.I)),
                    "running": rc is None, "rc": rc, "log": txt[-3500:], "stage": stage, "seconds": int(time.time() - j["started"]),
                    "bytes": dir_size(tdir) if tdir and os.path.isdir(tdir) else 0})
    return out


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
            if u.path.startswith("/static/"):
                fn = os.path.basename(u.path)
                fp = os.path.join(STATIC, fn)
                if not os.path.isfile(fp):
                    return self._json({"error": "not found"}, 404)
                ct = {"js": "text/javascript", "css": "text/css"}.get(fn.rsplit(".", 1)[-1], "application/octet-stream")
                with open(fp, "rb") as f:
                    return self._send(200, f.read(), ct + "; charset=utf-8")
            if u.path == "/api/config":
                return self._json({"categories": config.load_categories(), "signatures": core.load_signatures(), "customized": os.path.isfile(config.USER_CATS), "seen": tickets.values_seen(ROOT),
                                   "paths": {"categories": config.USER_CATS, "signatures": config.SIGS, "backups": config.BACKUPS}})
            if u.path == "/api/rxcheck":
                return self._json({"error": config.check_regex(g("regex"), g("pcre2") == "1", g("fixed") == "1")} if config.check_regex(g("regex"), g("pcre2") == "1", g("fixed") == "1") else {"ok": True})
            if u.path == "/api/settings":
                st = config.load_settings(); me = supportal.my_zendesk_id(ROOT, st["user"]["email"])
                return self._json({"settings": st, "detected": me, "paths": paths_info()})
            if u.path == "/api/sp/status":
                st = config.load_settings()
                return self._json(supportal.connection(st["supportal_base"], st["aws_profile"]))
            if u.path in ("/api/sp/tickets", "/api/sp/ticket") and g("retry"):
                supportal.reset()
            if u.path == "/api/sp/tickets":
                st = config.load_settings(); who = g("assignee", "me")
                aid = ""
                if who == "me":
                    aid = str(st["user"].get("zendesk_id") or (supportal.my_zendesk_id(ROOT, st["user"]["email"]) or {}).get("id") or "")
                    if not aid:
                        return self._json({"tickets": [], "errors": [], "need_identity": True})
                elif who != "all":
                    aid = re.sub(r"\D", "", who)
                sts = [x for x in g("statuses", ",".join(st["statuses"])).split(",") if x]
                r = supportal.list_tickets(st["supportal_base"], aid, sts, st["per_page"])
                for t in r["tickets"]:
                    d = os.path.join(ROOT, t["id"])
                    ls = tickets.summary(ROOT, t["id"]) if os.path.isdir(d) else None
                    t["local"] = bool(ls and ls["has_logs"])
                    t["triage"] = (ls or {}).get("triage") or {}
                return self._json(r)
            if u.path == "/api/sp/ticket":
                tid = g("id")
                if not re.fullmatch(r"\d{3,8}", tid):
                    return self._json({"error": "a ticket number is digits only"}, 400)
                st = config.load_settings(); doc, err = supportal.ticket(st["supportal_base"], ROOT, tid)
                if doc is None:
                    return self._json({"error": err}, 502)
                d = os.path.join(ROOT, tid); summ = tickets.summary(ROOT, tid) if os.path.isdir(d) else None
                doc["warning"] = err or ""
                doc["local"] = {"dir": d, "exists": os.path.isdir(d), "has_logs": bool(summ and summ["has_logs"]), "nodes": summ["nodes"] if summ else 0, "collections": summ["collections"] if summ else 0}
                return self._json(doc)
            if u.path == "/api/ticketlist":
                return self._json(tickets.ticket_list(ROOT))
            if u.path == "/api/ticketinfo":
                t = g("ticket")
                if not re.fullmatch(r"\d{3,8}", t) or not os.path.isdir(os.path.join(ROOT, t)):
                    return self._json({"error": "ticket not found on this computer"}, 404)
                i = tickets.info(ROOT, t)
                i["themes"] = [tickets.read_themes(f) for f in tickets.themes_for(i["components"], i["subject"])]
                return self._json(i)
            if u.path == "/api/jobs":
                return self._json([{"ticket": t, "running": j["proc"].poll() is None, "rc": j["proc"].poll(), "seconds": int(time.time() - j["started"])} for t, j in JOBS.items()])
            if u.path == "/api/job":
                return self._json(job_status(g("ticket")))
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
            if u.path in ("/api/lanes", "/api/moments", "/api/profile"):
                globs = [x.strip() for x in g("files", "*.log").split(",") if x.strip()]
                nodes = [n for n in g("nodes").split(",") if n] or None
                pick = json.loads(g("pick")) if g("pick") else None
                if u.path == "/api/lanes":
                    return self._json(prof.lanes_overview(self._path(qs), globs, nodes, pick=pick))
                if u.path == "/api/moments":
                    return self._json(prof.moments(self._path(qs), globs, nodes, pick=pick))
                opts = {k: g(k, "") == "1" for k in ("fixed", "word", "invert", "pcre2", "gz")}
                opts["icase"] = g("icase", "1") == "1"
                tf = tt = _pre = None
                if g("time").strip():
                    t0, t1, _pre = core.parse_time_expr(g("time"))
                    tf, tt = t0, t1 - 1e-6
                excl = [x for x in g("exclude").split("\n") if x]
                r = prof.profile(self._path(qs), g("regex"), globs, nodes, opts, tf, tt, excl, pick)
                r["iso_prefix"] = _pre if g("time").strip() else None
                return self._json(r)
            if u.path == "/api/files":
                return self._json(logfiles.files_inventory(self._path(qs), g("refresh") == "1"))
            if u.path == "/api/readfile":
                return self._json(logfiles.read_file(self._path(qs), g("node"), g("file"), int(g("start", "1")), int(g("n", "200"))))
            if u.path == "/api/findline":
                return self._json(logfiles.find_line(self._path(qs), g("node"), g("file"), g("time")))
            if u.path == "/api/grepfile":
                return self._json(logfiles.grep_file(self._path(qs), g("node"), g("file"), g("regex"), g("icase", "1") == "1", g("fixed") == "1", int(g("limit", "300"))))
            if u.path == "/api/time":
                t0, t1, pre = core.parse_time_expr(g("expr"))
                return self._json({"from": core.fmt_ts(t0), "to": core.fmt_ts(t1 - 1e-6 if t1 - t0 >= 1 else t1), "iso_prefix": pre})
            if u.path == "/api/context":
                return self._json(searchx.context(self._path(qs), g("node"), g("file"), int(g("line", "1")),
                                                  int(g("before", "5")), int(g("after", "5"))))
            if u.path == "/api/sx":
                globs = [x.strip() for x in g("files", "*.log").split(",") if x.strip()]
                nodes = [n for n in g("nodes").split(",") if n] or None
                opts = {k: g(k, "") == "1" for k in ("fixed", "word", "invert", "pcre2", "gz")}
                opts["icase"] = g("icase", "1") == "1"
                tf = tt = pre = None
                if g("time").strip():
                    t0, t1, pre = core.parse_time_expr(g("time"))
                    tf, tt = t0, t1 - 1e-6
                excl = [x for x in g("exclude").split("\n") if x]
                r = searchx.run(self._path(qs), g("regex"), globs, nodes, opts, tf, tt, g("bucket", "auto"),
                                int(g("rows", "500")), excl, json.loads(g("pick")) if g("pick") else None)
                r["window"] = {"from": core.fmt_ts(tf), "to": core.fmt_ts(tt), "iso_prefix": pre} if tf is not None else None
                return self._json(r)
            if u.path == "/api/awslogin":
                return self._json(aws_login_status())
            if u.path == "/api/tz":
                out = {}
                for nd in core.collection_nodes(self._path(qs)):
                    offs = {}
                    for fn in ("ns_server.info.log", "ns_server.debug.log", "memcached.log", "ns_server.error.log"):
                        fp = os.path.join(nd, fn)
                        if os.path.isfile(fp):
                            offs[fn] = core.file_offset(fp)
                            break
                    out[core.node_short(nd)] = next(iter(offs.values()), 0)
                return self._json({"nodes": out})
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
            if u.path == "/api/config":
                if "categories" in body:
                    return self._json(config.save_categories(body["categories"]))
                if "signatures" in body:
                    return self._json(config.save_signatures(body["signatures"]))
                return self._json({"error": "nothing to save"}, 400)
            if u.path == "/api/config/reset":
                return self._json(config.reset_categories())
            if u.path == "/api/settings":
                old = config.load_settings()["logs_root"]
                st = config.save_settings(body)
                if st["logs_root"] != old and st["logs_root"]:
                    apply_root(st["logs_root"])
                supportal._ID_CACHE.clear()
                return self._json({"settings": st, "paths": paths_info()})
            if u.path == "/api/reveal":
                p = os.path.realpath(os.path.expanduser(str(body.get("path", ""))))
                ok = [ROOT, os.path.realpath(config.CONF_DIR), os.path.realpath(os.path.join(HERE_DIR, ".cache"))]
                if not any(p == a or p.startswith(a + os.sep) for a in ok) or not os.path.exists(p):
                    return self._json({"error": "that folder is not one of cbtriage's own folders, or it does not exist yet"}, 400)
                subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", p])
                return self._json({"ok": True})
            if u.path == "/api/fetch":
                return self._json(start_fetch(str(body.get("ticket", "")).strip(), body.get("snapshots")))
            if u.path == "/api/clearlogs":
                return self._json(clear_logs(str(body.get("ticket", "")).strip()))
            if u.path == "/api/awslogin":
                return self._json(aws_login_start())
            if u.path == "/api/fetchcancel":
                j = JOBS.get(str(body.get("ticket", "")))
                if j and j["proc"].poll() is None:
                    import signal
                    os.killpg(os.getpgid(j["proc"].pid), signal.SIGTERM)
                return self._json({"ok": True})
            if u.path == "/api/report":
                fp = core.write_report(ROOT, body["ticket"], body.get("items", []), body.get("header", ""))
                return self._json({"file": fp})
            return self._json({"error": "not found"}, 404)
        except Exception as e:  # noqa
            return self._json({"error": "%s: %s" % (type(e).__name__, e)}, 400)


def main():
    global ROOT
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=None, help="folder that holds one folder per ticket (default: the logs folder in Settings, else ~/Downloads/couchbaselogs/support)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-open", action="store_true")
    a = ap.parse_args()
    ROOT = os.path.realpath(os.path.expanduser(a.root or config.load_settings()["logs_root"] or "~/Downloads/couchbaselogs/support"))
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
