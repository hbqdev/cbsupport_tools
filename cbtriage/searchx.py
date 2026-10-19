"""cbtriage search workbench: one rg pass over many nodes and files, several views of the same matches.
Standard library + rg only. Views: per-file counts (with zero-hit files and gaps), histogram over time,
repeated lines (masked), capture-group counts, and the matching lines."""
import os
import re
import subprocess
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from fnmatch import fnmatch

import core

DUP = "suppressing duplicate log"
REPEAT_SAMPLE = 100000  # masking costs about 10 us a line, so repeats look at the first N matches per file
BUCKETS = {"1s": 1, "10s": 10, "1m": 60, "10m": 600, "1h": 3600, "1d": 86400}
# shell-side regex that cuts a timestamp to the bucket, for the "equivalent shell" hint (ISO timestamps only)
BUCKET_SHELL = {"1s": r"T[0-9:]{8}", "10s": r"T[0-9:]{7}", "1m": r"T[0-9]{2}:[0-9]{2}",
                "10m": r"T[0-9]{2}:[0-9]", "1h": r"T[0-9]{2}", "1d": r"20[0-9]{2}-[0-9]{2}-[0-9]{2}"}

# fewer passes than one regex per kind: timestamps, node names, ids that contain hex, then every number
MASKS = [
    (re.compile(r"\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)?"), "<ts>"),
    (re.compile(r"ns_1@[\w.\-]+"), "<node>"),
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{12,}\b", re.I), "<id>"),
    (re.compile(r"\d+(?:\.\d+)*"), "N"),
]


def normalize(text):
    """Mask the parts of a line that vary between repeats so identical messages group together."""
    for rx, rep in MASKS:
        text = rx.sub(rep, text)
    return text[:300]


def resolve_files(path, globs, nodes_filter=None, gz=False, pick=None):
    """[(node, dir, [file names])] for every node dir; globs match top-level file names.
    pick, when given, is {node: [file names]} and replaces the globs: exactly those files on exactly those nodes."""
    out = []
    for nd in core.collection_nodes(path):
        name = core.node_short(nd)
        if nodes_filter and name not in nodes_filter:
            continue
        if pick is not None:
            fns = sorted({os.path.basename(f) for f in pick.get(name, []) if os.path.isfile(os.path.join(nd, os.path.basename(f)))})
            if fns:
                out.append((name, nd, fns))
            continue
        fns = []
        for fn in sorted(os.listdir(nd)):
            fp = os.path.join(nd, fn)
            if not os.path.isfile(fp) or os.path.getsize(fp) <= 300:
                continue
            if fn.endswith(".gz") and not gz:
                continue
            if any(fnmatch(fn, g) for g in globs):
                fns.append(fn)
        out.append((name, nd, fns))
    return out


class Agg:
    def __init__(self):
        self.files = {}       # (node, file) -> stats
        self.hist = Counter()  # (epoch second, node) -> n
        self.rep = {}         # normalized -> stats
        self.grp = {}         # capture key -> stats
        self.rows = []        # (t, node, file, lineno, text)
        self.matched = 0
        self.more = False
        self.rep_capped = False
        self.rep_sampled = False

    def merge(self, o):
        self.files.update(o.files)
        self.hist.update(o.hist)
        for src, dst in ((o.rep, self.rep), (o.grp, self.grp)):
            for k, v in src.items():
                d = dst.get(k)
                if d is None:
                    dst[k] = v
                    continue
                d["n"] += v["n"]
                d["nodes"].update(v["nodes"])
                if v["first"] is not None and (d["first"] is None or v["first"] < d["first"]):
                    d["first"] = v["first"]
                if v["last"] is not None and (d["last"] is None or v["last"] > d["last"]):
                    d["last"] = v["last"]
        self.rows.extend(o.rows)
        self.matched += o.matched
        self.more = self.more or o.more
        self.rep_capped = self.rep_capped or o.rep_capped
        self.rep_sampled = self.rep_sampled or o.rep_sampled


def _bump(table, key, node, t, sample=None, cap=None):
    d = table.get(key)
    if d is None:
        if cap is not None and len(table) >= cap:
            return False
        d = table[key] = {"n": 0, "nodes": Counter(), "first": None, "last": None, "sample": sample}
    d["n"] += 1
    d["nodes"][node] += 1
    if t is not None:
        if d["first"] is None or t < d["first"]:
            d["first"] = t
        if d["last"] is None or t > d["last"]:
            d["last"] = t
    return True


