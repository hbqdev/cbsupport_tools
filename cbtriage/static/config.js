// Customize: the questions and the known problems are data. Add, edit, reorder and delete them, choose the log files each one reads,
// and test a pattern on the open ticket. Saved to files with a backup every time, so cbtriage can keep evolving.
(function () {
const C = { tab: "cats", cats: [], sigs: [], sel: 0, dirty: false, test: null, msg: "" };
const clone = x => JSON.parse(JSON.stringify(x));
const list = () => (C.tab === "cats" ? C.cats : C.sigs);
const globRx = g => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
const allNames = () => { const n = new Set(); GROUPS.forEach(g => Object.keys(g.files).forEach(f => n.add(f))); Object.values(S.fileMap || {}).forEach(m => Object.keys(m).forEach(f => /\.log$/.test(f) && n.add(f))); return [...n].sort(); };
const mark = () => { C.dirty = true; drawBar(); };

PAGES.config = async function () {
  $("#page").innerHTML = '<div class="wrap wide"><div class="spin">Loading...</div></div>';
  try { const cfg = await api("/api/config"); S.cfg = cfg; C.cats = clone(cfg.categories); C.sigs = clone(cfg.signatures); C.customized = cfg.customized; C.paths = cfg.paths; C.seen = cfg.seen || {}; }
  catch (e) { $("#page").innerHTML = `<div class="wrap"><div class="err">${esc(e.message)}</div></div>`; return; }
  C.dirty = false; C.msg = ""; C.sel = Math.min(C.sel, Math.max(0, list().length - 1)); C.test = null; draw();
};
function draw() {
  $("#page").innerHTML = `<div class="wrap wide"><div class="crumb"><a id="cbk">&lsaquo; Back</a></div><h1>Customize</h1>
    <p class="lead">The Question screen is built from these lists. Change them as you learn what works: add a question, change which log files it reads, fix a pattern. Changes are saved to files and every save keeps a backup.</p>
    <div class="row" style="margin-bottom:16px"><button class="chip ${C.tab === "cats" ? "on" : ""}" data-tab="cats">Questions (${C.cats.length})</button><button class="chip ${C.tab === "sigs" ? "on" : ""}" data-tab="sigs">Known problems (${C.sigs.length})</button>
      <span class="hint" style="margin-left:10px">${C.tab === "cats" ? "The tiles on the Question screen." : "Patterns of problems seen before; the Question screen can check which of them happened."}</span></div>
    <div class="cfg"><aside class="card cfglist" id="cfl"></aside><section class="card" id="cff"></section></div>
    <div class="stickybar"><div id="cfst"></div><div class="row" id="cfb"></div></div></div>`;
  $("#cbk").onclick = () => { history.back(); };
  $$("[data-tab]").forEach(b => b.onclick = () => { C.tab = b.dataset.tab; C.sel = 0; C.test = null; draw(); });
  drawList(); drawForm(); drawBar();
}
function drawList() {
  const L = list(), key = C.tab === "cats" ? "group" : "component", groups = [];
  L.forEach((it, i) => { let g = groups.find(x => x.n === (it[key] || "Other")); if (!g) groups.push(g = { n: it[key] || "Other", items: [] }); g.items.push(i); });
  $("#cfl").innerHTML = `<button class="btn primary" id="cnew" style="width:100%;margin-bottom:10px">+ New ${C.tab === "cats" ? "question" : "known problem"}</button>` +
    groups.map(g => `<div class="hint" style="margin:12px 4px 4px;text-transform:uppercase;letter-spacing:.05em">${esc(g.n)}</div>${g.items.map(i => `<div class="citem ${i === C.sel ? "on" : ""} ${L[i].enabled === false ? "off" : ""}" data-i="${i}"><b>${esc(L[i].title || "(untitled)")}</b><div class="hint">${L[i].files.length} log file${L[i].files.length === 1 ? "" : "s"}${L[i].enabled === false ? " &middot; hidden" : ""}</div></div>`).join("")}`).join("");
  $$("#cfl .citem").forEach(d => d.onclick = () => { C.sel = +d.dataset.i; C.test = null; drawList(); drawForm(); });
  $("#cnew").onclick = () => {
    const n = C.tab === "cats" ? { id: "", title: "New question", group: "General", desc: "", rx: "", files: ["ns_server.info.log"], keywords: [], components: [], counts: false, fixed: false, pcre2: false, extra: "", enabled: true }
      : { id: "", title: "New known problem", component: "other", severity: "medium", files: ["ns_server.info.log"], regex: "", meaning: "", next: "" };
    list().push(n); C.sel = list().length - 1; mark(); drawList(); drawForm(); $("#f_title").focus(); $("#f_title").select();
  };
}
const csv = t => t.split(",").map(x => x.trim()).filter(Boolean);
const seenChips = (name, id) => { const v = (C.seen && C.seen[name]) || []; return v.length ? `<div class="row" style="margin-top:6px;gap:6px"><span class="hint">Seen on your tickets:</span>${v.map(x => `<span class="chip" data-seen="${id}|${esc(x)}" title="Add this">${esc(x)}</span>`).join("")}</div>` : ""; };
function drawForm() {
  const L = list(), it = L[C.sel], el = $("#cff"); if (!it) { el.innerHTML = '<div class="empty">Nothing here yet. Use "New" on the left.</div>'; return; }
  const cats = C.tab === "cats", rxk = cats ? "rx" : "regex", pc = cats ? !!it.pcre2 : (it.flags || []).includes("-P");
  const groupsList = [...new Set(C.cats.map(c => c.group))], comps = [...new Set(C.sigs.map(s => s.component))];
  el.innerHTML = `<div class="row sp"><h2>${esc(it.title || "(untitled)")}</h2><div class="row"><button class="btn sm" id="fup" ${C.sel ? "" : "disabled"}>Move up</button><button class="btn sm" id="fdn" ${C.sel < L.length - 1 ? "" : "disabled"}>Move down</button><button class="btn sm" id="fdup">Duplicate</button><button class="btn sm" id="fdel">Delete</button></div></div>
    <div class="fld"><label class="l">Title</label><input id="f_title" style="width:100%" value="${esc(it.title)}"></div>
    ${cats ? `<div class="row" style="gap:16px;align-items:flex-start"><div class="fld grow"><label class="l">Group on the Question screen</label><input id="f_group" list="dg" style="width:100%" value="${esc(it.group)}"><datalist id="dg">${groupsList.map(g => `<option value="${esc(g)}">`).join("")}</datalist></div>
      <div class="fld"><label class="l">&nbsp;</label><label><input type="checkbox" id="f_en" ${it.enabled !== false ? "checked" : ""}> Show this question</label></div></div>
      <div class="fld"><label class="l">What it tells you</label><textarea id="f_desc" rows="2" style="width:100%">${esc(it.desc)}</textarea></div>`
    : `<div class="row" style="gap:16px"><div class="fld grow"><label class="l">Component</label><input id="f_comp" list="dc" style="width:100%" value="${esc(it.component)}"><datalist id="dc">${comps.map(g => `<option value="${esc(g)}">`).join("")}</datalist></div>
      <div class="fld"><label class="l">How serious</label><select id="f_sev">${["high", "medium", "low", "info"].map(v => `<option ${it.severity === v ? "selected" : ""}>${v}</option>`).join("")}</select></div></div>
      <div class="fld"><label class="l">What it means</label><textarea id="f_mean" rows="2" style="width:100%">${esc(it.meaning)}</textarea></div>
      <div class="fld"><label class="l">What to check next</label><textarea id="f_next" rows="2" style="width:100%">${esc(it.next)}</textarea></div>`}
    <div class="fld"><label class="l">What to search for</label><input id="f_rx" class="mono" style="width:100%" placeholder="A regular expression, or plain text if you tick the box below" value="${esc(it[rxk] || "")}">
      <div class="row" style="margin-top:6px;gap:16px"><label class="hint"><input type="checkbox" id="f_pc" ${pc ? "checked" : ""}> Uses look-around (PCRE2)</label>${cats ? `<label class="hint"><input type="checkbox" id="f_fx" ${it.fixed ? "checked" : ""}> Plain text, not a regex</label><label class="hint" title="Put the value to count in parentheses, for example user (\\\\w+)"><input type="checkbox" id="f_ct" ${it.counts ? "checked" : ""}> Count lines by the value in parentheses</label>` : ""}
        <button class="btn sm" id="ftest">Test on ${S.ticket ? "ticket " + esc(S.ticket) : "the open ticket"}</button></div><div id="ftres" class="hint" style="margin-top:8px"></div></div>
    <div class="fld"><label class="l">Log files to read <span class="hint" style="font-weight:400">on every node. Use * as a wildcard.</span></label><div class="row" id="ffiles" style="gap:6px;margin-bottom:8px"></div>
      <div class="row"><input id="f_addf" list="df" placeholder="Add a log file, for example ns_server.indexer.log" style="width:340px"><datalist id="df">${allNames().map(n => `<option value="${esc(n)}">`).join("")}</datalist><button class="btn sm" id="f_add">Add</button>
        <span class="hint">or add a whole group:</span>${GROUPS.filter(g => Object.keys(g.files).length).map(g => `<span class="chip" data-g="${g.id}" title="${esc(Object.keys(g.files).join(", "))}">+ ${esc(g.label)}</span>`).join("")}</div></div>
    ${cats ? `<div class="fld"><label class="l">Suggest it when the ticket mentions <span class="hint" style="font-weight:400">words, separated by commas</span></label><input id="f_kw" style="width:100%" value="${esc((it.keywords || []).join(", "))}"></div>
      <div class="fld"><label class="l">...or when the ticket's Component field contains <span class="hint" style="font-weight:400">words, separated by commas</span></label><input id="f_cm" style="width:100%" value="${esc((it.components || []).join(", "))}">${seenChips("Component", "f_cm")}</div>
      <div class="fld"><label class="l">...or when the ticket's Case Type contains</label><input id="f_ctp" style="width:100%" value="${esc((it.case_types || []).join(", "))}">${seenChips("Case Type", "f_ctp")}</div>
      <div class="fld"><label class="l">Also worth opening <span class="hint" style="font-weight:400">files this question should point at that the tool cannot search yet</span></label><input id="f_ex" style="width:100%" value="${esc(it.extra || "")}"></div>` : ""}`;
  const bind = (id, fn, ev) => { const e = $("#" + id); if (e) e[ev || "oninput"] = () => { fn(e); mark(); }; };
  bind("f_title", e => { it.title = e.value; drawList(); const h = $("#cff h2"); if (h) h.textContent = it.title || "(untitled)"; });
  bind("f_group", e => { it.group = e.value; }); bind("f_en", e => { it.enabled = e.checked; drawList(); }, "onchange"); bind("f_desc", e => { it.desc = e.value; });
  bind("f_comp", e => { it.component = e.value; }); bind("f_sev", e => { it.severity = e.value; }, "onchange"); bind("f_mean", e => { it.meaning = e.value; }); bind("f_next", e => { it.next = e.value; });
  bind("f_rx", e => { it[rxk] = e.value; });
  bind("f_pc", e => { if (cats) it.pcre2 = e.checked; else { it.flags = (it.flags || []).filter(f => f !== "-P"); if (e.checked) it.flags.push("-P"); } }, "onchange");
  bind("f_fx", e => { it.fixed = e.checked; }, "onchange"); bind("f_ct", e => { it.counts = e.checked; }, "onchange");
  bind("f_kw", e => { it.keywords = csv(e.value); }); bind("f_cm", e => { it.components = csv(e.value); }); bind("f_ctp", e => { it.case_types = csv(e.value); });
  $$("[data-seen]").forEach(c => c.onclick = () => { const [id, v] = c.dataset.seen.split("|"), inp = $("#" + id), cur = csv(inp.value), w = v.toLowerCase(); if (!cur.includes(w)) { cur.push(w); inp.value = cur.join(", "); inp.dispatchEvent(new Event("input")); } }); bind("f_ex", e => { it.extra = e.value; });
  const files = () => { $("#ffiles").innerHTML = it.files.map((f, k) => `<span class="chip on">${esc(f)} <span class="x" data-k="${k}">&times;</span></span>`).join("") || '<span class="warn">No log files yet. Add at least one.</span>';
    $$("#ffiles [data-k]").forEach(x => x.onclick = () => { it.files.splice(+x.dataset.k, 1); files(); drawList(); mark(); }); };
  files();
  const add = f => { f = f.trim(); if (f && !it.files.includes(f)) { it.files.push(f); files(); drawList(); mark(); } };
  $("#f_add").onclick = () => { add($("#f_addf").value); $("#f_addf").value = ""; }; $("#f_addf").onkeydown = e => { if (e.key === "Enter") $("#f_add").click(); };
  $$("[data-g]").forEach(c => c.onclick = () => Object.keys(GROUPS.find(g => g.id === c.dataset.g).files).forEach(add));
  $("#fup").onclick = () => { [L[C.sel - 1], L[C.sel]] = [L[C.sel], L[C.sel - 1]]; C.sel--; mark(); drawList(); drawForm(); };
  $("#fdn").onclick = () => { [L[C.sel + 1], L[C.sel]] = [L[C.sel], L[C.sel + 1]]; C.sel++; mark(); drawList(); drawForm(); };
  $("#fdup").onclick = () => { const c = clone(it); c.title += " (copy)"; c.id = ""; L.splice(C.sel + 1, 0, c); C.sel++; mark(); drawList(); drawForm(); };
  let armed = false; $("#fdel").onclick = e => { if (!armed) { armed = true; e.target.textContent = "Click again to delete"; setTimeout(() => { armed = false; if ($("#fdel")) $("#fdel").textContent = "Delete"; }, 3000); return; } L.splice(C.sel, 1); C.sel = Math.max(0, C.sel - 1); mark(); drawList(); drawForm(); };
  $("#ftest").onclick = () => testIt(it, rxk, pc);
}
async function testIt(it, rxk, pc) {
  const out = $("#ftres"); const rx = it[rxk] || "";
  if (!S.path || !S.fileMap) { out.innerHTML = '<span class="warn">Open a ticket first, then come back to test on its logs.</span>'; return; }
  const pats = it.files.map(globRx), pick = {}; for (const [n, fs] of Object.entries(S.fileMap)) { const a = Object.keys(fs).filter(f => pats.some(p => p.test(f))); if (a.length) pick[n] = a; }
  if (!Object.keys(pick).length) { out.innerHTML = '<span class="warn">None of these log files are in ticket ' + esc(S.ticket) + ".</span>"; return; }
  out.textContent = "Testing on every node...";
  try {
    const p = await api("/api/profile", { path: S.path, regex: rx, pick: JSON.stringify(pick), time: S.range, icase: 1, fixed: it.fixed ? 1 : 0, pcre2: pc ? 1 : 0 });
    if (p.too_big) { out.innerHTML = `<span class="warn">With no search text this reads about ${p.estimate.toLocaleString()} lines. Type a pattern, or set a time range, to test.</span>`; return; }
    const hit = Object.entries(p.per_node).filter(([, n]) => n > 0);
    out.innerHTML = p.lines ? `<span class="ok"><b>${p.lines.toLocaleString()}</b> lines on ${hit.length} of ${p.nodes.length} nodes</span> in ${Object.keys(p.per_file).length} files. The most common kinds of line:<ul style="margin:6px 0 0;padding-left:20px">${p.patterns.slice(0, 3).map(q => `<li><b>${q.n.toLocaleString()}</b> <span class="mono">${esc(tplText(q.key).slice(0, 150))}</span></li>`).join("")}</ul>`
      : '<span class="warn">No lines match on this ticket. That may be fine for this ticket; check the pattern and the files if you expected hits.</span>';
  } catch (e) { out.innerHTML = `<span class="err">${esc(e.message.replace(/^ValueError: /, ""))}</span>`; }
}
const tplText = k => String(k).replace(/◇/g, "<time>").replace(/◆/g, "<#>").replace(/◈/g, "<id>");

function drawBar() {
  const st = $("#cfst"), bt = $("#cfb"); if (!st) return;
  st.innerHTML = C.msg ? C.msg : C.dirty ? "<b>Unsaved changes.</b> Nothing is used until you save." : C.tab === "cats" ? `Using ${C.customized ? "your own list" : "the built-in list"}. Saved in <span class="mono">config/categories.json</span>.` : 'Saved in <span class="mono">signatures.json</span>.';
  bt.innerHTML = `${C.dirty ? '<button class="btn" id="cdisc" style="background:transparent;color:inherit;border-color:rgba(255,255,255,.4)">Discard changes</button>' : ""}
    ${C.tab === "cats" ? '<button class="btn" id="crest" style="background:transparent;color:inherit;border-color:rgba(255,255,255,.4)">Restore built-in list</button>' : ""}
    <button class="btn" id="cexp" style="background:transparent;color:inherit;border-color:rgba(255,255,255,.4)">Export</button><button class="btn" id="cimp" style="background:transparent;color:inherit;border-color:rgba(255,255,255,.4)" data-pop>Import</button><button class="btn" id="csave" ${C.dirty ? "" : "disabled"}>Save</button>`;
  const d = $("#cdisc"); if (d) d.onclick = () => PAGES.config();
  $("#csave").onclick = save; $("#cexp").onclick = () => { const b = new Blob([JSON.stringify(list(), null, 1)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = (C.tab === "cats" ? "cbtriage-questions" : "cbtriage-known-problems") + ".json"; a.click(); };
  $("#cimp").onclick = e => pop(e.currentTarget, `<h3>Import</h3><div class="cap" style="margin:4px 0 8px">Paste a list exported from cbtriage. It replaces the ${C.tab === "cats" ? "questions" : "known problems"} on this screen; nothing is saved until you press Save.</div><textarea id="imp" rows="8" style="width:100%" class="mono"></textarea><div class="row" style="margin-top:8px"><button class="btn primary" id="impok">Use this list</button></div>`, p => {
    $("#impok").onclick = () => { try { const v = JSON.parse($("#imp").value); if (!Array.isArray(v)) throw new Error("expected a list"); if (C.tab === "cats") C.cats = v; else C.sigs = v; C.sel = 0; popClose(); mark(); drawList(); drawForm(); } catch (er) { toast("That is not a valid list: " + er.message); } }; });
  const r = $("#crest"); let armed = false; if (r) r.onclick = async e => { if (!armed) { armed = true; e.target.textContent = "Click again to restore"; setTimeout(() => { armed = false; if ($("#crest")) $("#crest").textContent = "Restore built-in list"; }, 3000); return; }
    try { const j = await (await fetch("/api/config/reset", { method: "POST", body: "{}" })).json(); S.cfg = null; toast("Restored the built-in list. Your previous list is kept as " + j.backup); PAGES.config(); } catch (er) { toast(er.message); } };
}
async function save() {
  const body = C.tab === "cats" ? { categories: C.cats } : { signatures: C.sigs };
  try {
    const r = await fetch("/api/config", { method: "POST", body: JSON.stringify(body) }), j = await r.json(); if (j.error) throw new Error(j.error);
    toast(`Saved ${j.count} ${C.tab === "cats" ? "questions" : "known problems"}${j.backup ? ". Previous version kept as " + j.backup : ""}`); S.cfg = null; if (C.tab === "sigs") S.sigs = null; C.dirty = false; C.msg = ""; await PAGES.config();
  } catch (e) { C.msg = `<span style="color:#ff9b94"><b>Not saved.</b> ${esc(e.message.replace(/^ValueError: /, ""))}</span>`; drawBar(); }
}
})();
