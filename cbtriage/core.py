"""cbtriage core: deterministic log triage for cbcollect_info collections. Standard library + rg only."""
import json
import os
import re
import shlex
import subprocess
import time
from collections import Counter, OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from fnmatch import fnmatch

HERE = os.path.dirname(os.path.abspath(__file__))
ISO_RE = re.compile(r"(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?")
ACC_TS_RE = re.compile(r"\[(\d\d)/(\w{3})/(\d{4}):(\d\d):(\d\d):(\d\d) ([+-]\d{4})\]")
ACC_RE = re.compile(r'^(\S+) - (\S+) \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) (\S+) .*?(\d+)$')
MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
NODE_MARKERS = ("couchbase.log", "diag.log")
KEY_LOGS = ["ns_server.info.log", "ns_server.error.log", "ns_server.debug.log", "ns_server.goxdcr.log",
            "memcached.log", "ns_server.http_access.log", "ns_server.babysitter.log",
            "ns_server.indexer.log", "ns_server.query.log", "ns_server.eventing.log",
            "ns_server.fts.log", "ns_server.analytics_info.log", "ns_server.stats.log"]


def sh(cmd, timeout=120):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, errors="replace")
        return r.stdout
    except Exception as e:  # noqa
        return "ERROR: %s" % e


def q(s):
    return shlex.quote(s)


def parse_ts(line):
    """Return UTC epoch seconds for the first timestamp in the line head, or None."""
    head = line[:140]
    m = ISO_RE.search(head)
    if m:
        y, mo, d, h, mi, s, frac, tz = m.groups()
        dt = datetime(int(y), int(mo), int(d), int(h), int(mi), int(s), tzinfo=timezone.utc)
        t = dt.timestamp() + (float("0." + frac) if frac else 0)
        if tz and tz != "Z":
            sign = 1 if tz[0] == "+" else -1
            t -= sign * (int(tz[1:3]) * 3600 + int(tz[4:6]) * 60)
        return t
    m = ACC_TS_RE.search(line)
    if m:
        d, mon, y, h, mi, s, tz = m.groups()
        dt = datetime(int(y), MONTHS.get(mon, 1), int(d), int(h), int(mi), int(s), tzinfo=timezone.utc)
        sign = 1 if tz[0] == "+" else -1
        return dt.timestamp() - sign * (int(tz[1:3]) * 3600 + int(tz[3:5]) * 60)
    return None


