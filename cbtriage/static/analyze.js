// Analysis: one page that reads top to bottom. When it happened, what was logged, the lines. Everything is clickable.
(function () {
const X = { spec: null, q: { rx: "", excl: [], icase: true, fixed: false, pcre2: false }, prof: null, res: null, sxKey: "", over: null, win: null, drill: null, rows: 500, sel: new Set(), last: null,
  tokens: null, anat: null, acts: [], err: "", lv: [true, true, true, true], uneven: false, sort: "n", pf: "", busy: false, countsOpen: false, prevPick: null };
const effRx = () => (X.drill ? X.drill.rx : X.q.rx);
const drillPick = () => { if (X.drill && X.drill.node) { const e = effPick(); return JSON.stringify(e[X.drill.node] ? { [X.drill.node]: e[X.drill.node] } : {}); } return pickParam(); };
const humanRx = key => { const segs = String(key).split(/[\u25c7\u25c6\u25c8]+/).map(s => s.trim()).filter(s => s.length >= 4); if (!segs.length) return ""; const keep = segs.map((s, i) => [s.length, i]).sort((x, y) => y[0] - x[0]).slice(0, 2).sort((x, y) => x[1] - y[1]).map(x => segs[x[1]]); return keep.map(s => rxEsc(s.length > 70 ? s.slice(0, 70) : s)).join(".*"); };
const hasCapture = rx => /\((?!\?)/.test(rx || "");
let seq = 0;

window.analyzeReset = () => { X.spec = null; X.prof = X.res = X.over = X.win = X.drill = X.prevPick = null; X.sel.clear(); X.err = ""; X.sxKey = ""; };
window.startAnalysis = spec => {
  X.spec = spec; X.q = { rx: spec.rx || "", excl: [], icase: true, fixed: !!spec.fixed, pcre2: !!spec.pcre2 };
  X.drill = null; X.prof = X.res = X.over = null; X.sxKey = ""; X.sel.clear(); X.rows = 500; X.lv = [true, true, true, true]; X.uneven = false; X.sort = spec.sort || "n"; X.pf = ""; X.err = "";
  X.countsOpen = !!spec.counts; X.prevPick = null; X.lopen = false; X.tall = false;
  if (spec.files) { X.prevPick = JSON.parse(JSON.stringify(S.pick)); if (!setPickByNames(spec.files, false)) { X.prevPick = null; toast("None of those log files are in this collection, so your own selection is used"); } }
  if (spec.time) S.range = spec.time;
  S.hasAnalysis = true; S.narrowed = !!X.prevPick; go("analyze");
};
HOOKS.analyze = () => { X.over = null; X.drill = null; run(); };

const params = extra => Object.assign({ path: S.path, regex: effRx(), pick: drillPick(), time: S.range, bucket: "auto", icase: X.q.icase ? 1 : 0, fixed: X.q.fixed && !X.drill ? 1 : 0,
  pcre2: X.q.pcre2 && !X.drill ? 1 : 0, exclude: X.q.excl.join("\n"), rows: X.rows }, extra || {});
const profParams = () => ({ path: S.path, regex: X.q.rx, pick: pickParam(), time: S.range, icase: X.q.icase ? 1 : 0, fixed: X.q.fixed ? 1 : 0, pcre2: X.q.pcre2 ? 1 : 0, exclude: X.q.excl.join("\n") });

// ------------------------------------------------------------------ the page
PAGES.analyze = function () {
  if (!X.spec) { go("questions"); return; }
  $("#page").innerHTML = `<div class="wrap wide">
    <div class="crumb"><a id="bk">&lsaquo; Back to the questions</a></div>
    <div class="row sp" style="align-items:flex-start"><div class="grow"><h1 id="atitle"></h1><p class="lead" id="adesc" style="margin-bottom:14px"></p></div><button class="btn" id="qmenu" data-pop>Ask something else</button></div>
    <div id="afilters"></div><div id="aglance"></div><nav class="subnav" id="subnav"></nav>
    <section class="card sect" id="s-when"><div class="sech"><div><h2><span class="step">1</span>When it happened</h2><p class="cap" id="cap-when"></p></div><div class="row" id="wnav"></div></div><div id="when-body"></div></section>
    <section class="card sect" id="s-what"><div class="sech"><div><h2><span class="step">2</span>What was logged</h2><p class="cap">Lines that only differ in numbers, ids or times are grouped. Each number is how many lines that node logged. <b>Click a group to read its lines</b>, or a node's number to read just that node's.</p></div></div><div id="what-body"></div></section>
    <section class="card sect" id="s-counts" style="display:none"><div class="sech"><div><h2>Counts by value</h2><p class="cap">How many lines have each value of the part you chose, on each node.</p></div></div><div id="counts-body"></div></section>
    <section class="card sect" id="s-rate" style="display:none"><div class="sech"><div><h2>How often it repeats</h2><p class="cap">The usual gap between matching lines on each node. One dominant gap usually means a timer or a retry loop.</p></div></div><div id="rate-body"></div></section>
    </div><div id="lpanel" class="lpanel" style="display:none"></div><div id="xdrawer"></div><div id="tip"></div>`;
  $("#bk").onclick = () => go("questions");
  $("#qmenu").onclick = e => questionsPop(e.currentTarget);
  drawHead(); drawFilters(); drawGlance(); drawWhen(); drawWhat(); drawLinesSection(); drawExtra();
  if (!X.prof && !X.busy) run();
};
function questionsPop(a) {
  const qs = (window.questionList ? window.questionList() : []).filter(q => q.files.some(f => Object.values(S.fileMap || {}).some(m => m[f])));
  pop(a, `<h3>Ask something else</h3><div class="col" style="margin-top:10px;gap:4px">${qs.map((q, i) => `<a class="btn quiet" style="justify-content:flex-start" data-q="${i}">${esc(q.title)}</a>`).join("")}<a class="btn quiet" style="justify-content:flex-start" data-q="home">All questions &rsaquo;</a></div>`, p => {
    p.querySelectorAll("[data-q]").forEach(x => x.onclick = () => { popClose(); if (x.dataset.q === "home") return go("questions"); startAnalysis(Object.assign({}, qs[+x.dataset.q])); });
  });
}
function drawHead() {
  $("#atitle").textContent = X.spec.title; const ps = pickSummary();
  $("#adesc").innerHTML = `${esc(X.spec.desc || "")} ${X.spec.extra ? `<span class="hint">Also worth opening (the tool cannot search these yet): ${esc(X.spec.extra)}.</span>` : ""} ${X.prevPick ? `<span class="hint">Reading ${esc(pickFiles().join(", "))} on ${ps.nodes} nodes for this question. <a id="usemine">Use my own log file selection instead</a></span>` : ""}`;
  const u = $("#usemine"); if (u) u.onclick = () => { S.pick = X.prevPick; X.prevPick = null; S.narrowed = false; scopeChanged(); };
}
function drawFilters() {
  const el = $("#afilters"); if (!el) return; const q = X.q, nodes = Object.keys(S.pick).length ? dnodes().filter(n => S.pick[n] && S.pick[n].length) : [];
  el.innerHTML = `<div class="card tight"><div style="margin-bottom:6px"><b>Search for</b> <span class="hint">The question came with this pattern. Edit it, or type your own text, then press Enter.</span></div><div class="row" style="gap:10px"><input id="xq" class="grow mono" autocomplete="off" spellcheck="false" placeholder="Narrow down: type text or a regular expression, then press Enter" value="${esc(q.rx)}">
    <button class="btn primary" id="xgo">${X.busy ? "Working..." : "Search"}</button>
    <label class="hint"><input type="checkbox" id="ifx" ${q.fixed ? "checked" : ""}> plain text</label><label class="hint"><input type="checkbox" id="iic" ${q.icase ? "checked" : ""}> ignore case</label></div>
    <div class="row" style="margin-top:12px;gap:8px"><span class="hint">Nodes</span>${nodes.map(n => `<span class="chip ${S.nodesOff.has(n) ? "off" : "on"}" data-nd="${esc(n)}" title="Click to leave this node out or put it back">${dot(n)}${esc(nshort(n))} <span class="hint" style="color:inherit;opacity:.7">${esc(nodeServices(n).split(/[ ,]+/)[0] || "")}</span></span>`).join("")}
      ${X.drill ? `<span class="chip on" id="cdr" title="${esc(tplText(X.drill.label))}">Reading only: ${esc(tplText(X.drill.label).slice(0, 56))}${X.drill.node ? " on " + esc(nshort(X.drill.node)) : ""} <span class="x">&times;</span></span>` : ""}
      ${q.excl.map((x, i) => `<span class="chip ex" title="Lines like this are left out">leaving out ${esc(x.length > 30 ? x.slice(0, 30) + "..." : x)} <span class="x" data-ex="${i}">&times;</span></span>`).join("")}
      <span class="chip" id="ccm" data-pop>Show command</span></div></div>`;
  const go_ = () => { q.rx = $("#xq").value; q.fixed = $("#ifx").checked; q.icase = $("#iic").checked; X.drill = null; X.countsOpen = hasCapture(q.rx) || X.countsOpen; run(); };
  $("#xq").onkeydown = e => { if (e.key === "Enter") go_(); }; $("#xgo").onclick = go_;
  $("#ifx").onchange = go_; $("#iic").onchange = go_;
  $$("#afilters [data-nd]").forEach(c => c.onclick = () => { const n = c.dataset.nd; if (!S.nodesOff.has(n) && nodes.filter(x => !S.nodesOff.has(x)).length <= 1) { toast("Keep at least one node"); return; } S.nodesOff.has(n) ? S.nodesOff.delete(n) : S.nodesOff.add(n); scopeChanged(); });
  const cd = $("#cdr"); if (cd) cd.onclick = () => { X.drill = null; X.res = null; X.sxKey = ""; drawFilters(); drawWhat(); drawLinesSection(); if (X.lopen) ensureSx(seq); drawExtra(); };
  $$("#afilters [data-ex]").forEach(x => x.onclick = e => { e.stopPropagation(); q.excl.splice(+x.dataset.ex, 1); run(); });
  $("#ccm").onclick = e => cmdPop(e.currentTarget);
}
function cmdPop(a) {
  const c = cmdFor(pickFiles().join(" ") || "<files>");
  pop(a, `<h3>The same search as a command</h3><div class="cap" style="margin:4px 0 8px">Run it inside a node's cbcollect folder. It covers the text you typed, the files you picked and any time range.</div><pre style="max-height:200px">${esc(c)}</pre><div class="row"><button class="btn primary" id="xcpc">Copy command</button></div>`, () => { $("#xcpc").onclick = () => { popClose(); copyText(c, "Copied command"); }; });
}
function drawGlance() {
  const el = $("#aglance"), p = X.prof; if (!el) return;
  if (!p || p.too_big || !p.lines) { el.innerHTML = ""; $("#subnav").innerHTML = ""; return; }
  const first = Math.min(...p.patterns.map(x => x.first)), last = Math.max(...p.patterns.map(x => x.last)), hit = Object.entries(p.per_node).filter(([, n]) => n > 0).map(([n]) => n);
  el.innerHTML = `<div class="glance"><div class="g"><span>Lines found</span><b>${p.lines.toLocaleString()}</b><small>${(p.patterns_total || 0).toLocaleString()} different kinds</small></div>
    <div class="g"><span>On nodes</span><b>${hit.length} of ${p.nodes.length}</b><small>${esc(hit.map(nshort).join(" "))}</small></div>
    <div class="g"><span>First</span><b class="tc mono" style="font-size:15px" data-t="${esc(fromEpoch(first) + "Z")}">${esc(fromEpoch(first).slice(5))}</b><small>UTC</small></div>
    <div class="g"><span>Last</span><b class="tc mono" style="font-size:15px" data-t="${esc(fromEpoch(last) + "Z")}">${esc(fromEpoch(last).slice(5))}</b><small>UTC</small></div>
    <div class="g"><span>Errors</span><b class="${p.levels[0] ? "bad" : ""}">${p.levels[0].toLocaleString()}</b><small>${p.levels[1].toLocaleString()} warnings</small></div></div>`;
  $("#subnav").innerHTML = [["s-when", "When it happened"], ["s-what", "What was logged"], ["lp", "The lines"], ["s-counts", "Counts by value"], ["s-rate", "How often"]].filter(([id]) => id === "lp" || $("#" + id).style.display !== "none").map(([id, l]) => `<span class="chip" data-go="${id}">${l}</span>`).join("");
  $$("#subnav [data-go]").forEach(c => c.onclick = () => { if (c.dataset.go === "lp") { X.lopen = true; drawLinesSection(); ensureSx(seq); return; } $("#" + c.dataset.go).scrollIntoView({ behavior: "smooth", block: "start" }); });
  if (window._io) window._io.disconnect();
  window._io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) $$("#subnav .chip").forEach(c => c.classList.toggle("on", c.dataset.go === e.target.id)); }), { rootMargin: "-150px 0px -60% 0px" });
  ["s-when", "s-what", "s-counts", "s-rate"].forEach(id => { const el = $("#" + id); if (el && el.style.display !== "none") window._io.observe(el); });
  $$("#aglance [data-t]").forEach(c => c.onclick = e => zoomPop(c, c.dataset.t));
}
const tplText = k => String(k).replace(/◇/g, "<time>").replace(/◆/g, "<n>").replace(/◈/g, "<id>");
const tplHtml = k => esc(k).replace(/◇/g, '<i class="mk">time</i>').replace(/◆/g, '<i class="mk">#</i>').replace(/◈/g, '<i class="mk">id</i>');
const msgBig = p => `<div class="empty"><b>This is too much to show at once.</b><div class="hint" style="margin:6px 0">About ${p.estimate.toLocaleString()} lines. Drag across the bar in "When it happened" to pick a time range, or type something above to narrow it down.</div></div>`;

