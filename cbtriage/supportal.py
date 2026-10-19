"""cbtriage supportal: tickets from Supportal (VPN only, no key needed) and what is already saved on this computer.
List: GET /api/tickets?assigneeId&status&page&perPage. One ticket with its whole history: GET /zendesk/ticket/<id>/status."""
import json
import os
import re
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import core
import triage

UA = "cbtriage/1.0 (local tool)"
_STATE = {"prefix": None, "down_until": 0.0, "down_msg": ""}


def reset():
    """Forget that Supportal was unreachable, so the next call really tries."""
    _STATE["down_until"] = 0.0
_ID_CACHE = {}


def _fetch(url, timeout=12):
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        body = e.read()[:200].decode("utf-8", "replace").strip()
        return None, "Supportal answered HTTP %d%s" % (e.code, (": " + re.sub(r"\s+", " ", body)[:120]) if body and not body.startswith("<") else ""), 0
    except urllib.error.URLError as e:
        why = str(e.reason)
        if isinstance(e.reason, socket.timeout) or "timed out" in why:
            why = "no answer within %ds" % timeout
        elif "nodename" in why or "Name or service" in why or "getaddrinfo" in why:
            why = "the address does not resolve"
        return _down("Cannot reach Supportal (%s). Are you on the Couchbase VPN?" % why)
    except socket.timeout:
        return _down("Cannot reach Supportal (no answer within %ds). Are you on the VPN?" % timeout)
    ms = int((time.time() - t0) * 1000)
    txt = raw.decode("utf-8", "replace")
    if txt.lstrip().startswith("<"):
        return None, "Supportal returned a web page, not data. A sign-in may be required for this endpoint.", ms
    try:
        return json.loads(txt), None, ms
    except ValueError:
        return None, "Supportal did not return valid JSON.", ms


def _get(url, timeout=12):
    """One GET with a hard limit on the whole request (a stalled DNS lookup is not covered by the socket timeout)."""
    if time.time() < _STATE["down_until"]:
        return None, _STATE["down_msg"], 0
    res = {}
    th = threading.Thread(target=lambda: res.__setitem__("v", _fetch(url, timeout)), daemon=True)
    th.start()
    th.join(timeout + 1)
    if "v" not in res:
        return _down("Cannot reach Supportal (no answer within %ds). Are you on the Couchbase VPN?" % timeout)
    return res["v"]


def _down(msg):
    _STATE["down_until"], _STATE["down_msg"] = time.time() + 15, msg
    return None, msg, 0


def _iso(v):
    if v in (None, ""):
        return ""
    if isinstance(v, (int, float)):
        v = v / 1000.0 if v > 1e11 else float(v)
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(v))
    return str(v)


def _tickets_path(base, q):
    last = None
    for pre in ([_STATE["prefix"]] if _STATE["prefix"] else []) + ["/api", "/api/v2"]:
        data, err, ms = _get(base + pre + "/tickets?" + urllib.parse.urlencode(q))
        if data is not None and isinstance(data, dict) and "data" in data:
            _STATE["prefix"] = pre
            return data, None
        last = err or "unexpected reply from %s/tickets" % pre
        if err and err.startswith("Cannot reach"):
            break
    return None, last