def _rg_args(o):
    a = ["rg", "--no-heading", "-n", "-a", "--null", "-H"]
    if o.get("icase", True):
        a.append("-i")
    if o.get("fixed"):
        a.append("-F")
    if o.get("word"):
        a.append("-w")
    if o.get("invert"):
        a.append("-v")
    if o.get("pcre2"):
        a.append("-P")
    if o.get("gz"):
        a.append("-z")
    return a


def shell_command(pattern, o, globs):
    """The rg invocation as a person would type it."""
    flags = ["-N", "-a"] + [f for f, on in (("-i", o.get("icase", True)), ("-F", o.get("fixed")),
                                            ("-w", o.get("word")), ("-v", o.get("invert")),
                                            ("-P", o.get("pcre2")), ("-z", o.get("gz"))) if on]
    return "rg %s %s %s" % (" ".join(flags), core.q(pattern), " ".join(core.q(g) if " " in g else g for g in
                                                                       ["*/" + g for g in globs]))


def _scan_node(node, nd, fns, pattern, o, t_from, t_to, cap_rows, capture_rx, excl):
    ag = Agg()
    for fn in fns:
        ag.files[(node, fn)] = {"n": 0, "first": None, "last": None, "first_line": "", "last_line": "",
                                "gap": 0.0, "gap_at": None, "prev": None, "iv": Counter()}
    if not fns:
        return ag
    cmd = _rg_args(o) + ["-e", pattern, "--"] + [os.path.join(nd, f) for f in fns]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
    timed = t_from is not None or t_to is not None
    prefix = nd + os.sep
    for raw in p.stdout:
        # "<path>\0<lineno>:<text>"
        path, _, rest = raw.partition("\0")
        if not path.startswith(prefix):
            continue
        fn = path[len(prefix):]
        ln, _, text = rest.partition(":")
        text = text.rstrip("\n")
        if DUP in text:
            continue
        if excl and any(x.search(text) for x in excl):
            continue
        t = core.parse_ts(text)
        if timed and (t is None or (t_from is not None and t < t_from) or (t_to is not None and t > t_to)):
            continue
        st = ag.files.get((node, fn))
        if st is None:
            continue
        ag.matched += 1
        st["n"] += 1
        if st["first"] is None:
            st["first"], st["first_line"] = t, text[:300]
        st["last"], st["last_line"] = t if t is not None else st["last"], text[:300]
        if t is not None:
            if st["prev"] is not None:
                dt = t - st["prev"]
                if dt > st["gap"]:
                    st["gap"], st["gap_at"] = dt, st["prev"]
                st["iv"][round(dt) if dt >= 5 else round(dt, 1)] += 1
            st["prev"] = t
            ag.hist[(int(t), node)] += 1
        if st["n"] <= REPEAT_SAMPLE:
            if not _bump(ag.rep, normalize(text), node, t, text[:300], cap=20000):
                ag.rep_capped = True
        else:
            ag.rep_sampled = True
        if capture_rx is not None:
            m = capture_rx.search(text)
            if m and m.groups():
                _bump(ag.grp, " | ".join("" if g is None else g for g in m.groups()), node, t, text[:300], cap=20000)
        if len(ag.rows) < cap_rows:
            ag.rows.append((t, node, fn, int(ln) if ln.isdigit() else 0, text[:600]))
        else:
            ag.more = True
    err = p.stderr.read()
    p.wait()
    if p.returncode == 2 and err.strip():
        raise ValueError(" ".join(l.strip() for l in err.splitlines() if l.strip())[:400])
    return ag


def _median(c):
    n = sum(c.values())
    if not n:
        return None
    acc = 0
    for k in sorted(c):
        acc += c[k]
        if acc * 2 >= n:
            return k


def _auto_bucket(span):
    for name in ("1s", "10s", "1m", "10m", "1h", "1d"):
        if span / BUCKETS[name] <= 240:
            return name
    return "1d"


