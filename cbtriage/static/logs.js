// Log files: see every file on every node, tick the ones to read, open any one to read it.
(function () {
const LG = { other: false, reader: null, sel: new Set(), last: null, hit: 0, matches: null, findq: "", open: new Set(), shut: new Set(["Nearly empty files"]) };
const ORDER = GROUPS.map(g => g.label).concat(["Other logs", "Other files"]);

PAGES.logs = function () { LG.reader ? drawReader() : drawGrid(); };
window.logsReset = () => { LG.reader = null; LG.sel.clear(); LG.last = null; };
window.openFile = (node, file, line) => { LG.reader = { node, file, start: Math.max(1, (line || 1) - (line ? 8 : 0)), total: 0, lines: [] }; LG.sel.clear(); LG.last = null; LG.hit = line || 0; LG.matches = null; LG.findq = ""; go("logs"); };

// ------------------------------------------------------------------ the list: one row per log file
const TINY = 2048;
const nodesAll = () => dnodes().filter(n => S.fileMap[n]);
const isOn = (n, f) => (S.pick[n] || []).includes(f);
function setOne(n, f, on) { const a = new Set(S.pick[n] || []); on ? a.add(f) : a.delete(f); S.pick[n] = [...a]; if (!S.pick[n].length) delete S.pick[n]; }
function info(f) {
  const nodes = nodesAll().filter(n => S.fileMap[n][f]), real = nodes.filter(n => S.fileMap[n][f].size >= TINY), app = real.length ? real : nodes;
  const sz = app.map(n => S.fileMap[n][f].size), fs = app.map(n => S.fileMap[n][f].first).filter(Boolean).sort(), ls = app.map(n => S.fileMap[n][f].last).filter(Boolean).sort();
  return { nodes, real, app, tiny: !real.length, min: Math.min(...sz), max: Math.max(...sz), first: fs[0] || "", last: ls[ls.length - 1] || "", sel: nodes.filter(n => isOn(n, f)), selApp: app.filter(n => isOn(n, f)) };
}
function allFiles() {
  const names = new Set(); Object.values(S.fileMap).forEach(m => Object.keys(m).forEach(f => names.add(f)));
  const rows = [...names].map(f => Object.assign({ file: f }, fileInfo(f), { i: info(f) })).filter(r => LG.other || r.group !== "Other files");
  rows.forEach(r => { if (r.i.tiny) r.group = "Nearly empty files"; });
  const ord = g => (g === "Nearly empty files" ? 99 : ORDER.indexOf(g));
  rows.sort((a, b) => ord(a.group) - ord(b.group) || a.file.localeCompare(b.file));
  return rows;
}
function toggleNode(n) {
  if ((S.pick[n] || []).length) { delete S.pick[n]; return; }
  const want = new Set(Object.values(S.pick).flat()); if (!want.size) MAIN_FILES.forEach(f => want.add(f));
  const a = [...want].filter(f => S.fileMap[n][f] && S.fileMap[n][f].size >= TINY); if (a.length) S.pick[n] = a;
}
function redraw() { keepScroll(drawGrid); }
function drawGrid() {
  const nodes = nodesAll(), rows = allFiles(), groups = [], ps = pickSummary();
  rows.forEach(r => { let g = groups.find(x => x.name === r.group); if (!g) groups.push(g = { name: r.group, rows: [] }); g.rows.push(r); });
  const nstrip = nodes.map(n => { const c = (S.pick[n] || []).length; return `<span class="nchip ${c ? "on" : ""}" data-nd="${esc(n)}" title="${c ? "Click to stop reading this node" : "Click to read this node again"}">${dot(n)}<b class="mono">${esc(nshort(n))}</b><span class="sub">${esc(nodeServices(n) || "")}${c ? " &middot; " + c + " files" : " &middot; not read"}</span></span>`; }).join("");
  const fileRow = r => { const i = r.i, open = LG.open.has(r.file), all = i.selApp.length === i.app.length && i.app.length > 0, some = i.sel.length > 0;
    const where = i.tiny ? `nearly empty on ${i.nodes.length} node${i.nodes.length === 1 ? "" : "s"}` : i.app.length === nodes.length ? `on all ${nodes.length} nodes` : `on ${i.app.length} of ${nodes.length} nodes`;
    const size = i.min === i.max ? fmtSize(i.max) : fmtSize(i.min) + " to " + fmtSize(i.max), cover = i.first ? i.first.slice(5, 10) + " &rarr; " + i.last.slice(5, 10) : "";
    return `<div class="frow ${some ? "on" : ""}"><label class="fck"><input type="checkbox" data-row="${esc(r.file)}" ${all ? "checked" : ""} data-part="${some && !all ? 1 : ""}"></label>
      <div class="fmain"><b class="mono">${esc(r.file)}</b>${r.desc ? `<div class="d">${esc(r.desc)}</div>` : ""}</div>
      <div class="fmeta"><div>${where}</div><div class="sub">${esc(size)}${i.max >= TINY ? " each" : ""}${cover ? " &middot; " + cover : ""}</div></div>
      <div class="fsel">${some ? `<span class="ok">${i.sel.length === 1 ? "1 node" : i.sel.length + " nodes"} selected</span>` : '<span class="sub">not selected</span>'}</div>
      <div class="fact"><button class="btn sm" data-ex="${esc(r.file)}">${open ? "Hide nodes" : "Choose nodes"}</button><button class="btn sm" data-rd="${esc(r.file)}" data-pop>Read</button></div></div>
      ${open ? `<div class="fdet">${i.nodes.map(n => { const m = S.fileMap[n][r.file], t = m.size < TINY; return `<label class="dchip ${isOn(n, r.file) ? "on" : ""} ${t ? "tiny" : ""}" title="${esc(m.first ? m.first + " to " + m.last + " UTC" : "no timestamps")}"><input type="checkbox" data-n="${esc(n)}" data-f="${esc(r.file)}" ${isOn(n, r.file) ? "checked" : ""}>${dot(n)}<b class="mono">${esc(nshort(n))}</b><span class="sub">${esc(fmtSize(m.size))}${t ? ", nearly empty" : ""}</span><a data-open="${esc(n)}|${esc(r.file)}">read</a></label>`; }).join("")}</div>` : ""}`; };
  const grpHtml = g => { const sel = g.rows.filter(r => r.i.sel.length).length, shut = LG.shut.has(g.name);
    return `<div class="fgrp" data-g="${esc(g.name)}"><span class="car">${shut ? "&#9656;" : "&#9662;"}</span> ${esc(g.name)} <span class="sub">${g.rows.length} file${g.rows.length === 1 ? "" : "s"}${sel ? " &middot; " + sel + " selected" : ""}</span>${g.name === "Nearly empty files" ? '<span class="sub" style="text-transform:none;letter-spacing:0"> &middot; services that are not running on these nodes</span>' : ""}</div>${shut ? "" : g.rows.map(fileRow).join("")}`; };
  $("#page").innerHTML = `<div class="wrap wide">${ticketBanner()}<h1>Log files</h1>
    <p class="lead">Choose which log files each question reads. A tick means that file on every node that has it. Use <b>Choose nodes</b> when one file should be read on only some nodes.</p>
    <div class="card tight"><div class="row sp"><b>Nodes</b><span class="hint">Click a node to leave all its files out, or read it again.</span></div><div class="nstrip">${nstrip}</div></div>
    <div class="row" style="margin:16px 0 10px"><b>Quick picks</b><button class="btn sm" id="qmain">Main logs</button><button class="btn sm" id="qall">Every .log file</button><button class="btn sm" id="qnone">Clear all</button>
      <label class="hint" style="margin-left:auto"><input type="checkbox" id="so" ${LG.other ? "checked" : ""}> Also show other files (json, archives, snapshots)</label></div>
    <div class="flist">${groups.map(grpHtml).join("") || '<div class="empty">No log files found.</div>'}</div>
    <div class="stickybar"><div id="sumtxt"><b>${ps.files}</b> log files on <b>${ps.nodes}</b> node${ps.nodes === 1 ? "" : "s"} selected &middot; ${esc(fmtSize(ps.bytes))}</div><div class="row">${S.hasAnalysis ? '<button class="btn" id="back">Back to the analysis</button>' : ""}<button class="btn" id="done">Next: choose what to look for &rsaquo;</button></div></div></div>`;
  $$("input[data-part='1']").forEach(c => { c.indeterminate = true; });
  $$("[data-nd]").forEach(c => c.onclick = () => { toggleNode(c.dataset.nd); savePick(); redraw(); });
  $$("[data-g]").forEach(h => h.onclick = () => { const g = h.dataset.g; LG.shut.has(g) ? LG.shut.delete(g) : LG.shut.add(g); redraw(); });
  $$("[data-row]").forEach(c => c.onchange = () => { const f = c.dataset.row, i = info(f), active = nodes.filter(n => (S.pick[n] || []).length), target = i.app.filter(n => !active.length || active.includes(n)); const on = i.selApp.length !== i.app.length || !i.app.length; (target.length ? target : i.app).forEach(n => setOne(n, f, on)); if (!on) i.sel.forEach(n => setOne(n, f, false)); savePick(); redraw(); });
  $$("[data-ex]").forEach(b => b.onclick = () => { const f = b.dataset.ex; LG.open.has(f) ? LG.open.delete(f) : LG.open.add(f); redraw(); });
  $$("[data-n]").forEach(c => c.onchange = () => { setOne(c.dataset.n, c.dataset.f, c.checked); savePick(); redraw(); });
  $$("[data-open]").forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); const [n, f] = a.dataset.open.split("|"); openFile(n, f); });
  $$("[data-rd]").forEach(b => b.onclick = () => { const f = b.dataset.rd; pop(b, `<h3 style="margin-bottom:8px">Read ${esc(f)} on which node?</h3><div class="row" style="gap:6px;max-width:420px">${info(f).nodes.map(n => `<span class="chip" data-rn="${esc(n)}">${dot(n)}${esc(nshort(n))} <span class="sub">${esc(fmtSize(S.fileMap[n][f].size))}</span></span>`).join("")}</div>`, p => p.querySelectorAll("[data-rn]").forEach(c => c.onclick = () => { popClose(); openFile(c.dataset.rn, f); })); });
  $("#qmain").onclick = () => { S.pick = defaultPick(); savePick(); redraw(); };
  $("#qall").onclick = () => { const o = {}; Object.entries(S.fileMap).forEach(([n, m]) => { const a = Object.keys(m).filter(f => /\.log$/.test(f) && m[f].size >= TINY); if (a.length) o[n] = a; }); S.pick = o; savePick(); redraw(); };
  $("#qnone").onclick = () => { S.pick = {}; savePick(); redraw(); };
  $("#so").onchange = e => { LG.other = e.target.checked; redraw(); };
  $("#done").onclick = () => { if (!pickSummary().files) { toast("Tick at least one file"); return; } go("questions"); };
  const bk = $("#back"); if (bk) bk.onclick = () => { if (!pickSummary().files) { toast("Tick at least one file"); return; } scopeChanged(); go("analyze"); };
}
function syncGrid() { redraw(); }