// ------------------------------------------------------------------ when it happened: the whole log, then one row per node
function curWin() { const w = X.prof && X.prof.window; if (w && S.range) return [w.from, w.to]; const o = X.over; return o && o.min ? [o.min, o.max] : null; }
function setWin(a, b) { const o = X.over; if (o && o.min) { a = Math.max(a, o.min - 3600); b = Math.min(b, o.max + 3600); } if (b - a < 1) b = a + 1; S.range = `${fromEpoch(a)} to ${fromEpoch(b - 1)}`; X.drill = null; popClose(); scopeChanged(); }
function navWin(k) {
  const w = curWin(); if (!w) return; const span = w[1] - w[0], mid = (w[0] + w[1]) / 2;
  if (k === "reset") { S.range = ""; scopeChanged(); return; }
  if (k === "left") return setWin(w[0] - span / 2, w[1] - span / 2); if (k === "right") return setWin(w[0] + span / 2, w[1] + span / 2);
  if (k === "out") return setWin(mid - span, mid + span); if (k === "in") return setWin(mid - span / 4, mid + span / 4);
}
function drawWhen() {
  const el = $("#when-body"), p = X.prof, o = X.over; if (!el) return;
  $("#cap-when").innerHTML = "The top bar is the whole log. The rows below are the time range you are looking at, one row per node: <i class=\"sw\" style=\"background:var(--bad);margin-left:0\"></i>errors <i class=\"sw\" style=\"background:var(--warn)\"></i>warnings <i class=\"sw\" style=\"background:var(--bar)\"></i>other lines, hatched means nothing was logged. <b>Drag across either to zoom in.</b>";
  $("#wnav").innerHTML = o && o.min ? `<button class="btn sm" data-nav="left" title="Earlier">&lsaquo; Earlier</button><button class="btn sm" data-nav="out">Zoom out</button><button class="btn sm" data-nav="in">Zoom in</button><button class="btn sm" data-nav="right" title="Later">Later &rsaquo;</button><button class="btn sm" data-nav="reset">Whole log</button>` : "";
  $$("#wnav [data-nav]").forEach(b => b.onclick = () => navWin(b.dataset.nav));
  if (!o) { el.innerHTML = '<div class="spin">Reading every node once to draw this. A few seconds the first time, then it is remembered.</div>'; return; }
  if (!o.min) { el.innerHTML = '<div class="empty">The log files you picked have no timestamped lines. Pick others on the Log files screen.</div>'; return; }
  const W = curWin(), nb = o.nodes[Object.keys(o.nodes)[0]].length, tot = new Array(nb).fill(0), err = new Array(nb).fill(0);
  Object.values(o.nodes).forEach(arr => arr.forEach((v, i) => { tot[i] += v[0]; err[i] += v[1]; }));
  const mx = Math.max(1, ...tot), H = 38, lg = n => Math.log1p(n) / Math.log1p(mx), px = t => (t - o.t0) / o.bucket_s;
  const bars = tot.map((n, i) => n ? `<rect x="${i}" y="${(H - H * lg(n)).toFixed(1)}" width="1" height="${(H * lg(n)).toFixed(1)}" fill="var(--bar)"/>` : "").join("") +
    err.map((n, i) => n ? `<rect x="${i}" y="${(H - H * lg(tot[i]) * Math.min(1, n / tot[i])).toFixed(1)}" width="1" height="${(H * lg(tot[i]) * Math.min(1, n / tot[i])).toFixed(1)}" fill="var(--bad)"/>` : "").join("");
  const sel = S.range && W && (W[1] - W[0]) < 0.97 * (o.max - o.min) ? `<rect class="win" x="${px(W[0]).toFixed(2)}" y="0" width="${Math.max(0.6, px(W[1]) - px(W[0])).toFixed(2)}" height="${H}"/>` : "";
  el.innerHTML = `<div class="hint" style="margin-bottom:4px">Whole log: ${esc(fromEpoch(o.min).slice(0, 16))} to ${esc(fromEpoch(o.max).slice(0, 16))} UTC</div>
    <svg id="mini" viewBox="0 0 ${nb} ${H}" preserveAspectRatio="none" class="mini">${bars}${sel}<rect class="brush" y="0" height="${H}" width="0" x="0"/></svg>
    ${p && p.too_big ? msgBig(p) : p && p.lanes && p.lines ? lanesHtml(p) : p && !p.lines ? '<div class="empty">No lines in this range.</div>' : '<div class="spin">Looking at every node...</div>'}`;
  bindBrush($("#mini"), nb, i => o.t0 + i * o.bucket_s, o.bucket_s, (a, b) => setWin(a, b), t => zoomPop($("#mini"), fromEpoch(t) + "Z"));
  if (p && !p.too_big && p.lanes && p.lines) bindLanes(p);
}