def fmt_ts(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d %H:%M:%S") + "Z" if t else ""


def parse_user_ts(s):
    """Accept 2026-10-03T13:12:43Z, '2026-10-03 13:12:43', or with +02:00 offset. No tz means UTC."""
    s = s.strip().replace(" ", "T")
    if len(s) == 16:
        s += ":00"
    t = parse_ts(s if ISO_RE.search(s) else "")
    if t is None:
        raise ValueError("bad time: %r" % s)
    return t


# ---------------------------------------------------------------- discovery
def safe_path(root, p):
    rp = os.path.realpath(p)
    if not (rp == root or rp.startswith(root + os.sep)):
        raise PermissionError("path outside root")
    return rp


def list_tickets(root):
    out = []
    for n in sorted(os.listdir(root)):
        p = os.path.join(root, n)
        if os.path.isdir(p) and not n.startswith("."):
            out.append(n)
    return out


def find_node_dirs(base, depth=4):
    """Directories under base holding cbcollect content."""
    found = []
    base = os.path.realpath(base)
    for dp, dn, fn in os.walk(base):
        if dp[len(base):].count(os.sep) >= depth:
            dn[:] = []
        if any(m in fn for m in NODE_MARKERS) and any(f.startswith("ns_server.") for f in fn):
            found.append(dp)
            dn[:] = []
    return sorted(found)


def list_collections(root, ticket):
    """Group node dirs by parent folder; each group is a collection (snapshot)."""
    tdir = safe_path(root, os.path.join(root, ticket))
    groups = OrderedDict()
    for nd in find_node_dirs(tdir):
        groups.setdefault(os.path.dirname(nd), []).append(nd)
    out = [{"path": k, "name": os.path.relpath(k, tdir), "nodes": len(v)} for k, v in groups.items()]
    if len(out) > 1:
        n = len(collection_nodes(tdir + "/*"))
        out.insert(0, {"path": tdir + "/*", "name": "(all nodes in ticket, merged)", "nodes": n})
    return out


def node_short(nd):
    b = os.path.basename(nd)
    m = re.match(r"cbcollect_info_ns_1@([^_]+?)(?:\.couchbase[^_]*)?_\d{8}-\d{6}", b)
    if m:
        return m.group(1)
    m = re.match(r"cbcollect_info_ns_1@([^_]+)", b)
    return m.group(1) if m else b


def collection_nodes(path):
    """path ending in '/*' means every node under that ticket folder (deduplicated by node name)."""
    if path.endswith("/*"):
        seen, out = set(), []
        for d in find_node_dirs(path[:-2]):
            if node_short(d) not in seen:
                seen.add(node_short(d))
                out.append(d)
        return out
    return [d for d in find_node_dirs(path) if os.path.dirname(d) == os.path.realpath(path)] or find_node_dirs(path)


# ---------------------------------------------------------------- inventory
def first_last_ts(fp):
    try:
        size = os.path.getsize(fp)
        first = last = None
        with open(fp, "rb") as f:
            head = f.read(131072).decode("utf-8", "replace")
            for ln in head.splitlines():
                t = parse_ts(ln)
                if t:
                    first = t
                    break
            f.seek(max(0, size - 131072))
            tail = f.read().decode("utf-8", "replace").splitlines()
            for ln in reversed(tail):
                t = parse_ts(ln)
                if t:
                    last = t
                    break
        return first, last, size
    except OSError:
        return None, None, 0


def rg_first(pattern, fp, flags=()):
    out = sh(["rg", "-N", "-m1", *flags, pattern, fp])
    return out.strip().splitlines()[0] if out.strip() else ""


def node_inventory(nd):
    name = node_short(nd)
    cl = os.path.join(nd, "couchbase.log")
    inv = {"node": name, "dir": nd, "services": "", "version": "", "os": "", "cpus": "", "uuid": "", "notes": []}
    if os.path.exists(cl):
        pat = r"\{node,'ns_1@%s[^']*',services\},\s*\{\[[a-z0-9_,]*\]" % re.escape(name)
        inv["services_cmd"] = "rg -N -o %s couchbase.log" % q(pat)
        out = sh(["rg", "-N", "-o", pat, cl]).strip()
        m = re.search(r"\{\[([a-z0-9_,]*)\]", out)
        inv["services"] = m.group(1) if m else ""
        if not m:
            inv["notes"].append("services not found in this node's own couchbase.log entry")
        v = rg_first(r"^ii\s+couchbase-server\s+\S+", cl, ("-o",))
        inv["version"] = v.split()[-1] if v else ""
        if not inv["version"]:
            v = rg_first(r"^couchbase-server-(\d[\w.]*-\d+)\.(x86_64|aarch64)", cl, ("-o", "-r", "$1"))
            inv["version"] = v.strip()
        u = rg_first(r"^Linux \S+ \S+ #", cl)
        inv["os"] = u[:120]
        c = rg_first(r"_\w+_\s+\((\d+) CPU\)", cl, ("-o",))
        inv["cpus"] = re.sub(r"\D", "", c.split("(")[-1]) if c else ""
    if not inv["version"]:
        mc = os.path.join(nd, "memcached.log")
        if os.path.exists(mc):
            m = re.search(r'"version":"([^"]+)"', rg_first(r"Couchbase version starting", mc))
            inv["version"] = m.group(1) if m else ""
    logs = []
    for lf in KEY_LOGS:
        fp = os.path.join(nd, lf)
        if os.path.exists(fp) and os.path.getsize(fp) > 0:
            a, b, size = first_last_ts(fp)
            logs.append({"file": lf, "first": fmt_ts(a), "last": fmt_ts(b), "size": size, "a": a, "b": b})
    inv["logs"] = logs
    return inv


def inventory(path):
    nodes = collection_nodes(path)
    with ThreadPoolExecutor(8) as ex:
        invs = list(ex.map(node_inventory, nodes))
    versions = sorted({i["version"] for i in invs if i["version"]})
    return {"path": path, "nodes": invs, "versions": versions}


# ---------------------------------------------------------------- signatures
def load_signatures():
    with open(os.path.join(HERE, "signatures.json")) as f:
        return json.load(f)


def scan_one(args):
    nd, sig = args
    res = []
    for g in sig["files"]:
        for fn in sorted(os.listdir(nd)):
            if not fnmatch(fn, g):
                continue
            fp = os.path.join(nd, fn)
            if not os.path.isfile(fp):
                continue
            cmd = ["rg", "-N", "-a", *sig.get("flags", []), sig["regex"], fp]
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, errors="replace")
            n = 0
            first = last = None
            samples = []
            for ln in p.stdout:
                if "suppressing duplicate log" in ln:
                    continue
                n += 1
                ln = ln.rstrip("\n")
                if first is None:
                    first = ln
                last = ln
                if len(samples) < 3:
                    samples.append(ln[:400])
            p.wait()
            if n:
                res.append({"node": node_short(nd), "file": fn, "count": n,
                            "first": fmt_ts(parse_ts(first)), "last": fmt_ts(parse_ts(last)),
                            "samples": samples,
                            "command": "rg -N -c %s %s" % (q(sig["regex"]), fn)})
    return sig["id"], res