def _hist_rows(hist, bucket, nodes):
    if not hist:
        return [], bucket
    secs = [k[0] for k in hist]
    lo, hi = min(secs), max(secs)
    if bucket == "auto":
        bucket = _auto_bucket(hi - lo)
    b = BUCKETS[bucket]
    per = {}
    for (s, node), n in hist.items():
        d = per.setdefault(s // b, Counter())
        d[node] += n
    rows = []
    for i in range(lo // b, hi // b + 1):
        c = per.get(i, Counter())
        rows.append({"t": core.fmt_ts(i * b), "total": sum(c.values()), "nodes": dict(c)})
        if len(rows) >= 3000:
            break
    return rows, bucket


def run(path, pattern, globs, nodes_filter=None, opts=None, t_from=None, t_to=None, bucket="auto", rows_cap=500,
        exclude=None, pick=None):
    o = opts or {}
    pattern = pattern or "."  # no pattern means every line, which is how a file's activity is browsed
    excl = []
    for x in exclude or []:
        try:
            excl.append(re.compile(x, re.I if o.get("icase", True) else 0))
        except re.error as e:
            raise ValueError("exclude pattern %r: %s" % (x, e))
    capture_rx = None
    capture_note = ""
    if not o.get("fixed"):
        try:
            capture_rx = re.compile(pattern, re.I if o.get("icase", True) else 0)
            if not capture_rx.groups:
                capture_rx = None
        except re.error as e:
            capture_note = "capture grouping unavailable (Python cannot compile this pattern: %s)" % e
    plan = resolve_files(path, globs, nodes_filter, bool(o.get("gz")), pick)
    if not any(fns for _, _, fns in plan):
        raise ValueError("no files match %s on the selected nodes" % ", ".join(globs))
    agg = Agg()
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(plan)))) as ex:
        futs = [ex.submit(_scan_node, n, nd, fns, pattern, o, t_from, t_to, rows_cap, capture_rx, excl) for n, nd, fns in plan]
        for f in futs:
            agg.merge(f.result())
    nodes = [n for n, _, _ in plan]

    counts = []
    for (node, fn), st in sorted(agg.files.items()):
        nd = next(d for n, d, _ in plan if n == node)
        fl = core.first_last_ts(os.path.join(nd, fn))
        counts.append({"node": node, "file": fn, "n": st["n"], "first": core.fmt_ts(st["first"]),
                       "last": core.fmt_ts(st["last"]), "gap_s": round(st["gap"], 1),
                       "gap_at": core.fmt_ts(st["gap_at"]), "iv": [[k, v] for k, v in st["iv"].most_common(3)],
                       "median_iv": _median(st["iv"]), "first_line": st["first_line"],
                       "last_line": st["last_line"], "log_first": core.fmt_ts(fl[0]), "log_last": core.fmt_ts(fl[1])})
    hist, used = _hist_rows(agg.hist, bucket, nodes)

    def tab(table, top=200):
        out = []
        for k, v in sorted(table.items(), key=lambda kv: -kv[1]["n"])[:top]:
            out.append({"key": k, "n": v["n"], "nodes": dict(v["nodes"]), "first": core.fmt_ts(v["first"]),
                        "last": core.fmt_ts(v["last"]), "sample": v["sample"]})
        return out

    rows = sorted(agg.rows, key=lambda r: (r[0] is None, r[0] or 0, r[1]))[:rows_cap]
    cmd = shell_command(pattern, o, globs)
    hint = BUCKET_SHELL.get(used)
    return {
        "command": cmd,
        "pipelines": {
            "counts": cmd.replace("rg -N", "rg -N -c", 1) + "   # per-file counts",
            "histogram": (cmd + " | rg -o '%s' | sort | uniq -c" % hint) if hint else "",
            "repeats": cmd + " | sed -E 's/20[0-9-]+T[0-9:.]+(Z|[+-][0-9:]+)?//g; s/[0-9]+/N/g' | sort | uniq -c | sort -rn | head -30   # approximate masking",
        },
        "matched": agg.matched, "nodes": nodes, "bucket": used,
        "counts": counts, "histogram": hist,
        "repeats": tab(agg.rep), "repeats_capped": agg.rep_capped, "repeats_sampled": agg.rep_sampled, "repeat_sample": REPEAT_SAMPLE,
        "groups": tab(agg.grp), "capture_note": capture_note, "has_groups": capture_rx is not None,
        "rows": [{"t": core.fmt_ts(r[0]), "node": r[1], "file": r[2], "lineno": r[3], "line": r[4]} for r in rows],
        "rows_truncated": agg.more or agg.matched > len(rows),
        "excluded": "lines containing 'suppressing duplicate log' are left out of every count",
    }


def context(path, node, file, lineno, before=5, after=5):
    """The lines around one line of one file on one node, as plain text (what `sed -n 'A,Bp' file` prints)."""
    nd = next((d for d in core.collection_nodes(path) if core.node_short(d) == node), None)
    if nd is None:
        raise ValueError("node not found: %s" % node)
    fp = os.path.join(nd, os.path.basename(file))
    if not os.path.isfile(fp):
        raise ValueError("file not found: %s" % file)
    a, b = max(1, lineno - before), lineno + after
    out = core.sh(["sed", "-n", "%d,%dp;%dq" % (a, b, b), fp])
    return {"start": a, "target": lineno, "lines": [l[:1500] for l in out.splitlines()],
            "command": "sed -n '%d,%dp' %s" % (a, b, os.path.basename(file))}