const V = Object.assign({ wrap: true, short: false, copyShort: false, compact: false }, (() => { try { return JSON.parse(localStorage.getItem("cbt_view") || "{}"); } catch (e) { return {}; } })());
const saveV = () => { try { localStorage.setItem("cbt_view", JSON.stringify(V)); } catch (e) {} };
let shortCache = null;
function shortInfo() {
  const names = dnodes(); if (shortCache && shortCache.key === names.join()) return shortCache.v;
  let v = null; const ms = names.map(n => n.split(".")[0].match(/^(.*-)(\d{2,5})$/));
  if (names.length && ms.every(m => m) && new Set(ms.map(m => m[1])).size === 1) {
    const pre = rxEsc(ms[0][1]);
    v = { re: new RegExp("(?:ns_1@)?" + pre + "(\\d{2,5})(?:\\.[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?", "g"), sed: "sed -E 's/(ns_1@)?" + pre + "([0-9]{2,5})(\\.[A-Za-z0-9]+([.-][A-Za-z0-9]+)*)?/\\2/g'" };
  }
  shortCache = { key: names.join(), v }; return v;
}
const disp = t => { const s = V.short && shortInfo(); return s ? t.replace(s.re, "$1") : t; };
const outText = t => { const s = V.copyShort && shortInfo(); return s ? t.replace(s.re, "$1") : t; };


function groupRows(rows) { const m = new Map(); rows.forEach(x => { const k = x.node + "\0" + x.file; if (!m.has(k)) m.set(k, { node: x.node, file: x.file, lines: [] }); m.get(k).lines.push(x.line); }); return [...m.values()]; }
const evItems = rows => groupRows(rows).map(g => ({ label: `${nshort(g.node)}, ${g.file}`, command: cmdFor(g.file), output: g.lines.map(outText).join("\n") }));
const copyLines = rows => copyText(rows.map(x => outText(x.line)).join("\n"), `Copied ${rows.length} line${rows.length > 1 ? "s" : ""}`);
const copyBlock = rows => copyText(evItems(rows).map(it => evidenceText(it)).join("\n\n"), `Copied ${rows.length} line${rows.length > 1 ? "s" : ""} with the command`);



function bindBrush(svg, nb, tAt, bs, onRange, onClick) {
  let a0 = null; const sel = svg.querySelector(".brush");
  const idx = e => { const r = svg.getBoundingClientRect(); return Math.max(0, Math.min(nb - 1, Math.floor((e.clientX - r.left) / r.width * nb))); };
  const paint = (i0, i1) => { sel.setAttribute("x", Math.min(i0, i1)); sel.setAttribute("width", Math.abs(i1 - i0) + 1); };
  svg.onmousedown = e => { a0 = idx(e); paint(a0, a0); e.preventDefault(); };
  svg.onmousemove = e => { if (a0 !== null) paint(a0, idx(e)); };
  const up = e => { if (a0 === null) return; const i1 = idx(e), lo = Math.min(a0, i1), hi = Math.max(a0, i1); const was = a0; a0 = null; sel.setAttribute("width", 0);
    if (lo === hi && onClick && !e.shiftKey) onClick(tAt(lo)); else onRange(tAt(lo), tAt(hi + 1)); };
  svg.addEventListener("mousedown", () => window.addEventListener("mouseup", up, { once: true }));
}
function lanesHtml(p) {
  let mx = 1; Object.values(p.lanes).forEach(a => a.forEach(v => { if (v[0] > mx) mx = v[0]; }));
  const lg = n => 0.2 + 0.8 * Math.log1p(n) / Math.log1p(mx);
  const rows = p.nodes.map(n => { const a = p.lanes[n], tot = a.reduce((s, v) => s + v[0], 0), er = a.reduce((s, v) => s + v[1], 0);
    const rects = a.map((v, i) => v[0] ? `<rect x="${i}" y="0" width="1" height="1" fill="${v[1] ? "var(--bad)" : v[2] ? "var(--warn)" : "var(--bar)"}" opacity="${lg(v[0]).toFixed(2)}"/>` : "").join("");
    return `<div class="lane"><span class="ll" data-solo="${esc(n)}" title="Click to look at this node only">${dot(n)}<span class="mono">${esc(nshort(n))}</span></span>
      <svg class="ls" data-n="${esc(n)}" viewBox="0 0 ${p.nb} 1" preserveAspectRatio="none">${rects}<rect class="brush" y="0" height="1" width="0" x="0"/></svg>
      <span class="lc">${tot ? compact(tot) : '<i class="mut">none</i>'}${er ? ` <b class="bad">${compact(er)}</b>` : ""}</span></div>`; }).join("");
  const span = p.window.to - p.window.from, ticks = 6;
  const fmt = t => { const s = fromEpoch(t); return span < 6 * 3600 ? s.slice(11) : span < 3 * 86400 ? s.slice(5, 16) : s.slice(5, 13) + "h"; };
  const ax = Array.from({ length: ticks + 1 }, (_, i) => `<span style="left:${(i / ticks * 100).toFixed(1)}%">${esc(fmt(p.t0 + i / ticks * p.nb * p.bucket_s))}</span>`).join("");
  return `<div class="lanes" id="lanes">${rows}<div class="axis">${ax}</div></div>`;
}
function bindLanes(p) {
  const tip = $("#tip");
  $$("#lanes .ls").forEach(svg => {
    const n = svg.dataset.n, a = p.lanes[n], idx = e => { const r = svg.getBoundingClientRect(); return Math.max(0, Math.min(p.nb - 1, Math.floor((e.clientX - r.left) / r.width * p.nb))); };
    bindBrush(svg, p.nb, i => p.t0 + i * p.bucket_s, p.bucket_s, (x, y) => setWin(x, y), t => zoomPop(svg, fromEpoch(t)));
    svg.addEventListener("mousemove", e => { const i = idx(e), v = a[i]; tip.style.display = "block"; tip.style.left = e.clientX + 12 + "px"; tip.style.top = e.clientY + 14 + "px";
      tip.innerHTML = `<b>${esc(nshort(n))}</b> ${esc(fromEpoch(p.t0 + i * p.bucket_s).slice(5))}<br>${v[0].toLocaleString()} lines${v[1] ? `, <span class="bad">${v[1]} errors</span>` : ""}${v[2] ? `, ${v[2]} warnings` : ""}`; });
    svg.addEventListener("mouseleave", () => { tip.style.display = "none"; });
  });
  $$("#lanes [data-solo]").forEach(l => l.onclick = () => { const n = l.dataset.solo, all = p.nodes, solo = all.every(x => x === n || S.nodesOff.has(x)); S.nodesOff.clear(); if (!solo) all.forEach(x => { if (x !== n) S.nodesOff.add(x); }); scopeChanged(); });
}




// ------------------------------------------------------------------ commands for the reply
function cmdFor(files) {
  const q = X.q, fl = ["-a", "-N"]; if (q.icase) fl.push("-i"); if (q.fixed && !X.drill) fl.push("-F"); if (q.pcre2 && !X.drill && !(X.drill && X.drill.human)) fl.push("-P");
  let c = `rg ${fl.join(" ")} ${shq((X.drill && X.drill.human) || effRx() || ".")} ${files}`;
  const w = X.win; if (w && w.iso_prefix) c += ` | rg -a -N ${shq(w.iso_prefix)}`;
  q.excl.forEach(x => (c += ` | rg -v -a -N ${shq(x)}`));
  if (V.copyShort && shortInfo()) c += " | " + shortInfo().sed;
  return c;
}
const cmdAll = () => cmdFor(pickFiles().join(" ") || "<files>");