// ------------------------------------------------------------------ reading one file
const lvCls = t => (/\b(CRITICAL|FATAL|ERROR|ERRO)\b|^\[\w+:(error|critical),|\[(Error|Fatal)\]/.test(t.slice(0, 220)) ? "e" : /\b(WARNING|WARN)\b|^\[\w+:warn|\[Warn/.test(t.slice(0, 220)) ? "w" : "");
async function load(start) {
  const R = LG.reader; $("#rl").innerHTML = '<div class="spin">Reading...</div>';
  try { const j = await api("/api/readfile", { path: S.path, node: R.node, file: R.file, start, n: 200 }); R.start = j.start; R.total = j.total; R.lines = j.lines; R.cmd = j.command; paintLines(); }
  catch (e) { $("#rl").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
function drawReader() {
  const R = LG.reader, m = (S.fileMap[R.node] || {})[R.file] || {}, info = fileInfo(R.file), others = dnodes().filter(n => S.fileMap[n] && S.fileMap[n][R.file]);
  $("#page").innerHTML = `<div class="wrap wide"><div class="crumb"><a id="rb">Log files</a> &rsaquo; Reading</div>
    <h1><span class="mono">${esc(R.file)}</span> on ${dot(R.node)}${esc(nshort(R.node))}</h1>
    <p class="lead">${esc(info.desc || "")}${info.desc ? " &middot; " : ""}${esc(fmtSize(m.size || 0))}${m.first ? ` &middot; covers ${esc(m.first)} to ${esc(m.last)} UTC` : ""}</p>
    <div class="card tight"><div class="row" style="gap:18px"><div class="row" style="gap:6px"><span class="hint">Same file on</span>${others.map(n => `<span class="chip ${n === R.node ? "on" : ""}" data-sw="${esc(n)}">${esc(nshort(n))}</span>`).join("")}</div>
      <form class="row" id="gt" style="gap:6px"><span class="hint">Go to time</span><input id="gtv" placeholder="2026-10-13 01:33" style="width:190px"><button class="btn sm" type="submit">Go</button></form>
      <form class="row" id="ff" style="gap:6px"><span class="hint">Find in this file</span><input id="ffv" placeholder="text or regex" style="width:220px" value="${esc(LG.findq)}"><button class="btn sm" type="submit">Find</button></form></div>
      <div class="hint" id="gtmsg" style="min-height:18px;margin-top:4px"></div></div>
    <div class="card" id="fm" style="display:none"></div>
    <div class="card"><div class="row sp" style="margin-bottom:10px"><div class="row" id="pg"></div><span class="hint">Click a line to select it, shift-click for a range, or drag to select text.</span></div><div id="rl"></div>
      <div class="selbar" id="xsb"><b id="xsn"></b><button class="btn" id="sb1">Copy lines</button><button class="btn primary" id="sb2">Copy lines + command</button><button class="btn" id="sb4">Add to reply draft</button><button class="btn" id="sb5">Clear</button></div></div></div>`;
  $("#rb").onclick = () => { LG.reader = null; go("logs"); };
  $$("[data-sw]").forEach(c => c.onclick = () => { LG.reader.node = c.dataset.sw; LG.sel.clear(); drawReader(); });
  $("#gt").onsubmit = async e => { e.preventDefault(); const v = $("#gtv").value.trim(); if (!v) return; $("#gtmsg").textContent = "Looking...";
    try { const j = await api("/api/findline", { path: S.path, node: R.node, file: R.file, time: v }); $("#gtmsg").textContent = ""; LG.hit = j.line; load(Math.max(1, j.line - 8)); } catch (er) { $("#gtmsg").innerHTML = `<span class="err">${esc(er.message.replace(/^ValueError: /, "").slice(0, 160))}</span>`; } };
  $("#ff").onsubmit = async e => { e.preventDefault(); const v = $("#ffv").value; LG.findq = v; if (!v) return; const box = $("#fm"); box.style.display = "block"; box.innerHTML = '<div class="spin">Searching the file...</div>';
    try { const j = await api("/api/grepfile", { path: S.path, node: R.node, file: R.file, regex: v, limit: 300 });
      box.innerHTML = `<div class="row sp"><b>${j.rows.length}${j.truncated ? "+" : ""} matching lines</b><button class="btn sm quiet" id="fmx">Close</button></div><div class="hint" style="margin-bottom:6px">Click a line to read it in place.</div>${j.rows.map(r => `<div class="rl" data-j="${r.line}" style="cursor:pointer"><span class="n">${r.line}</span><span class="t mono">${esc(r.text.slice(0, 260))}</span></div>`).join("") || '<div class="muted">No line matches.</div>'}`;
      $("#fmx").onclick = () => { box.style.display = "none"; }; $$("#fm [data-j]").forEach(d => d.onclick = () => { LG.hit = +d.dataset.j; load(Math.max(1, LG.hit - 8)); window.scrollTo({ top: 0, behavior: "smooth" }); }); }
    catch (er) { box.innerHTML = `<div class="err">${esc(er.message.replace(/^ValueError: /, ""))}</div>`; } };
  $("#sb1").onclick = () => copyText(selLines().map(x => x.t).join("\n"), `Copied ${LG.sel.size} lines`);
  $("#sb2").onclick = () => copyText(blocks().map(b => evidenceText(b)).join("\n\n"), "Copied lines with the command");
  $("#sb4").onclick = () => addEvidence(blocks()); $("#sb5").onclick = () => { LG.sel.clear(); paintSel(); };
  load(R.start);
}
function selLines() { const R = LG.reader; return R.lines.map((t, i) => ({ n: R.start + i, t })).filter(x => LG.sel.has(x.n)); }
function blocks() {
  const R = LG.reader, ls = selLines(), out = []; let run = [];
  const flush = () => { if (run.length) out.push({ label: `${nshort(R.node)}, ${R.file}`, command: `sed -n '${run[0].n},${run[run.length - 1].n}p' ${R.file}`, output: run.map(x => x.t).join("\n") }); run = []; };
  ls.forEach(x => { if (run.length && x.n !== run[run.length - 1].n + 1) flush(); run.push(x); }); flush(); return out;
}
function paintLines() {
  const R = LG.reader, end = R.start + R.lines.length - 1;
  $("#pg").innerHTML = `<button class="btn sm" data-pg="first">First</button><button class="btn sm" data-pg="prev">&lsaquo; Previous 200</button><b class="sm">lines ${R.start.toLocaleString()} to ${end.toLocaleString()} of ${R.total.toLocaleString()}</b><button class="btn sm" data-pg="next">Next 200 &rsaquo;</button><button class="btn sm" data-pg="last">Last</button>`;
  $$("#pg [data-pg]").forEach(b => b.onclick = () => { const k = b.dataset.pg; load(k === "first" ? 1 : k === "prev" ? R.start - 200 : k === "next" ? R.start + 200 : Math.max(1, R.total - 199)); window.scrollTo({ top: 0 }); });
  $("#rl").innerHTML = R.lines.map((t, i) => { const n = R.start + i; return `<div class="rl ${lvCls(t)} ${LG.sel.has(n) ? "sel" : ""} ${n === LG.hit ? "hit" : ""}" data-n="${n}"><span class="n">${n}</span><span class="t mono">${esc(t)}</span></div>`; }).join("") || '<div class="empty">This part of the file is empty.</div>';
  $$("#rl .rl").forEach(d => d.onclick = e => { if (String(window.getSelection()).length) return; const n = +d.dataset.n;
    if (e.shiftKey && LG.last) { const [a, b] = [Math.min(LG.last, n), Math.max(LG.last, n)]; for (let i = a; i <= b; i++) LG.sel.add(i); } else if (LG.sel.has(n)) LG.sel.delete(n); else LG.sel.add(n); LG.last = n; paintSel(); });
  const h = $("#rl .hit"); if (h) h.scrollIntoView({ block: "center" });
  paintSel();
}
function paintSel() { $$("#rl .rl").forEach(d => d.classList.toggle("sel", LG.sel.has(+d.dataset.n))); const sb = $("#xsb"); if (!sb) return; sb.classList.toggle("on", LG.sel.size > 0); $("#xsn").textContent = `${LG.sel.size} selected`; }
})();
