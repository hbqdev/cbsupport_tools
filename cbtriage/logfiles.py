"""cbtriage log files: what exists on each node, and reading one raw file. Standard library + rg only."""
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor

import core

_INV = {}
_LINES = {}


def _stat(job):
    node, fn, fp = job
    try:
        size = os.path.getsize(fp)
    except OSError:
        return None, None, 0
    if not fn.endswith(".log"):
        return None, None, size
    first, last, _ = core.first_last_ts(fp)
    return first, last, size


def files_inventory(path, refresh=False):
    """{node: {file: {size, first, last}}} for every top-level file on every node (first and last are UTC text)."""
    if path in _INV and not refresh:
        return _INV[path]
    jobs = []
    for nd in core.collection_nodes(path):
        node = core.node_short(nd)
        for fn in sorted(os.listdir(nd)):
            fp = os.path.join(nd, fn)
            if os.path.isfile(fp) and os.path.getsize(fp) > 300:
                jobs.append((node, fn, fp))
    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(_stat, jobs))
    out = {}
    for (node, fn, _), (first, last, size) in zip(jobs, res):
        out.setdefault(node, {})[fn] = {"size": size, "first": core.fmt_ts(first) if first else "", "last": core.fmt_ts(last) if last else ""}
    _INV[path] = out
    return out


def _fp(path, node, file):
    nd = next((d for d in core.collection_nodes(path) if core.node_short(d) == node), None)
    if nd is None:
        raise ValueError("node not found: %s" % node)
    fp = os.path.join(nd, os.path.basename(file))
    if not os.path.isfile(fp):
        raise ValueError("file not found: %s on %s" % (file, node))
    return fp


def _count_lines(fp):
    st = os.stat(fp)
    key = (fp, st.st_size, int(st.st_mtime))
    if key not in _LINES:
        r = subprocess.run(["wc", "-l", fp], capture_output=True, text=True)
        _LINES[key] = int(r.stdout.split()[0]) if r.stdout.strip() else 0
    return _LINES[key]


def read_file(path, node, file, start=1, n=200):
    fp = _fp(path, node, file)
    total = _count_lines(fp)
    start = max(1, min(start, max(1, total)))
    end = start + max(1, min(n, 1000)) - 1
    out = core.sh(["sed", "-n", "%d,%dp;%dq" % (start, end, end), fp])
    return {"node": node, "file": os.path.basename(file), "start": start, "total": total,
            "lines": [l[:2000] for l in out.splitlines()],
            "command": "sed -n '%d,%dp' %s" % (start, end, os.path.basename(file))}


def find_line(path, node, file, expr):
    """The line number of the first line at or after a time (any format core.parse_time_expr reads)."""
    fp = _fp(path, node, file)
    t0 = core.parse_time_expr(expr)[0]
    size = os.path.getsize(fp)
    with open(fp, "rb") as f:
        def ts_from(off):
            f.seek(off)
            if off:
                f.readline()
            pos = f.tell()
            for _ in range(60):
                line = f.readline()
                if not line:
                    return None, pos
                t = core.parse_ts(line.decode("utf-8", "replace"))
                if t is not None:
                    return t, pos
                pos = f.tell()
            return None, pos
        lo, hi = 0, size
        while hi - lo > 65536:
            mid = (lo + hi) // 2
            t, _pos = ts_from(mid)
            if t is None or t >= t0:
                hi = mid
            else:
                lo = mid
        f.seek(lo)
        off = lo
        found = None
        while True:
            pos = f.tell()
            line = f.readline()
            if not line:
                break
            t = core.parse_ts(line.decode("utf-8", "replace"))
            if t is not None and t >= t0:
                found = pos
                break
        if found is None:
            found = max(0, size - 1)
    r = subprocess.run("head -c %d %s | wc -l" % (found, "'" + fp.replace("'", "'\\''") + "'"),
                       shell=True, capture_output=True, text=True)
    return {"line": int(r.stdout.strip() or 0) + 1, "total": _count_lines(fp)}


def grep_file(path, node, file, regex, icase=True, fixed=False, limit=300):
    fp = _fp(path, node, file)
    cmd = ["rg", "-n", "-a", "-m", str(limit), *(["-i"] if icase else []), *(["-F"] if fixed else []), "-e", regex, "--", fp]
    p = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if p.returncode == 2 and p.stderr.strip():
        raise ValueError(" ".join(l.strip() for l in p.stderr.splitlines() if l.strip())[:300])
    rows = []
    for raw in p.stdout.splitlines():
        ln, _, text = raw.partition(":")
        rows.append({"line": int(ln) if ln.isdigit() else 0, "text": text[:600]})
    return {"rows": rows, "truncated": len(rows) >= limit}
