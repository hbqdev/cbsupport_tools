"""cbtriage config: the questions (categories) and known problems (signatures) are data files that the UI edits.
Saves are validated, written atomically, and the previous version is kept as a timestamped backup."""
import json
import os
import shutil
import subprocess
import time

import core

HERE = core.HERE
DEFAULT_CATS = os.path.join(HERE, "categories.default.json")
CONF_DIR = os.path.join(HERE, "config")
USER_CATS = os.path.join(CONF_DIR, "categories.json")
SIGS = os.path.join(HERE, "signatures.json")
BACKUPS = os.path.join(CONF_DIR, "backups")
CAT_FIELDS = {"id": "", "title": "", "group": "General", "desc": "", "rx": "", "files": [], "keywords": [], "components": [], "case_types": [], "counts": False,
              "fixed": False, "pcre2": False, "extra": "", "enabled": True}


def _read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_categories():
    path = USER_CATS if os.path.isfile(USER_CATS) else DEFAULT_CATS
    return [dict(CAT_FIELDS, **c) for c in _read(path)["categories"]]


def default_categories():
    return [dict(CAT_FIELDS, **c) for c in _read(DEFAULT_CATS)["categories"]]


def check_regex(rx, pcre2=False, fixed=False):
    """Ask rg itself whether the pattern is valid, since rg is what will run it."""
    if not rx or fixed:
        return ""
    r = subprocess.run(["rg", "-e", rx, *(["-P"] if pcre2 else []), "--", os.devnull], capture_output=True, text=True)
    if r.returncode == 2 and r.stderr.strip():
        return " ".join(l.strip() for l in r.stderr.splitlines() if l.strip())[:300]
    return ""


def _backup(path, stem):
    if os.path.isfile(path):
        os.makedirs(BACKUPS, exist_ok=True)
        dst = os.path.join(BACKUPS, "%s-%s.json" % (stem, time.strftime("%Y%m%d-%H%M%S")))
        shutil.copy2(path, dst)
        old = sorted(f for f in os.listdir(BACKUPS) if f.startswith(stem + "-"))
        for f in old[:-30]:
            os.remove(os.path.join(BACKUPS, f))
        return dst
    return ""


def _write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


def save_categories(cats):
    seen = set()
    out = []
    for i, c in enumerate(cats):
        c = dict(CAT_FIELDS, **c)
        if not str(c["title"]).strip():
            raise ValueError("question %d has no title" % (i + 1))
        c["id"] = (c["id"] or "".join(ch if ch.isalnum() else "_" for ch in c["title"].lower()).strip("_") or "q%d" % i)
        if c["id"] in seen:
            c["id"] += "_%d" % i
        seen.add(c["id"])
        c["files"] = [f.strip() for f in c["files"] if f.strip()]
        if not c["files"]:
            raise ValueError('"%s" has no log files' % c["title"])
        err = check_regex(c["rx"], c["pcre2"], c["fixed"])
        if err:
            raise ValueError('"%s": the search pattern is not valid: %s' % (c["title"], err))
        out.append(c)
    b = _backup(USER_CATS if os.path.isfile(USER_CATS) else DEFAULT_CATS, "categories")
    _write(USER_CATS, {"version": 1, "categories": out})
    return {"ok": True, "count": len(out), "backup": os.path.basename(b)}


def reset_categories():
    b = _backup(USER_CATS, "categories")
    if os.path.isfile(USER_CATS):
        os.remove(USER_CATS)
    return {"ok": True, "backup": os.path.basename(b)}


def save_signatures(sigs):
    out = []
    for i, s in enumerate(sigs):
        if not str(s.get("title", "")).strip() or not str(s.get("regex", "")).strip():
            raise ValueError("known problem %d needs a title and a search pattern" % (i + 1))
        s = dict(s)
        s["id"] = s.get("id") or "".join(ch if ch.isalnum() else "-" for ch in s["title"].lower()).strip("-")
        s["files"] = [f.strip() for f in s.get("files", []) if f.strip()]
        if not s["files"]:
            raise ValueError('"%s" has no log files' % s["title"])
        err = check_regex(s["regex"], "-P" in s.get("flags", []))
        if err:
            raise ValueError('"%s": the search pattern is not valid: %s' % (s["title"], err))
        s.setdefault("component", "other"); s.setdefault("severity", "info"); s.setdefault("meaning", ""); s.setdefault("next", "")
        out.append(s)
    b = _backup(SIGS, "signatures")
    _write(SIGS, out)
    return {"ok": True, "count": len(out), "backup": os.path.basename(b)}


# ------------------------------------------------------------------ settings: who you are, which tickets to list, where things are
SETTINGS = os.path.join(CONF_DIR, "settings.json")
DEFAULT_SETTINGS = {"user": {"name": "", "email": "", "zendesk_id": None}, "supportal_base": "https://supportal.couchbase.com",
                    "statuses": ["new", "open", "pending", "hold"], "per_page": 100, "aws_profile": "supportal", "logs_root": ""}


def git_email():
    try:
        return subprocess.run(["git", "config", "user.email"], capture_output=True, text=True, timeout=3).stdout.strip()
    except Exception:  # noqa
        return ""


def load_settings():
    s = json.loads(json.dumps(DEFAULT_SETTINGS))
    try:
        u = _read(SETTINGS)
        for k, v in u.items():
            if isinstance(v, dict) and isinstance(s.get(k), dict):
                s[k].update(v)
            else:
                s[k] = v
    except (OSError, ValueError):
        pass
    if not s["user"]["email"]:
        s["user"]["email"] = git_email()
    return s


def save_settings(new):
    cur = load_settings()
    u = new.get("user") or {}
    cur["user"].update({k: u[k] for k in ("name", "email", "zendesk_id") if k in u})
    if "supportal_base" in new:
        b = str(new["supportal_base"]).strip().rstrip("/")
        if not b.startswith(("http://", "https://")):
            raise ValueError("the Supportal address must start with https:// (or http:// for a test server)")
        cur["supportal_base"] = b
    if "statuses" in new:
        st = [x for x in new["statuses"] if x in ("new", "open", "pending", "hold", "solved", "closed")]
        if not st:
            raise ValueError("choose at least one ticket status to list")
        cur["statuses"] = st
    if "per_page" in new:
        cur["per_page"] = max(10, min(100, int(new["per_page"])))
    for k in ("aws_profile", "logs_root"):
        if k in new:
            cur[k] = str(new[k]).strip()
    if cur["logs_root"] and not os.path.isdir(os.path.expanduser(cur["logs_root"])):
        raise ValueError("that logs folder does not exist: %s" % cur["logs_root"])
    _write(SETTINGS, cur)
    return cur
