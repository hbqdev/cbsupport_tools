"""cbtriage profile: what each node logged and when.
- a cached per-minute index of every log file (fast, built with rg),
- lanes (time x node) from that index,
- moments worth a look (error bursts, a node going quiet),
- a profile of one window: lines folded into patterns with a count per node, rate over time, and level mix.
Standard library + rg only."""
import calendar
import json
import hashlib
import os
import re
import subprocess
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor

import core
import searchx

CACHE_DIR = os.path.join(core.HERE, ".cache")
MAX_ESTIMATE = 2_500_000   # lines in a window with no query before we ask for a narrower window
FILE_CAP = 3_000_000       # lines read per file in a profile
TEMPLATE_FULL = 1_000_000  # beyond this many lines in one file, only every 8th line is folded into patterns
NICE = [1, 2, 5, 10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400]

# ------------------------------------------------------------------ the per-minute index
_ISO_TOTAL = r"^(?:\[[^,\]\s]*,)?(\d{4}-\d\d-\d\d[T ]\d\d:\d\d)"
_ACC_TOTAL = r"\[(\d\d/[A-Za-z]{3}/\d{4}:\d\d:\d\d)"
_T = r"(\d{4}-\d\d-\d\d[T ]\d\d:\d\d)"
_ISO_ERR = r"^\[\w+:(?:error|critical)," + _T + r"|^" + _T + r"[^ ]* (?:ERROR|ERRO|CRITICAL|FATAL)\b|^" + _T + r"[^ ]* \[(?:Error|Fatal)\]"
_ISO_WARN = r"^\[\w+:(?:warn|warning)," + _T + r"|^" + _T + r"[^ ]* (?:WARNING|WARN)\b|^" + _T + r"[^ ]* \[(?:Warn|Warning)\]"


def _epoch_min(s, cache={}):
    v = cache.get(s)
    if v is None:
        try:
            if "/" in s:
                v = calendar.timegm(time.strptime(s, "%d/%b/%Y:%H:%M"))
            else:
                v = calendar.timegm(time.strptime(s.replace(" ", "T"), "%Y-%m-%dT%H:%M"))
        except ValueError:
            v = 0
        cache[s] = v
    return v


def _rg_counter(pattern, fp, extra=()):
    p = subprocess.Popen(["rg", "-N", "-a", "-o", "-r", "$1$2$3", *extra, "-e", pattern, "--", fp],
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, errors="replace")
    c = Counter(p.stdout)
    p.wait()
    return c


def index_file(fp):
    """{epoch_minute: [lines, errors, warnings]} for one file, cached on disk by size and mtime."""
    try:
        st = os.stat(fp)
    except OSError:
        return {}
    os.makedirs(CACHE_DIR, exist_ok=True)
    key = os.path.join(CACHE_DIR, hashlib.sha1(fp.encode()).hexdigest() + ".json")
    try:
        with open(key) as f:
            j = json.load(f)
        if j["size"] == st.st_size and j["mtime"] == int(st.st_mtime) and j.get("v") == 2:
            return {int(k): v for k, v in j["d"].items()}
    except (OSError, ValueError, KeyError):
        pass
    acc = os.path.basename(fp).endswith("http_access.log")
    out = {}
    off = core.file_offset(fp)   # the file writes local times; the index is kept in UTC
    tot = _rg_counter(_ACC_TOTAL if acc else _ISO_TOTAL, fp)
    for s, n in tot.items():
        out[_epoch_min(s.strip()) - off] = [n, 0, 0]
    if not acc:
        for idx, pat in ((1, _ISO_ERR), (2, _ISO_WARN)):
            for s, n in _rg_counter(pat, fp).items():
                s = s.strip()
                if s:
                    out.setdefault(_epoch_min(s) - off, [0, 0, 0])[idx] += n
    out.pop(0, None)
    try:
        with open(key, "w") as f:
            json.dump({"size": st.st_size, "mtime": int(st.st_mtime), "v": 2, "d": out}, f)
    except OSError:
        pass
    return out


_IDX = {}