// ------------------------------------------------------------------ running it
async function run() {
  if (S.page !== "analyze" || !X.spec) return;
  const my = ++seq; X.err = ""; X.sel.clear(); X.res = null; X.sxKey = ""; X.busy = true; X.acts = [];
  document.body.classList.add("loading"); drawFilters();
  if (!X.prof) { drawWhat(); drawWhen(); }   // first load only: show what is coming; afterwards the old view stays until the new one is ready
  drawLinesSection();
  try {
    const [p, o] = await Promise.all([api("/api/profile", profParams()), X.over ? Promise.resolve(X.over) : api("/api/lanes", { path: S.path, pick: pickParam() })]);
    if (my !== seq) return; X.prof = p; X.over = o; X.busy = false; X.win = { iso_prefix: p.iso_prefix };
    X.lopen = X.lopen && !p.too_big ? X.lopen : (!p.too_big && p.lines > 0 && p.lines <= 300);
    keepScroll(() => { drawFilters(); drawGlance(); drawWhen(); drawWhat(); });
    const auto = !p.too_big && p.lines > 0 && (X.lopen || X.spec.counts || X.countsOpen || hasCapture(X.q.rx));
    if (auto) await ensureSx(my); else keepScroll(() => { drawLinesSection(); drawExtra(); });
  } catch (e) { if (my !== seq) return; X.prof = null; X.busy = false; X.err = e.message; drawFilters(); drawWhen(); drawWhat(); drawLinesSection(); }
  finally { if (my === seq) document.body.classList.remove("loading"); }
}
async function ensureSx(my) {
  if (X.prof && X.prof.too_big) return;
  const key = JSON.stringify(params());
  if (X.res && X.sxKey === key) { drawLinesSection(); drawExtra(); return; }
  X.res = null; X.sxBusy = true; drawLinesSection();
  try { const r = await api("/api/sx", params()); if (my !== undefined && my !== seq) return; X.res = r; X.sxKey = key; if (r.window) X.win = r.window; X.sel.clear(); }
  catch (e) { X.err = e.message; }
  X.sxBusy = false; keepScroll(() => { drawLinesSection(); drawExtra(); });
}
function wire(root) {
  root.querySelectorAll("[data-t]").forEach(c => c.onclick = e => { e.stopPropagation(); zoomPop(c, c.dataset.t); });
  root.querySelectorAll("[data-line]").forEach(c => c.onclick = e => { e.stopPropagation(); anatomy(JSON.parse(c.dataset.line)); });
  root.querySelectorAll("[data-act]").forEach(b => b.onclick = () => X.acts[+b.dataset.act]());
}

// ------------------------------------------------------------------ the three sections
function drawWhat() {
  const el = $("#what-body"), p = X.prof; if (!el) return;
  if (X.err) { el.innerHTML = `<div class="err"><b>Could not finish.</b> ${esc(String(X.err).replace(/^ValueError: /, ""))}</div>`; return; }
  if (!p) { el.innerHTML = '<div class="spin">Looking at every node in parallel...</div>'; return; }
  if (p.too_big) { el.innerHTML = msgBig(p); return; }
  if (!p.lines) {
    const cov = p.coverage;
    el.innerHTML = `<div class="empty"><b>No lines matched.</b><div class="hint" style="margin:6px 0 14px">${X.q.rx ? `Nothing matches <code>${esc(X.q.rx)}</code>` : "Nothing was logged"}${S.range ? ` between ${esc(fromEpoch(p.window.from))} and ${esc(fromEpoch(p.window.to))} UTC` : ""} in the ${pickSummary().files} log files you picked.${cov && cov.from ? ` They cover ${esc(fromEpoch(cov.from))} to ${esc(fromEpoch(cov.to))} UTC.` : ""}</div>
      <div class="row" style="justify-content:center"><button class="btn" id="zw" ${S.range ? "" : "disabled"}>Look at any time</button><button class="btn" id="zs">Choose other log files</button><button class="btn" id="zx">Clear what I typed</button></div></div>`;
    $("#zw").onclick = () => { S.range = ""; scopeChanged(); }; $("#zs").onclick = () => go("logs"); $("#zx").onclick = () => { X.q.rx = ""; X.q.excl = []; X.drill = null; run(); };
    return;
  }
  vPatterns(p, el); wire(el);
}
function drawLinesSection() {
  const el = $("#lpanel"), p = X.prof; if (!el) return;
  if (!p || p.too_big || !p.lines) { el.style.display = "none"; document.body.classList.remove("lp", "lpo", "lpt"); return; }
  el.style.display = "flex"; document.body.classList.add("lp"); document.body.classList.toggle("lpo", !!X.lopen); document.body.classList.toggle("lpt", !!(X.lopen && X.tall));
  const what = X.drill ? `<b>${esc(tplText(X.drill.label).slice(0, 90))}</b>${X.drill.node ? " on " + esc(nshort(X.drill.node)) : ""}` : "All matching lines";
  el.className = "lpanel " + (X.lopen ? (X.tall ? "tall" : "open") : "shut");
  if (!X.lopen) {
    el.innerHTML = `<div class="lp-head"><b>Lines</b><span class="hint grow">${p.lines.toLocaleString()} lines found. Click a kind of line above to read just those.</span><button class="btn primary sm" id="lpopen">Read the lines</button></div>`;
    $("#lpopen").onclick = () => { X.lopen = true; ensureSx(seq); drawLinesSection(); }; return;
  }
  el.innerHTML = `<div class="lp-head"><b>Lines</b><span class="grow">${what} ${X.res ? `<span class="hint">&middot; ${X.res.rows.length.toLocaleString()} shown${X.res.rows_truncated ? " (first " + X.rows + " per node)" : ""}</span>` : ""}</span>
    ${X.drill ? '<button class="btn sm" id="lpall">Show all lines</button>' : ""}<button class="btn sm" id="lptall">${X.tall ? "Shorter" : "Taller"}</button><button class="btn sm" id="lpclose">Hide</button></div><div class="lp-body" id="lines-body"></div>`;
  $("#lpclose").onclick = () => { X.lopen = false; drawLinesSection(); }; $("#lptall").onclick = () => { X.tall = !X.tall; drawLinesSection(); };
  const al = $("#lpall"); if (al) al.onclick = () => { X.drill = null; drawFilters(); drawWhat(); X.res = null; X.sxKey = ""; ensureSx(seq); };
  const body = $("#lines-body");
  if (!X.res) { body.innerHTML = '<div class="spin">Reading the lines...</div>'; return; }
  X.acts = X.acts || []; vLines(X.res, body); wire(body);
}
function drawExtra() {
  const r = X.res, sc = $("#s-counts"), sr = $("#s-rate"); if (!sc) return;
  const showC = !!(r && r.has_groups), showR = !!(r && r.counts && r.counts.some(c => c.n > 1) && (effRx() || X.drill));
  sc.style.display = showC ? "" : "none"; sr.style.display = showR ? "" : "none";
  if (showC) { vCounts(r, $("#counts-body")); wire($("#counts-body")); }
  if (showR) { vRate(r, $("#rate-body")); wire($("#rate-body")); }
  drawGlance();
}

// ------------------------------------------------------------------ click a time to zoom or look around it
function zoomPop(a, ts) {
  const e = toEpoch(ts), b = (l, s) => `<button class="btn sm" data-z="${s}">${l}</button>`;
  pop(a, `<div class="mono hint" style="margin-bottom:10px">${esc(ts.replace("Z", ""))} UTC</div><div class="row" style="margin-bottom:10px"><span class="hint">Zoom to within</span>${b("10 seconds", 10)}${b("1 minute", 60)}${b("10 minutes", 600)}${b("1 hour", 3600)}</div>
    <div class="col"><button class="btn sm" id="xz_all">Everything logged around here (main logs, 1 minute either side)</button><div class="row"><button class="btn sm" id="xz_from">Start the range here</button><button class="btn sm" id="xz_to">End the range here</button><button class="btn sm" id="xz_cp">Copy this time</button></div></div>`, p => {
    p.querySelectorAll("[data-z]").forEach(x => x.onclick = () => { const s = +x.dataset.z; S.range = `${fromEpoch(e - s)} to ${fromEpoch(e + s)}`; X.drill = null; popClose(); scopeChanged(); });
    $("#xz_all").onclick = () => { popClose(); startAnalysis({ title: "Everything around " + ts.replace("Z", "").slice(5, 19), desc: "Every line on every node, from the main logs, around this moment.", rx: "", files: MAIN_FILES, time: `${fromEpoch(e - 60)} to ${fromEpoch(e + 60)}` }); };
    $("#xz_from").onclick = () => { const w = X.prof && X.prof.window; S.range = `${fromEpoch(e)} to ${w ? fromEpoch(w.to) : "2099-01-01"}`; popClose(); scopeChanged(); };
    $("#xz_to").onclick = () => { const w = X.prof && X.prof.window; S.range = `${w ? fromEpoch(w.from) : "2000-01-01"} to ${fromEpoch(e)}`; popClose(); scopeChanged(); };
    $("#xz_cp").onclick = () => { popClose(); copyText(ts.replace("Z", "")); };
  });
}