def scan(path, only=None):
    sigs = [s for s in load_signatures() if not only or s["id"] in only]
    nodes = collection_nodes(path)
    jobs = [(nd, s) for nd in nodes for s in sigs]
    agg = {s["id"]: [] for s in sigs}
    with ThreadPoolExecutor(8) as ex:
        for sid, res in ex.map(scan_one, jobs):
            agg[sid].extend(res)
    out = []
    for s in sigs:
        hits = agg[s["id"]]
        if hits:
            out.append({**s, "total": sum(h["count"] for h in hits), "hits": hits})
    order = {"high": 0, "medium": 1, "low": 2, "info": 3}
    out.sort(key=lambda x: (order.get(x["severity"], 9), -x["total"]))
    return {"nodes": len(nodes), "signatures": len(sigs), "findings": out}


# ---------------------------------------------------------------- timeline
def timeline(path, at, window_s, files, regex=None, nodes_filter=None, limit=3000):
    t0, t1 = at - window_s, at + window_s
    rx = re.compile(regex, re.I) if regex else None
    rows = []
    for nd in collection_nodes(path):
        name = node_short(nd)
        if nodes_filter and name not in nodes_filter:
            continue
        for fn in files:
            fp = os.path.join(nd, fn)
            if not os.path.isfile(fp):
                continue
            cur = None
            try:
                f = open(fp, "r", errors="replace")
            except OSError:
                continue
            with f:
                for ln in f:
                    t = parse_ts(ln)
                    if t is not None:
                        cur = t
                    if cur is None or cur < t0 or cur > t1:
                        continue
                    ln = ln.rstrip("\n")
                    if "suppressing duplicate log" in ln:
                        continue
                    if rx and t is not None and not rx.search(ln):
                        continue
                    if t is None:
                        continue  # continuation lines are skipped to keep rows sortable
                    rows.append((cur, name, fn, ln[:600]))
    rows.sort(key=lambda r: r[0])
    truncated = len(rows) > limit
    rows = rows[:limit]
    return {"rows": [{"t": fmt_ts(r[0]), "node": r[1], "file": r[2], "line": r[3]} for r in rows], "truncated": truncated,
            "command": "rg -N -a %s <files> on each node, then sort by timestamp" % q(regex or ".")}