def index_for(path, globs, nodes_filter=None, gz=False, pick=None):
    """({node: {epoch_minute: [n, e, w]}}, {(node, file): (first_minute, last_minute)}) for the matching files."""
    plan = searchx.resolve_files(path, globs, nodes_filter, gz, pick)
    jobs = [(n, nd, fn) for n, nd, fns in plan for fn in fns]
    key = (path, tuple(nodes_filter or ()), tuple((j[0], j[2]) for j in jobs))
    if key in _IDX:
        return _IDX[key]
    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(lambda j: index_file(os.path.join(j[1], j[2])), jobs))
    nodes, files = {n: {} for n, _, _ in plan}, {}
    for (n, _, fn), d in zip(jobs, res):
        files[(n, fn)] = (min(d), max(d)) if d else None
        tgt = nodes[n]
        for m, v in d.items():
            t = tgt.get(m)
            if t is None:
                tgt[m] = list(v)
            else:
                t[0] += v[0]; t[1] += v[1]; t[2] += v[2]
    _IDX[key] = (nodes, files)
    if len(_IDX) > 12:
        _IDX.pop(next(iter(_IDX)))
    return nodes, files


def _bucket_for(span, target):
    for b in NICE:
        if span / b <= target:
            return b
    return NICE[-1]


def lanes_overview(path, globs, nodes_filter=None, buckets=500, pick=None):
    nodes, _ = index_for(path, globs, nodes_filter, False, pick)
    mins = [m for d in nodes.values() for m in d]
    if not mins:
        return {"min": None, "max": None, "bucket_s": 60, "t0": 0, "nodes": {n: [] for n in nodes}, "total": 0}
    lo, hi = min(mins), max(mins) + 60
    b = max(60, _bucket_for(hi - lo, buckets))
    t0 = lo - lo % b
    nb = int((hi - t0) // b) + 1
    out, total = {}, 0
    for n, d in nodes.items():
        arr = [[0, 0, 0] for _ in range(nb)]
        for m, v in d.items():
            a = arr[int((m - t0) // b)]
            a[0] += v[0]; a[1] += v[1]; a[2] += v[2]; total += v[0]
        out[n] = arr
    return {"min": lo, "max": hi, "bucket_s": b, "t0": t0, "nodes": out, "total": total}


def estimate_lines(nodes, t0, t1):
    return sum(v[0] for d in nodes.values() for m, v in d.items() if t0 - 60 < m <= t1)


def moments(path, globs, nodes_filter=None, pick=None):
    """Places worth a look: bursts of errors, and times a node that was logging went quiet."""
    nodes, _ = index_for(path, globs, nodes_filter, False, pick)
    out = []
    # error bursts: rolling ten minute windows over all nodes
    per = Counter()
    pern = {}
    for n, d in nodes.items():
        for m, v in d.items():
            if v[1]:
                per[m // 600 * 600] += v[1]
                pern.setdefault(m // 600 * 600, Counter())[n] += v[1]
    taken = set()
    for w, c in per.most_common(40):
        if c < 5 or len(taken) >= 5 or any(abs(w - x) <= 1200 for x in taken):
            continue
        taken.add(w)
        top = pern[w].most_common(1)[0]
        out.append({"kind": "errors", "node": top[0], "from": w, "to": w + 600, "n": c,
                    "label": "%d errors in 10 minutes, most on %s" % (c, top[0])})
    # quiet: a gap of at least 15 minutes between two active minutes of one node
    for n, d in nodes.items():
        act = sorted(m for m, v in d.items() if v[0])
        if len(act) < 20:
            continue
        gaps = sorted(((b - a - 60, a + 60, b) for a, b in zip(act, act[1:]) if b - a - 60 >= 900), reverse=True)
        for g, a, b in gaps[:2]:
            out.append({"kind": "quiet", "node": n, "from": a, "to": b, "n": g,
                        "label": "%s logged nothing for %s" % (n, _dur(g))})
    out.sort(key=lambda x: (x["kind"] != "errors", -x["n"]))
    return out[:14]


def _dur(s):
    s = int(s)
    if s < 3600:
        return "%dm" % (s // 60)
    return "%dh%02dm" % (s // 3600, s % 3600 // 60)


# ------------------------------------------------------------------ window profile
LV_RE = re.compile(r"^\[\w+:(\w+),|\b(CRITICAL|FATAL|ERROR|ERRO|WARNING|WARN|INFO|DEBUG|TRACE)\b|\[(Error|Warn|Warning|Info|Debug|Fatal|Verbose)\]", re.I)
TS_RE = re.compile(r"\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:?\d\d)?|\d\d/[A-Za-z]{3}/\d{4}:\d\d:\d\d:\d\d [+-]\d{4}")
D_RE = re.compile(r"\d+")
ID_RE = re.compile(r"\b[0-9a-f]{8,}(?:-[0-9a-f]{4,})*\b", re.I)
_HASDIGIT = re.compile(r"\d").search
_HASLETTER = re.compile(r"[a-f]", re.I).search


def _id_sub(m):
    g = m.group()
    return ID_MARK if (_HASDIGIT(g) and _HASLETTER(g)) else g
TS_MARK, NUM_MARK, ID_MARK = "\u25c7", "\u25c6", "\u25c8"   # a timestamp, a run of digits, a hex id
_LV = {"error": 0, "erro": 0, "critical": 0, "fatal": 0, "warn": 1, "warning": 1, "debug": 3, "trace": 3, "verbose": 3}


def level_of(text):
    m = LV_RE.search(text, 0, 200)
    if not m:
        return 2
    return _LV.get((m.group(1) or m.group(2) or m.group(3)).lower(), 2)


def template_of(text):
    return D_RE.sub(NUM_MARK, ID_RE.sub(_id_sub, TS_RE.sub(TS_MARK, text, count=1)))[:400]


_RX_SPECIAL = set(".^$|?*+()[]{}\\")
_TS_RX = r"(?:\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:?\d\d)?|\d\d/[A-Za-z]{3}/\d{4}:\d\d:\d\d:\d\d [+-]\d{4})"


def template_regex(tpl):
    """An rg regex that matches exactly the lines folded into this pattern."""
    out = ["^"]
    for ch in tpl:
        if ch == TS_MARK:
            out.append(_TS_RX)
        elif ch == ID_MARK:
            if out[-1] != r"[0-9a-fA-F][0-9a-fA-F-]{6,}":
                out.append(r"[0-9a-fA-F][0-9a-fA-F-]{6,}")
        elif ch == NUM_MARK:
            if out[-1] == r"\d+":
                continue
            out.append(r"\d+")
        elif ch in _RX_SPECIAL:
            out.append("\\" + ch)
        else:
            out.append(ch)
    return "".join(out)


time_regex = core.time_regex


def _profile_task(a):
    """Runs in a worker process: one file on one node."""
    (node, nd, fn, pattern, flags, t0, t1, timed, excl_src, icase, nb, bucket_s) = a
    fp = os.path.join(nd, fn)
    excl = [re.compile(x, re.I if icase else 0) for x in excl_src]
    if not pattern:
        off = core.file_offset(fp)
        pattern = time_regex(t0 + off, t1 + off) if timed else "."
    cmd = ["rg", "-n", "-a", *flags, "-e", pattern, "--", fp]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
    span = max(1.0, t1 - t0)
    tpl, hist, lv, lines, capped = {}, {}, [0, 0, 0, 0], 0, False
    other = 0
    for raw in p.stdout:
        ln, _, text = raw.partition(":")
        text = text.rstrip("\n")
        if "suppressing duplicate log" in text:
            continue
        t = core.parse_ts(text)
        if t is None or t < t0 or t > t1:
            continue
        if excl and any(x.search(text) for x in excl):
            continue
        lines += 1
        if lines > FILE_CAP:
            capped = True
            p.kill()
            break
        L = level_of(text)
        lv[L] += 1
        h = hist.get(int((t - t0) // bucket_s))
        if h is None:
            h = hist[int((t - t0) // bucket_s)] = [0, 0, 0]
        h[0] += 1
        if L < 2:
            h[L + 1] += 1
        if lines > TEMPLATE_FULL and lines % 8:
            continue
        k = template_of(text)
        d = tpl.get(k)
        if d is None:
            if len(tpl) >= 20000:
                other += 1
                continue
            d = tpl[k] = {"n": 0, "first": t, "last": t, "lv": [0, 0, 0, 0], "sp": [0] * 32,
                          "sample": text[:700], "lineno": int(ln) if ln.isdigit() else 0}
        d["n"] += 1
        d["lv"][L] += 1
        if t < d["first"]:
            d["first"] = t
        if t > d["last"]:
            d["last"] = t
        d["sp"][min(31, int((t - t0) / span * 32))] += 1
    err = p.stderr.read()
    p.wait()
    if p.returncode == 2 and err.strip() and not lines:
        return {"error": " ".join(l.strip() for l in err.splitlines() if l.strip())[:400]}
    return {"node": node, "file": fn, "lines": lines, "tpl": tpl, "hist": hist, "lv": lv, "capped": capped, "other": other}


_POOL = None


def _pool():
    global _POOL
    if _POOL is None:
        _POOL = ProcessPoolExecutor(max_workers=max(2, min(10, (os.cpu_count() or 4))))
    return _POOL


def profile(path, pattern, globs, nodes_filter=None, opts=None, t_from=None, t_to=None, exclude=None, pick=None):
    o = opts or {}
    plan = searchx.resolve_files(path, globs, nodes_filter, bool(o.get("gz")), pick)
    jobs = [(n, nd, fn) for n, nd, fns in plan for fn in fns]
    if not jobs:
        raise ValueError("no files match %s on the selected nodes" % ", ".join(globs))
    idx, files = index_for(path, globs, nodes_filter, False, pick)
    mins = [m for d in idx.values() for m in d]
    cov = (min(mins), max(mins) + 60) if mins else (0, 0)
    timed = t_from is not None or t_to is not None
    t0 = t_from if t_from is not None else cov[0]
    t1 = t_to if t_to is not None else cov[1]
    if mins and timed:  # a window wider than the logs is shown as the part the logs cover
        t0c, t1c = max(t0, cov[0]), min(t1, cov[1])
        if t1c > t0c:
            t0, t1 = t0c, t1c
    t1 = max(t1, t0 + 1)
    est = estimate_lines(idx, t0, t1)
    base = {"coverage": {"from": cov[0], "to": cov[1]}, "window": {"from": t0, "to": t1}, "estimate": est}
    if not pattern and est > MAX_ESTIMATE:
        base["too_big"] = True
        return base
    bucket_s = _bucket_for(t1 - t0, 260)
    nb = int((t1 - t0) // bucket_s) + 1
    flags = []
    if o.get("icase", True):
        flags.append("-i")
    if o.get("fixed"):
        flags.append("-F")
    if o.get("word"):
        flags.append("-w")
    if o.get("invert"):
        flags.append("-v")
    if o.get("pcre2"):
        flags.append("-P")
    if o.get("gz"):
        flags.append("-z")
    tasks = [(n, nd, fn, pattern, flags, t0, t1, timed, list(exclude or []), o.get("icase", True), nb, bucket_s)
             for n, nd, fns in plan for fn in fns]
    results = list(_pool().map(_profile_task, tasks))
    for r in results:
        if "error" in r:
            raise ValueError(r["error"])
    tpl, lanes = {}, {n: [[0, 0, 0] for _ in range(nb)] for n, _, _ in plan}
    lv, per_node, per_file, capped, other = [0, 0, 0, 0], Counter(), Counter(), False, 0
    for r in results:
        n = r["node"]
        capped = capped or r["capped"]
        other += r["other"]
        per_node[n] += r["lines"]
        per_file[r["file"]] += r["lines"]
        for i in range(4):
            lv[i] += r["lv"][i]
        for b, v in r["hist"].items():
            a = lanes[n][b]
            a[0] += v[0]; a[1] += v[1]; a[2] += v[2]
        for k, d in r["tpl"].items():
            m = tpl.get(k)
            if m is None:
                m = tpl[k] = {"n": 0, "nodes": Counter(), "files": Counter(), "first": d["first"], "last": d["last"],
                              "lv": [0, 0, 0, 0], "sp": [0] * 32, "sample": d["sample"], "node": n, "file": r["file"],
                              "lineno": d["lineno"]}
            m["n"] += d["n"]
            m["nodes"][n] += d["n"]
            m["files"][r["file"]] += d["n"]
            for i in range(4):
                m["lv"][i] += d["lv"][i]
            for i in range(32):
                m["sp"][i] += d["sp"][i]
            if d["first"] < m["first"]:
                m["first"], m["sample"], m["node"], m["file"], m["lineno"] = d["first"], d["sample"], n, r["file"], d["lineno"]
            if d["last"] > m["last"]:
                m["last"] = d["last"]
    pats = []
    for k, m in sorted(tpl.items(), key=lambda kv: -kv[1]["n"])[:400]:
        pats.append({"key": k, "rx": template_regex(k), "n": m["n"], "nodes": dict(m["nodes"]), "files": dict(m["files"]),
                     "first": m["first"], "last": m["last"], "lv": m["lv"], "sp": m["sp"], "sample": m["sample"],
                     "sample_node": m["node"], "sample_file": m["file"], "lineno": m["lineno"]})
    base.update({"bucket_s": bucket_s, "t0": t0, "nb": nb, "lanes": lanes, "patterns": pats, "patterns_total": len(tpl),
                 "lines": sum(per_node.values()), "levels": lv, "per_node": dict(per_node), "per_file": dict(per_file),
                 "nodes": [n for n, _, _ in plan], "capped": capped, "other": other,
                 "sampled": any(v > TEMPLATE_FULL for v in per_file.values())})
    return base
