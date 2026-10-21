// Sources: a drawer over the workspace to choose which log files are read on which nodes. Rows are files, columns are nodes.
(function () {
const SRC = { draft: null, q: "", other: false, shut: new Set() };
const TINY = 2048;
const nodesAll = () => dnodes().filter(n => S.fileMap && S.fileMap[n]);
const has = (n, f) => !!(S.fileMap[n] && S.fileMap[n][f]);
const on = (n, f) => (SRC.draft[n] || []).includes(f);
function put(n, f, v) { const a = new Set(SRC.draft[n] || []); v ? a.add(f) : a.delete(f); SRC.draft[n] = [...a]; if (!SRC.draft[n].length) delete SRC.draft[n]; }
function rows() {
  const names = new Set(); Object.values(S.fileMap).forEach(m => Object.keys(m).forEach(f => names.add(f)));
  const q = SRC.q.trim().toLowerCase(), out = [];
  names.forEach(f => {
    const nodes = nodesAll().filter(n => has(n, f)), big = nodes.filter(n => S.fileMap[n][f].size >= TINY), fi = fileInfo(f);
    let group = fi.group; if (!big.length) group = "Nearly empty files";
    if (group === "Other files" && !SRC.other && !q) return;
    if (q && !(f.toLowerCase().includes(q) || fi.desc.toLowerCase().includes(q))) return;
    const sz = (big.length ? big : nodes).map(n => S.fileMap[n][f].size);
    out.push({ f, group, desc: fi.desc, nodes, min: Math.min(...sz), max: Math.max(...sz) });
  });
  const order = GROUPS.map(g => g.label).concat(["Other logs", "Other files", "Nearly empty files"]);
  return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.f.localeCompare(b.f));
}
const total = () => { let files = 0; const ns = new Set(); Object.entries(SRC.draft).forEach(([n, a]) => { files += a.length; if (a.length) ns.add(n); }); return { files, nodes: ns.size }; };
const hits = () => { const r = window.wsCounts && window.wsCounts(); const m = {}; (r || []).forEach(c => { m[c.node + "\0" + c.file] = c.n; }); return Object.keys(m).length ? m : null; };

window.openSources = function () {
  if (!S.fileMap) return;
  SRC.draft = JSON.parse(JSON.stringify(S.pick)); let el = $("#xsrc");
  if (!el) { el = document.createElement("div"); el.id = "xsrc"; document.body.appendChild(el); }
  el.style.display = "block"; document.body.classList.add("src-open"); draw(); setTimeout(() => { const q = $("#srcq"); if (q) q.focus(); }, 50);
};
function close() { const el = $("#xsrc"); if (el) el.style.display = "none"; document.body.classList.remove("src-open"); }
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#xsrc") && $("#xsrc").style.display === "block") close(); });

function draw() {
  const el = $("#xsrc"), nodes = nodesAll(), rs = rows(), H = hits(), t = total();
  const groups = []; rs.forEach(r => { let g = groups.find(x => x.name === r.group); if (!g) groups.push(g = { name: r.group, rows: [] }); g.rows.push(r); });
  const keep = el.querySelector(".srcbody") ? el.querySelector(".srcbody").scrollTop : 0;
  el.innerHTML = `<div class="srcback" id="srcback"></div><aside class="srcdrawer">
    <div class="srchead"><div class="row sp"><h2>Log files</h2><button class="btn quiet" id="srcx" title="Close (Esc)">&times;</button></div>
      <div class="row" style="gap:6px;margin:8px 0"><span class="hint">Quick picks</span><span class="chip" data-qp="main">Main logs</span><span class="chip" data-qp="all">Every .log file</span><span class="chip" data-qp="none">Clear all</span>
        <input id="srcq" placeholder="Filter files" value="${esc(SRC.q)}" style="margin-left:auto;width:170px"><label class="hint"><input type="checkbox" id="srco" ${SRC.other ? "checked" : ""}> other files</label></div>
      <div class="hint">Click a dot to read that file on that node. Click a file name to toggle it on every node, a node name to toggle all of its files.${H ? " Numbers are the lines that matched your current search." : ""}</div></div>
    <div class="srcbody"><table class="srcgrid"><thead><tr><th class="fcol"></th>${nodes.map(n => { const a = (SRC.draft[n] || []).length; return `<th data-nc="${esc(n)}" title="${esc(n)}: click to ${a ? "leave out" : "include"} the node">${dot(n)}<div>${esc(nshort(n))}</div><span class="hint">${esc(nodeServices(n))}</span></th>`; }).join("")}</tr></thead>
      ${groups.map(g => { const shut = SRC.shut.has(g.name); return `<tbody><tr class="gh" data-g="${esc(g.name)}"><td colspan="${nodes.length + 1}">${shut ? "&#9656;" : "&#9662;"} ${esc(g.name)} <span class="hint">${g.rows.length}</span></td></tr>${shut ? "" : g.rows.map(r => {
        const n_on = r.nodes.filter(n => on(n, r.f)).length, st = n_on === 0 ? "" : n_on === r.nodes.length ? "checked" : "mixed";
        return `<tr class="fr"><td class="fcol"><label title="${esc(r.desc || r.f)}"><input type="checkbox" data-fr="${esc(r.f)}" ${st === "checked" ? "checked" : ""} ${st === "mixed" ? 'class="mix"' : ""}><span class="mono">${esc(r.f)}</span></label><div class="hint">${esc(r.desc)}${r.desc ? " &middot; " : ""}${esc(r.min === r.max ? fmtSize(r.max) : fmtSize(r.min) + " to " + fmtSize(r.max))}</div></td>${nodes.map(n => {
          if (!has(n, r.f)) return '<td class="c none">&ndash;</td>'; const k = on(n, r.f), c = H && H[n + "\0" + r.f];
          return `<td class="c ${k ? "on" : ""}" data-c="${esc(n)}" data-f="${esc(r.f)}" title="${esc(nshort(n) + " · " + r.f + " · " + fmtSize(S.fileMap[n][r.f].size))}">${k ? (c ? compact(c) : "&#9679;") : "&#9675;"}</td>`; }).join("")}</tr>`; }).join("")}</tbody>`; }).join("")}
    </table>${groups.length ? "" : '<div class="empty">No file matches that filter.</div>'}</div>
    <div class="srcfoot"><div><b>${t.files}</b> files on <b>${t.nodes}</b> node${t.nodes === 1 ? "" : "s"}${t.files ? "" : ' <span class="warn">Pick at least one file.</span>'}</div><div class="row"><button class="btn" id="srcc">Cancel</button><button class="btn primary" id="srca" ${t.files ? "" : "disabled"}>Apply</button></div></div></aside>`;
  el.querySelector(".srcbody").scrollTop = keep;
  el.querySelectorAll("input.mix").forEach(i => (i.indeterminate = true));
  $("#srcx").onclick = $("#srcback").onclick = $("#srcc").onclick = close;
  $("#srca").onclick = () => { if (!t.files) return; S.pick = SRC.draft; savePick(); close(); S.narrowed = false; if (HOOKS.workspace && S.page === "workspace") HOOKS.workspace(); toast(`Reading ${t.files} files on ${t.nodes} nodes`); };
  $("#srcq").oninput = e => { SRC.q = e.target.value; const p = e.target.selectionStart; draw(); const q = $("#srcq"); q.focus(); q.setSelectionRange(p, p); };
  $("#srco").onchange = e => { SRC.other = e.target.checked; draw(); };
  el.querySelectorAll("[data-qp]").forEach(c => c.onclick = () => {
    const k = c.dataset.qp; SRC.draft = {};
    if (k !== "none") nodesAll().forEach(n => { const a = Object.keys(S.fileMap[n]).filter(f => (k === "main" ? MAIN_FILES.includes(f) : /\.log$/.test(f) && S.fileMap[n][f].size >= TINY)); if (a.length) SRC.draft[n] = a; });
    draw(); });
  el.querySelectorAll("[data-c]").forEach(c => c.onclick = () => { put(c.dataset.c, c.dataset.f, !on(c.dataset.c, c.dataset.f)); draw(); });
  el.querySelectorAll("[data-fr]").forEach(i => i.onchange = () => { const f = i.dataset.fr, ns = nodesAll().filter(n => has(n, f)), all = ns.every(n => on(n, f)); ns.forEach(n => put(n, f, !all)); draw(); });
  el.querySelectorAll("[data-nc]").forEach(h => h.onclick = () => { const n = h.dataset.nc;
    if ((SRC.draft[n] || []).length) delete SRC.draft[n]; else { const want = new Set(Object.values(SRC.draft).flat()); if (!want.size) MAIN_FILES.forEach(f => want.add(f)); const a = [...want].filter(f => has(n, f)); if (a.length) SRC.draft[n] = a; } draw(); });
  el.querySelectorAll("[data-g]").forEach(h => h.onclick = () => { const g = h.dataset.g; SRC.shut.has(g) ? SRC.shut.delete(g) : SRC.shut.add(g); draw(); });
}
})();
