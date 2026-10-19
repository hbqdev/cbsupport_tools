"""cbtriage tickets: what Supportal already gave us about each ticket on disk (ticket_<n>.raw), and the mined themes
from past tickets in the parent repo. Read only; standard library only."""
import json
import os
import re

import core
import triage

PARENT = os.path.dirname(core.HERE)
THEMES = os.path.join(PARENT, "mined-analyses")
_CACHE = {}

# component tag words -> the mined themes file that talks about them
THEME_FOR = [("data", "kv"), ("kv", "kv"), ("rebalance", "kv"), ("failover", "kv"), ("cluster", "kv"), ("index", "index"), ("gsi", "index"), ("query", "query"),
             ("n1ql", "query"), ("eventing", "eventing"), ("analytics", "analytics"), ("cbas", "analytics"), ("backup", "backup"), ("cao", "cao"),
             ("operator", "cao"), ("kubernetes", "cao"), ("capella", "capella"), ("tools", "tools")]


def _raw(root, t):
    fp = os.path.join(root, t, "ticket_%s.raw" % t)
    try:
        with open(fp, encoding="utf-8", errors="replace") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None, None
    return d.get("ticket", d), d


def _components(tags):
    out = []
    for g in tags or []:
        if g.startswith("component__"):
            out.append(g[len("component__"):].replace("__", " > ").replace("_", " "))
    return out


def _impact(tags):
    for g in tags or []:
        if g.startswith("current_impact__"):
            return g[len("current_impact__"):].replace("__", " / ").replace("_", " ")
    return ""


def summary(root, t):
    tdir = os.path.join(root, t)
    key = (t, os.path.getmtime(tdir))
    if key in _CACHE:
        return _CACHE[key]
    k, top = _raw(root, t)
    try:
        colls = core.list_collections(root, t)
    except Exception:  # noqa
        colls = []
    snaps = [c for c in colls if "merged" not in c["name"]]
    out = {"ticket": t, "subject": "", "status": "", "requester": "", "organization": "", "assignee": "", "created": "", "components": [], "impact": "",
           "collections": len(snaps), "nodes": max([c["nodes"] for c in snaps] or [0]), "has_logs": bool(snaps), "mtime": int(os.path.getmtime(tdir)), "triage": {}}
    if k:
        out.update({"subject": k.get("subject") or "", "status": k.get("status") or "", "created": k.get("created_at") or "",
                    "requester": (top.get("requester") or {}).get("name") if isinstance(top.get("requester"), dict) else (k.get("requester") or ""),
                    "organization": k.get("organization") or "", "assignee": (top.get("assignee") or {}).get("name") if isinstance(top.get("assignee"), dict) else (k.get("assignee") or ""),
                    "components": _components(k.get("tags")), "impact": _impact(k.get("tags")), "triage": triage.summary(k.get("fields"))})
    _CACHE[key] = out
    return out


def ticket_list(root):
    out = []
    for t in core.list_tickets(root):
        if not re.fullmatch(r"\d{3,8}", t):
            continue
        out.append(summary(root, t))
    out.sort(key=lambda x: -x["mtime"])
    return out


def info(root, t):
    s = dict(summary(root, t))
    k, top = _raw(root, t)
    s.update({"description": "", "comments": 0, "last_comment": "", "cbses": [], "jira": [], "tags": [], "fields": []})
    if k:
        s["fields"] = triage.parse(k.get("fields"))
        cs = k.get("comments") or []
        s.update({"description": (k.get("description") or "")[:2500], "comments": len(cs), "last_comment": (cs[-1].get("created_at") if cs else "") or "",
                  "tags": [g for g in (k.get("tags") or []) if g.startswith(("component__", "current_impact__", "highest_was_", "entitlement__server"))]})
        for src, dst in (("cbses", "cbses"), ("jira_issues", "jira")):
            for x in (top or {}).get(src) or []:
                s[dst].append(x if isinstance(x, str) else (x.get("key") or x.get("id") or json.dumps(x)[:60]))
    return s


def themes_for(components, subject=""):
    """Which mined-theme files apply: from the ticket's component tags, then from words in the subject."""
    words = " ".join(components).lower() + " " + (subject or "").lower()
    seen, files = set(), []
    for w, f in THEME_FOR:
        if re.search(r"\b" + re.escape(w), words) and f not in seen:
            seen.add(f)
            files.append(f)
    return files[:3]


def read_themes(name):
    fp = os.path.join(THEMES, "%s-themes.md" % os.path.basename(name))
    try:
        with open(fp, encoding="utf-8", errors="replace") as f:
            txt = f.read()
    except OSError:
        return {"name": name, "sections": []}
    secs, cur = [], None
    for ln in txt.splitlines():
        if ln.startswith("## "):
            cur = {"title": ln[3:].strip(), "items": []}
            secs.append(cur)
        elif cur is not None and ln.strip() and not ln.startswith("#"):
            cur["items"].append(ln.strip())
    return {"name": name, "sections": [s for s in secs if s["title"] != "Source tickets"]}


def values_seen(root):
    """The Component and Case Type values that appear on the tickets saved here, for hints in the editor."""
    seen = {"Component": set(), "Case Type": set()}
    for t in core.list_tickets(root):
        k, _ = _raw(root, t)
        for n in seen:
            v = (k or {}).get("fields", {}).get(n) if k else None
            if v:
                seen[n].add(str(v).replace("::", " > "))
    return {n: sorted(v) for n, v in seen.items()}