def list_tickets(base, assignee, statuses, per_page=100, max_pages=5):
    """Open tickets for one assignee id (or everyone when assignee is empty), one request series per status."""
    rows, errs, totals = [], [], {}
    for st in statuses:
        for page in range(1, max_pages + 1):
            q = {"status": st, "page": page, "perPage": per_page, "sortBy": "updatedAt", "sortDirection": "desc"}
            if assignee:
                q["assigneeId"] = assignee
            data, err = _tickets_path(base, q)
            if err:
                errs.append("%s tickets: %s" % (st, err))
                break
            got = data.get("data") or []
            cur = data.get("cursor") or {}
            totals[st] = cur.get("total", len(got))
            rows += got
            if not got or page >= int(cur.get("last") or 1):
                break
    out = []
    for r in rows:
        out.append({"id": str(r.get("id")), "subject": r.get("subject") or "", "status": r.get("status") or "", "priority": r.get("priority") or "",
                    "assignee": r.get("assignee_name") or "", "assignee_id": r.get("assignee_id") or 0, "org": r.get("organization_name") or "",
                    "created": _iso(r.get("created_at")), "updated": _iso(r.get("updated_at")), "esc_ent": r.get("esc_ent") or "", "cbse": r.get("cbse") or "", "bug": r.get("bug") or ""})
    out.sort(key=lambda x: x["updated"], reverse=True)
    return {"tickets": out, "totals": totals, "errors": errs, "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


def _name_from_url(u):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
    if q.get("name"):
        return q["name"][0]
    return urllib.parse.unquote(urllib.parse.urlparse(u).path.rstrip("/").split("/")[-1])


def _person(p):
    return {"id": p.get("id"), "name": p.get("name") or "", "email": p.get("email") or "", "role": p.get("role") or ""} if isinstance(p, dict) else {"id": None, "name": str(p or ""), "email": "", "role": ""}


def normalize(doc, source, as_of=""):
    """One tidy structure from the Supportal document, whether it was just fetched or read from the saved copy."""
    t = doc.get("ticket", doc)
    tags = t.get("tags") or []
    att_by_comment = {str(c.get("id")): [{"name": _name_from_url(a.get("mapped_content_url") or a.get("content_url") or ""), "url": a.get("mapped_content_url") or a.get("content_url") or ""} for a in (c.get("attachments") or [])]
                      for c in (t.get("comments") or [])}
    events = []
    for e in doc.get("timeline_events") or []:
        if not isinstance(e, dict):
            continue
        a = _person(e.get("author"))
        pub = e.get("is_public")
        events.append({"id": str(e.get("id")), "time": e.get("timestamp") or "", "author": a["name"] or e.get("title") or "", "role": a["role"],
                       "public": pub in (True, "True", "true", 1), "text": e.get("markdown") or "", "attachments": att_by_comment.get(str(e.get("id")), [])})
    events.sort(key=lambda x: x["time"])
    linked = []
    for k, lst in (("cbse", doc.get("cbses")), ("escalation", doc.get("escalations")), ("jira", doc.get("jira_issues"))):
        for x in lst or []:
            linked.append({"kind": k, "key": x if isinstance(x, str) else (x.get("key") or x.get("id") or ""), "summary": "" if isinstance(x, str) else (x.get("summary") or x.get("title") or ""), "status": "" if isinstance(x, str) else (x.get("status") or "")})
    snaps = [{"uuid": s.get("uuid") or s.get("id") or "", "time": s.get("timestamp") or "", "nodes": len(s.get("nodes") or [])} for s in (doc.get("snapshots") or []) if isinstance(s, dict)]
    files = [{"name": _name_from_url(f.get("url") or ""), "url": f.get("url") or "", "time": f.get("upload_ts") or ""} for f in (doc.get("ticket_files") or []) if isinstance(f, dict)]
    return {"source": source, "as_of": as_of,
            "ticket": {"id": str(t.get("id") or ""), "subject": t.get("subject") or "", "status": t.get("status") or "", "priority": t.get("priority") or "",
                       "created": t.get("created_at") or "", "updated": t.get("updated_at") or "", "organization": t.get("organization") or "",
                       "assignee": _person(doc.get("assignee")), "requester": _person(doc.get("requester")),
                       "components": [g[len("component__"):].replace("__", " > ").replace("_", " ") for g in tags if g.startswith("component__")],
                       "impact": next((g[len("current_impact__"):].replace("__", " / ").replace("_", " ") for g in tags if g.startswith("current_impact__")), ""),
                       "tags": [g for g in tags if g.startswith(("highest_was_", "entitlement__server", "case_type"))][:8]},
            "triage": triage.parse(t.get("fields")), "triage_summary": triage.summary(t.get("fields")), "events": events, "linked": linked, "snapshots": snaps, "files": files,
            "attachments": [{"name": _name_from_url(a.get("mapped_content_url") or ""), "url": a.get("mapped_content_url") or ""} for a in (doc.get("zendesk_attachments") or []) if isinstance(a, dict)]}


def ticket(base, root, tid):
    """The ticket and its whole history, live from Supportal; if that fails, the copy saved on this computer."""
    data, err, _ms = _get("%s/zendesk/ticket/%s/status" % (base, tid), timeout=15)
    if data is not None and isinstance(data, dict) and (data.get("ticket") or data.get("timeline_events") is not None):
        return normalize(data, "supportal", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())), None
    fp = os.path.join(root, tid, "ticket_%s.raw" % tid)
    if os.path.isfile(fp):
        try:
            with open(fp, encoding="utf-8", errors="replace") as f:
                return normalize(json.load(f), "saved copy", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime(fp)))), err
        except (OSError, ValueError):
            pass
    return None, err or "Supportal has no such ticket"


def my_zendesk_id(root, email):
    """Your Zendesk user id, found in the tickets already on this computer (you are the assignee or an author there)."""
    if not email:
        return None
    key = (root, email.lower())
    if key in _ID_CACHE:
        return _ID_CACHE[key]
    found = None
    try:
        for t in sorted(os.listdir(root), reverse=True):
            fp = os.path.join(root, t, "ticket_%s.raw" % t)
            if not os.path.isfile(fp):
                continue
            with open(fp, encoding="utf-8", errors="replace") as f:
                d = json.load(f)
            cands = [d.get("assignee"), d.get("requester")] + [e.get("author") for e in (d.get("timeline_events") or []) if isinstance(e, dict)]
            for p in cands:
                if isinstance(p, dict) and str(p.get("email", "")).lower() == email.lower() and p.get("id"):
                    found = {"id": p["id"], "name": p.get("name") or ""}
                    break
            if found:
                break
    except OSError:
        pass
    _ID_CACHE[key] = found
    return found


def connection(base, profile):
    reset()
    out = {"base": base, "supportal": {"reachable": False, "ms": 0, "error": ""}, "aws": {"ok": False, "error": "", "profile": profile}}
    t0 = time.time()
    try:
        urllib.request.urlopen(urllib.request.Request(base, headers={"User-Agent": UA}), timeout=8).read(200)
        out["supportal"].update(reachable=True, ms=int((time.time() - t0) * 1000))
    except urllib.error.HTTPError:
        out["supportal"].update(reachable=True, ms=int((time.time() - t0) * 1000))
    except Exception as e:  # noqa
        out["supportal"]["error"] = "Cannot reach %s: %s" % (base, getattr(e, "reason", e))
    try:
        r = subprocess.run(["aws", "sts", "get-caller-identity", "--profile", profile, "--output", "json"], capture_output=True, text=True, timeout=15)
        if r.returncode == 0:
            out["aws"].update(ok=True, account=json.loads(r.stdout).get("Account", ""))
        else:
            out["aws"]["error"] = (r.stderr.strip().splitlines() or ["not signed in"])[-1][:200]
    except FileNotFoundError:
        out["aws"]["error"] = "the aws command is not installed"
    except Exception as e:  # noqa
        out["aws"]["error"] = str(e)[:200]
    return out