// ---- the matrix: what was logged, folded into patterns, one column per node
function vPatterns(p, v) {
  const nodes = p.nodes, one = p.window.to - p.window.from < 86400;
  let rows = p.patterns.map((q, i) => Object.assign({ i }, q));
  rows = rows.filter(q => X.lv.some((on, k) => on && q.lv[k] > 0));
  if (X.uneven) rows = rows.filter(q => Object.keys(q.nodes).length < nodes.length);
  if (X.pf) { const f = X.pf.toLowerCase(); rows = rows.filter(q => q.key.toLowerCase().includes(f)); }
  const sorters = { n: (a, b) => b.n - a.n, first: (a, b) => a.first - b.first, last: (a, b) => b.last - a.last, spread: (a, b) => Object.keys(a.nodes).length - Object.keys(b.nodes).length || b.n - a.n, err: (a, b) => b.lv[0] - a.lv[0] || b.lv[1] - a.lv[1] || b.n - a.n };
  rows.sort(sorters[X.sort]);
  const LV = [["Errors", "--bad"], ["Warnings", "--warn"], ["Info", "--bar"], ["Debug", "--mut"]];
  const text = rows.slice(0, 80).map(q => `${String(q.n).padStart(8)}  ${nodes.map(n => nshort(n) + "=" + (q.nodes[n] || 0)).join(" ")}  ${fmtT(q.first, one)} to ${fmtT(q.last, one)}  ${tplText(q.key).slice(0, 150)}`).join("\n");
  const w = p.window, cmd = `rg -a -N ${X.q.icase ? "-i " : ""}${shq(X.q.rx || ".")} ${pickFiles().join(" ")} | sed -E 's/[0-9]+/N/g' | sort | uniq -c | sort -rn | head -40   # approximate folding`;
  const i0 = X.acts.length; X.acts.push(() => copyText(text, "Copied table")); X.acts.push(() => addEvidence({ label: `What was logged ${fromEpoch(w.from).slice(0, 16)} to ${fromEpoch(w.to).slice(0, 16)} UTC${X.q.rx ? " matching " + X.q.rx : ""}`, command: cmd, output: `Counts per node in this order: ${nodes.map(nshort).join(", ")}\n` + text }));
  v.innerHTML = `<div class="row sp" style="margin-bottom:10px"><div class="row">${LV.map(([l, c], k) => `<span class="chip lv ${X.lv[k] ? "on" : ""}" data-lv="${k}"><i class="dot" style="background:var(${c})"></i>${l} ${(p.levels[k] || 0).toLocaleString()}</span>`).join("")}
      <span class="chip ${X.uneven ? "on" : ""}" id="xun" title="Show only patterns that some nodes did not log">Not on every node</span></div>
    <div class="row"><input id="xpf" placeholder="Find in patterns" value="${esc(X.pf)}" style="width:180px"><select id="xso"><option value="n">Most lines</option><option value="err">Most errors</option><option value="first">First seen</option><option value="last">Last seen</option><option value="spread">Fewest nodes</option></select>
      <button class="btn sm" data-act="${i0}">Copy table</button><button class="btn sm" data-act="${i0 + 1}">Add to reply</button></div></div>
  <div class="hint" style="margin-bottom:6px">${rows.length.toLocaleString()} of ${p.patterns_total.toLocaleString()} patterns, ${p.lines.toLocaleString()} lines. Similar lines are folded: numbers, ids and times vary. Click a pattern for its lines, or a node's number for that node only.${p.sampled ? " <b>Very large files were sampled for patterns.</b>" : ""}${p.capped ? " <b>A file hit the line limit. Narrow the window.</b>" : ""}</div>
  <div class="mscroll"><table class="mx"><tr><th></th><th>Pattern</th><th style="text-align:right">Lines</th>${nodes.map(n => `<th class="nh" title="${esc(n)}">${esc(nshort(n))}</th>`).join("")}<th>First</th><th>Last</th><th>Over time</th><th></th></tr>
  ${rows.slice(0, 250).map(q => { const mx = Math.max(...Object.values(q.nodes)), sm = Math.max(1, ...q.sp), worst = q.lv[0] ? "--bad" : q.lv[1] ? "--warn" : "--bar";
    return `<tr class="pr ${X.drill && X.drill.label === q.key ? "drilled" : ""}" data-p="${q.i}"><td><i class="dot" style="background:var(${worst})" title="errors ${q.lv[0]}, warnings ${q.lv[1]}, info ${q.lv[2]}, debug ${q.lv[3]}"></i></td>
    <td class="pt mono">${tplHtml(q.key)}</td><td class="num"><b>${q.n.toLocaleString()}</b></td>
    ${nodes.map(n => { const c = q.nodes[n] || 0, a = c ? 0.12 + 0.42 * Math.sqrt(c / mx) : 0; return `<td class="hc ${c ? "" : "z"}" ${c ? `data-cell="${q.i}|${esc(n)}" style="background:rgba(46,124,246,${a.toFixed(2)})"` : ""} title="${esc(nshort(n))}: ${c.toLocaleString()}">${c ? compact(c) : "&middot;"}</td>`; }).join("")}
    <td class="mono tc" data-t="${esc(fromEpoch(q.first) + "Z")}">${esc(fmtT(q.first, one))}</td><td class="mono tc" data-t="${esc(fromEpoch(q.last) + "Z")}">${esc(fmtT(q.last, one))}</td>
    <td><svg viewBox="0 0 32 12" width="90" height="18" preserveAspectRatio="none">${q.sp.map((c, k) => c ? `<rect x="${k}" y="${(12 - 12 * c / sm).toFixed(1)}" width="0.85" height="${(12 * c / sm).toFixed(1)}" fill="var(--info)"/>` : "").join("")}</svg></td>
    <td class="acts2"><button class="btn sm" data-pm="${q.i}">More</button></td></tr>`; }).join("")}</table></div>`;
  $$("[data-lv]").forEach(c => c.onclick = () => { X.lv[+c.dataset.lv] = !X.lv[+c.dataset.lv]; drawWhat(); });
  $("#xun").onclick = () => { X.uneven = !X.uneven; drawWhat(); };
  const pf = $("#xpf"); pf.oninput = () => { X.pf = pf.value; clearTimeout(pfT); pfT = setTimeout(() => { drawWhat(); const e = $("#xpf"); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }, 250); };
  $("#xso").value = X.sort; $("#xso").onchange = e => { X.sort = e.target.value; drawWhat(); };
  const drill = (q, node) => { X.drill = { rx: q.rx, label: q.key, node: node || null, human: humanRx(q.key) }; X.rows = 500; drawFilters(); drawWhat(); X.lopen = true; X.res = null; X.sxKey = ""; ensureSx(seq); };
  $$("tr.pr").forEach(tr => tr.onclick = e => { if (e.target.closest("button,.tc,[data-cell]")) return; if (String(window.getSelection()).length) return; drill(p.patterns[+tr.dataset.p]); });
  $$("[data-cell]").forEach(c => c.onclick = e => { e.stopPropagation(); const [i, n] = c.dataset.cell.split("|"); drill(p.patterns[+i], n); });
  $$("[data-pm]").forEach(b => b.onclick = e => { e.stopPropagation(); patMenu(b, p.patterns[+b.dataset.pm]); });
}
let pfT = 0;
function patMenu(a, q) {
  const f = q.sample_file, cmd = `rg -a -N ${X.q.icase ? "-i " : ""}${shq(humanRx(q.key) || q.rx)} ${f}`;
  pop(a, `<div class="sm mut" style="margin-bottom:6px">${esc(q.n.toLocaleString())} lines. First on ${esc(nshort(q.sample_node))}, ${esc(f)}.</div><pre style="max-height:140px">${esc(disp(q.sample))}</pre>
    <div class="col"><button class="btn" id="pm1">Show the lines</button><button class="btn" id="pm2">Leave this pattern out</button><button class="btn" id="pm3">Copy sample line</button>
    <button class="btn" id="pm4">Copy sample line + command</button><button class="btn" id="pm5">Add to reply</button><button class="btn" id="pm6">Build a pattern from the sample</button></div>`, p => {
    $("#pm1").onclick = () => { popClose(); X.drill = { rx: q.rx, label: q.key, node: null, human: humanRx(q.key) }; drawFilters(); drawWhat(); X.lopen = true; X.res = null; X.sxKey = ""; ensureSx(seq); };
    $("#pm2").onclick = () => { popClose(); X.q.excl.push(q.rx); run(); };
    $("#pm3").onclick = () => { popClose(); copyText(outText(q.sample), "Copied sample line"); };
    $("#pm4").onclick = () => { popClose(); copyText(evidenceText({ label: `${nshort(q.sample_node)}, ${f}`, command: cmd, output: outText(q.sample) }), "Copied sample with the command"); };
    $("#pm5").onclick = () => { popClose(); addEvidence({ label: `${nshort(q.sample_node)}, ${f}`, command: cmd, output: outText(q.sample),
      note: `${q.n.toLocaleString()} lines like this in the window: ${Object.entries(q.nodes).map(([n, c]) => nshort(n) + " " + c).join(", ")}. First ${fromEpoch(q.first)}Z, last ${fromEpoch(q.last)}Z.` }); };
    $("#pm6").onclick = () => { popClose(); anatomy({ line: q.sample, t: fromEpoch(q.first) + "Z", node: q.sample_node, file: f }); };
  });
}



