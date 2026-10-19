// Step 3: what to look for. Suggestions from the ticket itself, then the usual questions, then known problems.
(function () {
const cats = () => ((S.cfg && S.cfg.categories) || []).filter(c => c.enabled !== false);
const specOf = c => ({ id: c.id, title: c.title, desc: c.desc, rx: c.rx, files: c.files, fixed: c.fixed, pcre2: c.pcre2, counts: c.counts, extra: c.extra, group: c.group, keywords: c.keywords || [], components: c.components || [], case_types: c.case_types || [] });
const GROUP_CAP = { "Cluster": "Things that happen to the cluster as a whole.", "Services": "Problems inside one service.", "General": "Broad checks that apply to anything.", "REST access": "Counts from the REST access log, per node." };
window.questionList = () => cats().map(specOf);
let moms = null, momKey = "", sigReq = false;
window.startReset = () => { moms = null; momKey = ""; };
HOOKS.questions = () => { moms = null; PAGES.questions(); };

const present = files => files.filter(f => Object.values(S.fileMap || {}).some(m => m[f]));
const launch = spec => window.startAnalysis(spec);
const md = t => esc(String(t).replace(/^(\d+\.|[-*])\s+/, "")).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
const cut = (t, n) => (t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "..." : t);

function suggestions(vis) {
  const i = S.info; if (!i) return [];
  const text = ((i.subject || "") + " " + (i.description || "").slice(0, 1800)).toLowerCase(), tr = i.triage || {}, comps = i.components.map(c => c.toLowerCase()).concat(tr.component ? [tr.component.toLowerCase()] : []), ct = (tr.case_type || "").toLowerCase(), out = [];
  vis.forEach(q => {
    const ch = (q.components || []).map(w => w.toLowerCase()).find(w => w && comps.some(c => c.includes(w)));
    const kws = (q.keywords || []).filter(k => k && text.includes(k.toLowerCase()));
    const cs = (q.case_types || []).map(w => w.toLowerCase()).find(w => w && ct.includes(w));
    const score = (ch ? 10 : 0) + (cs ? 8 : 0) + kws.length; if (!score) return;
    out.push({ q, score, why: ch ? `The ticket's Component field is "${tr.component && tr.component.toLowerCase().includes(ch) ? tr.component : (i.components.find(c => c.toLowerCase().includes(ch)) || ch)}"` : cs ? `The ticket's Case Type is "${tr.case_type}"` : `The ticket mentions "${kws[0].slice(0, 28)}"` });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, 4);
}
function related(sigs) {
  const i = S.info; if (!i || !sigs) return new Set();
  const text = ((i.subject || "") + " " + (i.description || "").slice(0, 1800) + " " + i.components.join(" ")).toLowerCase(), sc = [];
  sigs.forEach(s => { const ws = (s.title + " " + s.component).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !["error", "errors", "server", "process", "service", "limit"].includes(w)); const n = ws.filter(w => text.includes(w)).length; if (n) sc.push([n, s.id]); });
  return new Set(sc.sort((a, b) => b[0] - a[0]).slice(0, 4).map(x => x[1]));
}

PAGES.questions = function () {
  if (!S.path) { go("tickets"); return; }
  if (!S.cfg) { api("/api/config").then(c => { S.cfg = c; if (S.page === "questions") PAGES.questions(); }); $("#page").innerHTML = '<div class="wrap"><div class="spin">Loading the questions...</div></div>'; return; }
  const cov = pickCoverage(), sigs = S.sigs, hits = {}; if (S.scan && S.scan.findings) S.scan.findings.forEach(f => { hits[f.id] = f; });
  const vis = cats().map(specOf).filter(q => present(q.files).length), sug = suggestions(vis), rel = related(sigs);
  const groups = []; vis.forEach(q => { let g = groups.find(x => x.name === q.group); if (!g) groups.push(g = { name: q.group, items: [] }); g.items.push(q); });
  const byC = {}; (sigs || []).forEach(s => (byC[s.component] = byC[s.component] || []).push(s));
  const th = (S.info && S.info.themes) || [], ps = pickSummary();
  $("#page").innerHTML = `<div class="wrap">${ticketBanner()}
  <section class="hero"><div class="row sp"><h1>What would you like to find out?</h1><button class="btn" id="cust" title="Add, edit or remove the questions and known problems, and choose which log files each one reads">Customize questions</button></div>
    <p class="lead">Reading ${ps.files} log files on ${ps.nodes} nodes${cov ? `, from ${esc(fromEpoch(cov.min).slice(0, 10))} to ${esc(fromEpoch(cov.max).slice(0, 10))} UTC` : ""}. <a id="chg">Change log files</a></p>
    <form class="bigsearch" id="bs"><input id="bigq" autocomplete="off" spellcheck="false" placeholder="Search every node's logs for any text, for example failover or Slow runtime"><button class="btn primary" type="submit">Search</button></form>
    <label class="hint"><input type="checkbox" id="bigfx"> Treat what I typed as plain text, not a regular expression</label></section>
  ${sug.length ? `<section><h2 class="sechead">Suggested for this ticket</h2><p class="cap">Picked from the ticket's component, subject and description.</p><div class="tiles">${sug.map((s, i) => `<div class="tile sug" data-s="${i}"><b>${esc(s.q.title)}</b><span>${esc(s.q.desc)}</span><span class="why">${esc(s.why)}</span></div>`).join("")}</div></section>` : ""}
  <section><h2 class="sechead">Worth a look first</h2><p class="cap">Spots in these logs with a burst of errors, or where a node that was logging went quiet.</p><div class="card tight" id="moms"><div class="spin">Reading the logs to find them...</div></div></section>
  ${groups.map(g => `<section><h2 class="sechead">${esc(g.name)}</h2><p class="cap">${esc(GROUP_CAP[g.name] || "")}</p><div class="tiles">${g.items.map(q => `<div class="tile" data-q="${vis.indexOf(q)}"><b>${esc(q.title)}</b><span>${esc(q.desc)}</span></div>`).join("")}</div></section>`).join("") || '<div class="muted">None of the log files these questions read are in this collection. Pick files on the Log files step, or change the questions in Customize.</div>'}
  <section id="known"><div class="row sp" style="margin-top:34px"><div><h2>Known problems</h2><p class="cap" style="margin:4px 0 0">Patterns of problems seen before. ${rel.size ? "Highlighted ones are mentioned by this ticket. " : ""}Pick one to see where it shows up, or check which of them happened here.</p></div>
    <button class="btn" id="scan" ${S.scan === "busy" ? "disabled" : ""}>${S.scan === "busy" ? "Checking every node..." : S.scan ? "Check again" : "Check which of these happened"}</button></div>
    <div class="card" style="margin-top:12px">${sigs ? Object.entries(byC).map(([c, a]) => `<div class="row" style="align-items:flex-start;padding:6px 0"><span class="hint" style="width:110px;padding-top:4px">${esc(c)}</span><div class="row" style="gap:8px;flex:1">${a.sort((x, y) => (hits[y.id] ? hits[y.id].total : -1) - (hits[x.id] ? hits[x.id].total : -1)).map(s => `<span class="chip ${hits[s.id] ? "on" : ""} ${rel.has(s.id) ? "rel" : ""} ${S.scan && S.scan !== "busy" && !hits[s.id] ? "off" : ""}" data-sg="${esc(s.id)}" title="${esc(s.meaning)}">${esc(s.title)}${hits[s.id] ? ` <b>${hits[s.id].total.toLocaleString()}</b>` : ""}</span>`).join("")}</div></div>`).join("") : '<div class="spin">Loading...</div>'}</div></section>
  ${th.length ? `<section><h2 class="sechead">How past tickets like this were diagnosed</h2><p class="cap">Distilled from earlier tickets with the same component (the mined themes in the main repo). Read it for ideas on where to look.</p>${th.map(t => `<details class="card theme"><summary>${esc(t.name)} tickets</summary>${t.sections.map(sec => `<h3 style="margin:14px 0 6px">${esc(sec.title)}</h3><ul>${sec.items.slice(0, 8).map(it => `<li>${md(cut(it, 330))}</li>`).join("")}</ul>`).join("")}</details>`).join("")}</section>` : ""}
  </div>`;
  $("#chg").onclick = () => go("logs"); $("#cust").onclick = () => go("config");
  $("#bs").onsubmit = e => { e.preventDefault(); const t = $("#bigq").value.trim(); if (!t) return; launch({ title: "Search: " + t, desc: "Every line that matches your search, on the log files you picked.", rx: t, fixed: $("#bigfx").checked, files: null }); };
  $$("[data-s]").forEach(t => t.onclick = () => launch(Object.assign({}, sug[+t.dataset.s].q)));
  $$("[data-q]").forEach(t => t.onclick = () => launch(Object.assign({}, vis[+t.dataset.q])));
  $$("[data-sg]").forEach(t => t.onclick = () => { const s = sigs.find(x => x.id === t.dataset.sg), f = hits[s.id];
    launch({ title: s.title, desc: s.meaning + (s.next ? " Next: " + s.next : ""), rx: s.regex, files: s.files, pcre2: (s.flags || []).includes("-P"), signature: true,
      time: f ? `${fromEpoch(Math.min(...f.hits.map(h => toEpoch(h.first))) - 300)} to ${fromEpoch(Math.max(...f.hits.map(h => toEpoch(h.last))) + 300)}` : undefined }); });
  $("#scan").onclick = async () => { S.scan = "busy"; keepScroll(() => PAGES.questions()); try { S.scan = await api("/api/scan", { path: S.path }); } catch (e) { S.scan = null; toast(e.message); } keepScroll(() => PAGES.questions()); };
  if (!sigs && !sigReq) { sigReq = true; api("/api/signatures").then(x => { S.sigs = x; sigReq = false; if (S.page === "questions") keepScroll(() => PAGES.questions()); }).catch(() => {}); }
  loadMoments();
};

async function loadMoments() {
  const key = S.path + "|" + pickParam(), el = $("#moms"); if (!el) return;
  if (!moms || momKey !== key) { try { moms = await api("/api/moments", { path: S.path, pick: pickParam() }); momKey = key; } catch (e) { moms = []; } }
  const el2 = $("#moms"); if (!el2) return;
  if (!moms.length) { el2.innerHTML = '<div class="muted" style="padding:6px 0">Nothing stands out: no bursts of errors, and no node went quiet for long.</div>'; return; }
  el2.innerHTML = moms.slice(0, 8).map((m, i) => `<div class="look"><i class="dot" style="background:var(${m.kind === "errors" ? "--bad" : "--warn"})"></i>
    <div class="grow"><b>${m.kind === "errors" ? `${m.n.toLocaleString()} errors in 10 minutes` : `${esc(nshort(m.node))} logged nothing for ${esc(secs(m.n))}`}</b>
    <span class="muted"> ${m.kind === "errors" ? `, most on ${esc(nshort(m.node))}` : ""} &middot; ${esc(fromEpoch(m.from).slice(0, 16))} to ${esc(fromEpoch(m.to).slice(11, 16))} UTC</span></div>
    <button class="btn sm" data-m="${i}">Open</button></div>`).join("");
  $$("[data-m]").forEach(b => b.onclick = () => { const m = moms[+b.dataset.m];
    launch({ title: m.kind === "errors" ? `Errors around ${fromEpoch(m.from).slice(5, 16)}` : `${nshort(m.node)} quiet from ${fromEpoch(m.from).slice(5, 16)}`, desc: m.kind === "errors" ? "What was logged around this burst of errors, on every node." : "What was logged on every node around the time this node went quiet.",
      rx: "", files: null, time: `${fromEpoch(m.from - 300)} to ${fromEpoch(m.to + 300)}`, sort: m.kind === "errors" ? "err" : "n" }); });
}
})();