# ---------------------------------------------------------------- access logs
def access(path, pattern=None, group="user", t_from=None, t_to=None):
    rx = re.compile(pattern) if pattern else None
    per_node = {}
    for nd in collection_nodes(path):
        fp = os.path.join(nd, "ns_server.http_access.log")
        if not os.path.isfile(fp):
            continue
        name = node_short(nd)
        cnt = Counter()
        total = 0
        first = last = None
        with open(fp, "r", errors="replace") as f:
            for ln in f:
                if rx and not rx.search(ln):
                    continue
                m = ACC_RE.match(ln)
                if not m:
                    continue
                if t_from or t_to:
                    t = parse_ts(ln)
                    if t is None or (t_from and t < t_from) or (t_to and t > t_to):
                        continue
                cli, user, ts, meth, url, st, size, dur = m.groups()
                url = re.sub(r"\?.*", "", url)
                url = re.sub(r"/\d+", "/N", url)
                if group == "user":
                    k = user
                elif group == "client":
                    k = cli
                elif group == "status":
                    k = st
                elif group == "status_size":
                    k = "%s %s" % (st, size)
                elif group == "endpoint":
                    k = "%s %s" % (meth, url)
                elif group == "user_endpoint":
                    k = "%s %s %s" % (user, meth, url)
                else:
                    k = "all"
                cnt[k] += 1
                total += 1
                if first is None:
                    first = ln.rstrip()[:300]
                last = ln.rstrip()[:300]
        per_node[name] = {"total": total, "top": cnt.most_common(15), "first": first, "last": last}
    cmd = "grep %s ns_server.http_access.log | awk '<field for %s>' | sort | uniq -c | sort -rn" % (
        q(pattern or ""), group)
    return {"nodes": per_node, "command": cmd}


# ---------------------------------------------------------------- search
def search(path, regex, files, nodes_filter=None, ignore_case=True, context=0, limit=300):
    flags = ["-n", "-a"] + (["-i"] if ignore_case else []) + (["-C", str(context)] if context else [])
    out = []
    n = 0
    for nd in collection_nodes(path):
        name = node_short(nd)
        if nodes_filter and name not in nodes_filter:
            continue
        for fn in files:
            fp = os.path.join(nd, fn)
            if not os.path.isfile(fp):
                continue
            txt = sh(["rg", *flags, "--no-heading", regex, fp], timeout=180)
            for ln in txt.splitlines():
                if "suppressing duplicate log" in ln:
                    continue
                out.append({"node": name, "file": fn, "line": ln[:600]})
                n += 1
                if n >= limit:
                    return {"rows": out, "truncated": True, "command": "rg %s %s" % (" ".join(flags), q(regex))}
    return {"rows": out, "truncated": False, "command": "rg %s %s" % (" ".join(flags), q(regex))}


def list_logfiles(path):
    names = Counter()
    for nd in collection_nodes(path):
        for fn in os.listdir(nd):
            if os.path.isfile(os.path.join(nd, fn)) and os.path.getsize(os.path.join(nd, fn)) > 300:
                names[fn] += 1
    return sorted(names)


# ---------------------------------------------------------------- report
def next_version(tdir, stem):
    v = 1
    while os.path.exists(os.path.join(tdir, "%s_v%d.md" % (stem, v))):
        v += 1
    return os.path.join(tdir, "%s_v%d.md" % (stem, v))


def write_report(root, ticket, items, header):
    tdir = safe_path(root, os.path.join(root, ticket))
    fp = next_version(tdir, "triage_report")
    L = ["# Triage report, ticket %s" % ticket, "", "Generated %s by cbtriage (no LLM). %s" % (
        datetime.now().strftime("%Y-%m-%d %H:%M"), header or ""), ""]
    for it in items:
        L += ["## %s" % it.get("title", "Item"), ""]
        if it.get("note"):
            L += [it["note"], ""]
        if it.get("command"):
            L += ["Command%s:" % (" (%s)" % it["where"] if it.get("where") else ""), "```", it["command"], "```", ""]
        if it.get("output"):
            L += ["Output:", "```", it["output"], "```", ""]
    with open(fp, "w") as f:
        f.write("\n".join(L))
    return fp