// ------------------------------------------------------------------ select text in a line to pivot on it
function selPop() {
  let el = $("#xsel"); if (!el) { el = document.createElement("div"); el.id = "xsel"; document.body.appendChild(el); } return el;
}
document.addEventListener("mouseup", e => {
  setTimeout(() => {
    const el = selPop(); if (S.page !== "analyze") { el.style.display = "none"; return; }
    if (e.target.closest("#xsel")) return;
    const sel = window.getSelection(), t = String(sel).trim(); let node = sel.anchorNode; node = node && (node.nodeType === 1 ? node : node.parentElement);
    const cell = node && node.closest && node.closest("#page .ln, #page .pt, .cxbox .cl");
    if (!t || t.length > 160 || !cell) { el.style.display = "none"; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    el.innerHTML = '<button class="btn sm" data-a="f">Find this</button><button class="btn sm" data-a="n">Leave out</button><button class="btn sm" data-a="c">Count values like this</button><button class="btn sm" data-a="k">Copy</button>';
    el.style.display = "flex"; el.style.left = Math.max(8, Math.min(r.left + window.scrollX, innerWidth - 380)) + "px"; el.style.top = (r.top + window.scrollY - 40) + "px";
    el.onmousedown = ev => ev.preventDefault();
    el.onclick = ev => { const a = ev.target.dataset.a; if (!a) return; el.style.display = "none";
      if (a === "k") return copyText(t);
      if (a === "f") { X.q.rx = rxEsc(t); X.q.fixed = false; X.drill = null; return run(); }
      if (a === "n") { X.q.excl.push(rxEsc(t)); return run(); }
      const full = cell.textContent, i = full.indexOf(t); let ls = Math.max(0, i - 18); while (ls < i && ls > 0 && /\w/.test(full[ls - 1]) && /\w/.test(full[ls])) ls++; const left = full.slice(ls, i);
      const gen = /^-?\d+$/.test(t) ? "\\d+" : /^-?\d+\.\d+$/.test(t) ? "\\d+\\.\\d+" : /^[0-9a-fA-F-]{12,}$/.test(t) ? "[0-9a-fA-F-]+" : /^[\w.\-]+$/.test(t) ? "[\\w.\\-]+" : ".+?";
      X.q.rx = rxEsc(left) + "(" + gen + ")" + (gen === ".+?" ? rxEsc(full.slice(i + t.length, i + t.length + 6)) : ""); X.q.fixed = false; X.drill = null; X.countsOpen = true; run(); };
  }, 0);
});




function acts(label, command, text) {
  const i = X.acts.length;
  X.acts.push(() => copyText(text, "Copied table")); X.acts.push(() => copyText(command, "Copied command")); X.acts.push(() => addEvidence({ label, command, output: text }));
  return `<button class="btn sm" data-act="${i}">Copy table</button><button class="btn sm" data-act="${i + 1}">Copy command</button><button class="btn sm" data-act="${i + 2}">Add to reply draft</button>`;
}



// ---- Lines
let hlRx = null;
function mkHl() { hlRx = null; const q = X.q, rx = effRx(); if (!rx) return; try { hlRx = new RegExp(q.fixed && !X.drill ? rxEsc(rx) : rx, q.icase ? "gi" : "g"); } catch (e) { hlRx = null; } }
function hl(text) {
  if (!hlRx) return esc(text);
  let out = "", last = 0, m, n = 0; hlRx.lastIndex = 0;
  while ((m = hlRx.exec(text)) && n++ < 40) { if (!m[0]) { hlRx.lastIndex++; continue; } out += esc(text.slice(last, m.index)) + "<mark>" + esc(m[0]) + "</mark>"; last = m.index + m[0].length; }
  return out + esc(text.slice(last));
}
const rkey = (x, i) => i;
function selRows() { return X.res.rows.filter((x, i) => X.sel.has(i)); }
function vLines(r, v) {
  mkHl();
  const one = new Set(r.rows.map(x => x.t.slice(0, 10))).size === 1, tcell = x => (one ? x.t.slice(11, 19) : x.t.slice(5, 19));
  v.innerHTML = `<div class="row sp" style="margin-bottom:8px"><div class="row grow"><input id="xrf" placeholder="Filter these lines (text or regex)" style="width:300px"><span class="hint" id="xrfc"></span></div>
    <div class="row">${r.rows_truncated && X.rows < 5000 ? '<button class="btn sm" id="xmore">Load up to 5000 per node</button>' : ""}<button class="btn sm" id="xvw" data-pop>View options</button><button class="btn sm" id="xall">Select all</button></div></div>
  <div class="hint" style="margin-bottom:6px">${r.rows.length.toLocaleString()} lines in time order${one && r.rows.length ? ", all on " + esc(r.rows[0].t.slice(0, 10)) : ""}${r.rows_truncated ? `, the first ${X.rows} per node` : ""}. Click a line to select it, shift-click for a range, or drag to select text. Click a time to zoom.</div>
  <table class="${V.compact ? "compact" : ""} ${V.wrap ? "" : "nowrap"}"><tr><th style="width:26px"></th><th>${one ? "Time" : "Date and time"} (UTC)</th><th>Node</th><th>File:line</th><th>Message</th><th></th></tr>${r.rows.map((x, i) => `<tr class="lr ${X.sel.has(i) ? "sel" : ""}" data-i="${i}">
    <td><input type="checkbox" ${X.sel.has(i) ? "checked" : ""} data-ck="${i}"></td><td class="mono tc" data-t="${esc(x.t)}">${esc(tcell(x))}</td>
    <td class="mono" style="white-space:nowrap">${dot(x.node)} ${esc(nshort(x.node))}</td><td class="mono mut" style="white-space:nowrap">${esc(x.file.replace("ns_server.", ""))}:${x.lineno}</td>
    <td class="mono ln">${hl(disp(x.line))}</td><td class="acts"><button class="btn sm" data-cl="${i}" title="Copy this line">Copy</button> <button class="btn sm" data-cx="${i}" title="Show the lines just before and after this one in the file">Nearby lines</button> <button class="btn sm" data-pt="${i}" title="Break this line into parts and search for lines like it">Find similar</button></td></tr>`).join("")}</table>
  <div class="selbar" id="xsb"><b id="xsn"></b><button class="btn" id="sb1">Copy lines</button><button class="btn pri" id="sb2">Copy lines + command</button><button class="btn" id="sb3">Copy command</button><button class="btn" id="sb4">Add to reply draft</button><button class="btn" id="sb5">Clear</button><span class="sm" style="opacity:.7">Cmd/Ctrl+C copies lines + command</span></div>`;
  const tg = (i, shift) => { if (shift && X.last !== null) { const [a, b] = [Math.min(X.last, i), Math.max(X.last, i)]; for (let j = a; j <= b; j++) X.sel.add(j); } else if (X.sel.has(i)) X.sel.delete(i); else X.sel.add(i); X.last = i; paintSel(); };
  $$("tr.lr").forEach(tr => tr.onclick = e => { if (e.target.closest("button,.tc,input")) return; if (String(window.getSelection()).length) return; tg(+tr.dataset.i, e.shiftKey); });
  $$("[data-ck]").forEach(c => c.onclick = e => { e.stopPropagation(); tg(+c.dataset.ck, e.shiftKey); });
  $$("[data-cl]").forEach(b => b.onclick = e => { e.stopPropagation(); copyLines([r.rows[+b.dataset.cl]]); });
  $$("[data-pt]").forEach(b => b.onclick = e => { e.stopPropagation(); anatomy(r.rows[+b.dataset.pt]); });
  $$("[data-cx]").forEach(b => b.onclick = e => { e.stopPropagation(); contextRow(r, b); });
  const mo = $("#xmore"); if (mo) mo.onclick = () => { X.rows = 5000; X.sxKey = ""; ensureSx(seq); };
  $("#xall").onclick = () => { $$("tr.lr").forEach(tr => { if (tr.style.display !== "none") X.sel.add(+tr.dataset.i); }); paintSel(); };
  $("#sb1").onclick = () => copyLines(selRows()); $("#sb2").onclick = () => copyBlock(selRows());
  $("#sb3").onclick = () => { const f = [...new Set(selRows().map(x => x.file))]; copyText(cmdFor(f.join(" ")), "Copied command"); };
  $("#sb4").onclick = () => addEvidence(evItems(selRows())); $("#sb5").onclick = () => { X.sel.clear(); paintSel(); };
  const rf = $("#xrf"), rfc = $("#xrfc");
  rf.oninput = () => { const q = rf.value; let re = null;
    if (q) { try { re = new RegExp(q, "i"); } catch (e) { const ql = q.toLowerCase(); re = { test: t => t.toLowerCase().includes(ql) }; } }
    let n = 0; $$("tr.lr").forEach(tr => { const ok = !re || re.test(r.rows[+tr.dataset.i].line); tr.style.display = ok ? "" : "none"; const nx = tr.nextElementSibling; if (nx && nx.classList.contains("cxrow")) nx.style.display = ok ? "" : "none"; if (ok) n++; });
    rfc.textContent = q ? `${n} of ${r.rows.length} shown` : ""; };
  $("#xvw").onclick = e => viewPop(e.currentTarget);
  paintSel();
}
function viewPop(a) {
  const sh = shortInfo(), cb = (k, l, d) => `<label style="display:block;margin:4px 0"><input type="checkbox" data-v="${k}" ${V[k] ? "checked" : ""}> ${l}${d ? `<div class="hint" style="margin-left:22px">${d}</div>` : ""}</label>`;
  pop(a, cb("wrap", "Wrap long lines") + cb("compact", "Compact rows") +
    (sh ? cb("short", "Show short node names", "Shows 0004 instead of the long hostname. The log itself is not changed.") + cb("copyShort", "Shorten node names in copies", "Copies show 0004 and the command gets a sed step, as in your replies.") : '<div class="hint">Short node names are not available: the node names in this collection do not share a prefix.</div>'), p => {
    p.querySelectorAll("[data-v]").forEach(i => i.onchange = () => { V[i.dataset.v] = i.checked; saveV(); drawLinesSection(); });
  });
}
function contextRow(r, b) {
  const i = +b.dataset.cx, tr = b.closest("tr"), nx = tr.nextElementSibling;
  if (nx && nx.classList.contains("cxrow")) { nx.remove(); return; }
  const x = r.rows[i], row = document.createElement("tr"), steps = [5, 20, 50]; row.className = "cxrow"; row.innerHTML = '<td></td><td colspan="5"><div class="hint">Loading...</div></td>'; tr.after(row);
  const load = async n => {
    try {
      const j = await api("/api/context", { path: S.path, node: x.node, file: x.file, line: x.lineno, before: n, after: n });
      const body = j.lines.map((l, k) => `<div class="cl ${j.start + k === j.target ? "tg" : ""}"><i>${j.start + k}</i>${esc(disp(l))}</div>`).join("");
      row.children[1].innerHTML = `<div class="cxbox"><div class="row" style="margin-bottom:6px"><b class="sm">${esc(nshort(x.node))}, ${esc(x.file)}, lines ${j.start} to ${j.start + j.lines.length - 1}</b><button class="btn sm" data-m>${n >= 50 ? "Fewer lines" : "More lines"}</button><button class="btn sm" data-c1>Copy</button><button class="btn sm" data-c2>Copy + command</button><button class="btn sm" data-c3>Close</button></div>${body}</div>`;
      const raw = j.lines.map(outText).join("\n");
      row.querySelector("[data-m]").onclick = () => load(steps[(steps.indexOf(n) + 1) % 3]);
      row.querySelector("[data-c1]").onclick = () => copyText(raw, `Copied ${j.lines.length} lines`);
      row.querySelector("[data-c2]").onclick = () => copyText(evidenceText({ label: `${nshort(x.node)}, ${x.file}`, command: j.command + (V.copyShort && shortInfo() ? " | " + shortInfo().sed : ""), output: raw }), "Copied lines with the command");
      row.querySelector("[data-c3]").onclick = () => row.remove();
    } catch (e) { row.children[1].innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
  load(5);
}
function paintSel() {
  $$("tr.lr").forEach(tr => { const on = X.sel.has(+tr.dataset.i); tr.classList.toggle("sel", on); const c = tr.querySelector("input"); if (c) c.checked = on; });
  const sb = $("#xsb"); if (!sb) return; sb.classList.toggle("on", X.sel.size > 0); $("#xsn").textContent = `${X.sel.size} selected`;
}



const nodeList = o => Object.entries(o).map(([n, c]) => `${dot(n)}${esc(nshort(n))} ${c.toLocaleString()}`).join(" &nbsp; ");
const nodeTxt = o => Object.entries(o).map(([n, c]) => nshort(n) + "=" + c).join(" ");
function vCounts(r, v) {
  if (!r.has_groups) { v.innerHTML = `<div class="empty">${esc(r.capture_note) || "Nothing is being counted yet."}<br>Use <b>Pattern</b> on a line, click the value you want to count until it turns blue, then Search.<br>Or put a group in the regex, for example <code>conn_id":(\\d+)</code>.</div>`; return; }
  const txt = r.groups.slice(0, 80).map(x => `${String(x.n).padStart(7)}  ${x.first.slice(5, 19)} to ${x.last.slice(5, 19)}  [${nodeTxt(x.nodes)}]  ${x.key}`).join("\n");
  const mx = Math.max(...r.groups.map(g => g.n));
  v.innerHTML = `<div class="row sp" style="margin-bottom:8px"><div class="hint">${r.groups.length} distinct values of the blue part of your pattern. Click a row to see a real line.</div><div class="row">${acts("Counts by value: " + X.q.rx, `rg -a -N -o -r '$1' ${shq(X.q.rx)} ${pickFiles().join(" ")} | sort | uniq -c | sort -rn`, txt)}</div></div>
  <table><tr><th>Value</th><th>Count</th><th></th><th>First</th><th>Last</th><th>Per node</th></tr>${r.groups.map(x => `<tr class="lr" style="cursor:pointer" data-line="${esc(JSON.stringify({ line: x.sample, t: x.first, node: Object.keys(x.nodes)[0] || "", file: "" }))}"><td class="mono"><b>${esc(x.key)}</b></td><td>${x.n.toLocaleString()}</td><td style="width:150px"><div style="background:var(--info);height:8px;border-radius:4px;width:${Math.max(2, Math.round(140 * x.n / mx))}px"></div></td><td class="mono">${esc(x.first.slice(5, 19))}</td><td class="mono">${esc(x.last.slice(5, 19))}</td><td class="mono sm">${nodeList(x.nodes)}</td></tr>`).join("")}</table>`;
}
function vRate(r, v) {
  const H = r.histogram, rows = r.counts.filter(c => c.n > 1);
  const peak = n => { let b = null; H.forEach(h => { const c = h.nodes[n] || 0; if (!b || c > b.c) b = { c, t: h.t }; }); return b; };
  const txt = rows.map(c => `${nshort(c.node)} ${c.file}: ${c.n} hits, typical interval ${c.median_iv}s, common gaps ${c.iv.map(i => i[0] + "s x" + i[1]).join(", ")}, longest gap ${c.gap_s}s`).join("\n");
  v.innerHTML = `<div class="row sp" style="margin-bottom:8px"><div class="hint">How often the matching line repeats. One dominant interval means a timer or a retry loop. Click a time to zoom there.</div><div class="row">${acts("Rate: " + (X.q.rx || "all"), r.pipelines.histogram || cmdAll(), txt)}</div></div>
  <table><tr><th>Node</th><th>File</th><th>Hits</th><th>Typical interval</th><th>Most common gaps</th><th>Longest gap</th><th>Busiest ${esc(r.bucket)}</th></tr>${rows.map(c => { const p = peak(c.node), reg = c.iv.length && c.iv[0][1] / (c.n - 1) > 0.8;
    return `<tr><td class="mono">${dot(c.node)} ${esc(nshort(c.node))}</td><td class="mono">${esc(c.file)}</td><td>${c.n.toLocaleString()}</td><td><b>every ${esc(secs(c.median_iv))}</b>${reg ? ' <span class="pill info">regular</span>' : ""}</td><td class="mono">${c.iv.map(i => `${esc(secs(i[0]))} x${i[1]}`).join(", ")}</td>
    <td class="mono tc" ${c.gap_at ? `data-t="${esc(c.gap_at)}"` : ""}>${esc(secs(c.gap_s))}${c.gap_at ? " after " + esc(c.gap_at.slice(11, 19)) : ""}</td><td class="mono tc" ${p && p.c ? `data-t="${esc(p.t)}"` : ""}>${p ? p.c + " at " + esc(p.t.slice(5, 19)) : ""}</td></tr>`; }).join("") || '<tr><td colspan="7" class="mut">Needs at least two matches in a file.</td></tr>'}</table>`;
}



// ------------------------------------------------------------------ line anatomy: click the parts of a line to build the regex
const TOK = /(\d{4}-\d\d-\d\d[T ][\d:.,]+(?:Z|[+-]\d\d:\d\d)?)|(ns_1@[\w.\-]+)|(<\d+\.\d+\.\d+>)|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[0-9a-f]{12,}\b)|(\d+\.\d+\.\d+\.\d+(?::\d+)?)|(-?\d+(?:\.\d+)?)|([A-Za-z_][\w.\-]*)|([\s\S])/gi;
const KINDS = ["ts", "node", "pid", "id", "ip", "num", "word"];
const GEN = { ts: "\\d{4}-\\d\\d-\\d\\d[T ][\\d:.,]+(?:Z|[+-]\\d\\d:\\d\\d)?", node: "ns_1@[\\w.\\-]+", pid: "<\\d+\\.\\d+\\.\\d+>", id: "[0-9a-fA-F-]{12,}", ip: "\\d+\\.\\d+\\.\\d+\\.\\d+(?::\\d+)?", word: "[\\w.\\-]+" };
const genFor = t => t.kind === "num" ? (/^-?\d+$/.test(t.text) ? "\\d+" : "\\d+\\.\\d+") : GEN[t.kind];
function tokenize(line) {
  const out = []; let m; TOK.lastIndex = 0;
  while ((m = TOK.exec(line))) {
    let k = null; for (let i = 0; i < 7; i++) if (m[i + 1] !== undefined) { k = KINDS[i]; break; }
    if (!k) { const l = out[out.length - 1]; if (l && l.kind === "sep") l.text += m[0]; else out.push({ kind: "sep", text: m[0], state: 0 }); }
    else out.push({ kind: k, text: m[0], state: 0 });
  }
  return out;
}
function compose(tokens) {
  const parts = []; let skipped = false, sep = "", caps = 0;
  for (const t of tokens) {
    if (t.kind === "sep") { sep += t.text; continue; }
    if (t.state === 0) { if (parts.length) skipped = true; sep = ""; continue; }
    if (parts.length) parts.push(skipped ? ".*?" : (/^\s+$/.test(sep) ? "\\s+" : rxEsc(sep)));
    skipped = false; sep = "";
    if (t.state === 1) parts.push(rxEsc(t.text)); else if (t.state === 2) parts.push(genFor(t)); else { parts.push("(" + genFor(t) + ")"); caps++; }
  }
  return { rx: parts.join(""), caps };
}
let cntTimer = 0;
function anatomy(row) { X.anat = row; X.tokens = tokenize(row.line); X.tokens.forEach(t => { t.state = t.kind === "word" ? 1 : 0; }); drawAnat(); }
function drawAnat() {
  const d = $("#xdrawer"), row = X.anat; d.style.display = "block"; document.body.classList.add("drawer");
  const body = X.tokens.map((t, i) => t.kind === "sep" ? `<span class="sep">${esc(t.text)}</span>` : `<span class="tk s${t.state} k${t.kind}" data-i="${i}" title="${t.kind}">${esc(t.text)}</span>`).join("");
  const c = compose(X.tokens);
  d.innerHTML = `<div class="row sp"><h2>Build a pattern from this line</h2><button class="btn sm" id="xclose">Close</button></div>
  <div class="hint">${esc(row.node ? nshort(row.node) : "")} ${esc(row.file || "")} ${esc(row.t || "")}</div>
  <div style="margin:12px 0;line-height:1.8">${body}</div>
  <div class="hint"><span class="tk s0">off</span> ignored &nbsp; <span class="tk s1">text</span> must match this text &nbsp; <span class="tk s2">any</span> any value of this kind &nbsp; <span class="tk s3">count</span> capture and count by it.<br>Click a part to step through these. Shift-click selects a run as text. Click a timestamp to zoom there.</div>
  <div class="row" style="margin:10px 0"><span class="chip" data-p="words">Words only</span><span class="chip" data-p="vary">Same message, values vary</span><span class="chip" data-p="exact">Whole line without time</span><span class="chip" data-p="none">Clear</span></div>
  <div class="hint">Pattern (edit if you like)</div><input id="xanrx" class="mono" style="width:100%" value="${esc(c.rx)}">
  <div class="hint" id="xancnt" style="margin:8px 0"></div>
  <div class="row"><button class="btn pri" id="xuse">Search this</button><button class="btn" id="xnot">Leave out lines like this</button><button class="btn" id="xcp">Copy pattern</button></div>`;
  $("#xclose").onclick = () => { d.style.display = "none"; document.body.classList.remove("drawer"); };
  let last = null;
  d.querySelectorAll(".tk[data-i]").forEach(el => el.onclick = e => {
    const i = +el.dataset.i, t = X.tokens[i];
    if (t.kind === "ts") { zoomPop(el, t.text.replace("T", " ").replace(/[.,]\d+.*$/, "").replace(/Z$/, "")); return; }
    if (e.shiftKey && last !== null) { const [a, b] = [Math.min(last, i), Math.max(last, i)]; for (let j = a; j <= b; j++) if (X.tokens[j].kind !== "sep") X.tokens[j].state = 1; } else t.state = (t.state + 1) % 4;
    last = i; drawAnat();
  });
  d.querySelectorAll("[data-p]").forEach(el => el.onclick = () => { const p = el.dataset.p; X.tokens.forEach(t => { t.state = p === "words" ? (t.kind === "word" ? 1 : 0) : p === "vary" ? (t.kind === "ts" ? 0 : t.kind === "word" ? 1 : 2) : p === "exact" ? (t.kind === "ts" || t.kind === "sep" ? 0 : 1) : 0; }); drawAnat(); });
  const rxIn = $("#xanrx");
  const preview = () => { clearTimeout(cntTimer); cntTimer = setTimeout(async () => { const el = $("#xancnt"); if (!el) return; if (!rxIn.value) { el.textContent = "Nothing selected yet. Click parts of the line above."; return; }
    el.textContent = "Counting..."; try { const r = await api("/api/sx", params({ regex: rxIn.value, rows: 0, fixed: 0 })); const hit = new Set(r.counts.filter(x => x.n).map(x => x.node));
      el.innerHTML = `<b>${r.matched.toLocaleString()}</b> lines on ${hit.size} of ${r.nodes.length} nodes with the current files, nodes and time.${c.caps ? ` ${c.caps} part${c.caps > 1 ? "s" : ""} counted: see "Counts by value".` : ""}`; } catch (e) { el.innerHTML = `<span class="err">${esc(e.message)}</span>`; } }, 350); };
  rxIn.oninput = preview; preview();
  $("#xuse").onclick = () => { X.q.rx = rxIn.value; X.q.fixed = false; X.drill = null; X.countsOpen = hasCapture(rxIn.value) || X.countsOpen; run(); };
  $("#xnot").onclick = () => { if (rxIn.value) { X.q.excl.push(rxIn.value); run(); } };
  $("#xcp").onclick = () => copyText(rxIn.value, "Copied pattern");
}
if (!window.__xk) { window.__xk = 1; document.addEventListener("keydown", e => {
  if (S.page !== "analyze") return; const tag = document.activeElement.tagName;
  if (e.key === "Escape") { popClose(); const d = $("#xdrawer"); if (d && d.style.display === "block") { d.style.display = "none"; document.body.classList.remove("drawer"); } else if (X.sel.size) { X.sel.clear(); paintSel(); } }
  if ((e.metaKey || e.ctrlKey) && e.key === "c" && X.sel.size && !String(window.getSelection()).length && !/INPUT|TEXTAREA/.test(tag)) { e.preventDefault(); copyBlock(selRows()); }
}); }

})();

