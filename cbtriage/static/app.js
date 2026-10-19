// cbtriage shell: top bar with the ticket box, scope strip, shared helpers, the reply draft, and the router.
// Screens live in start.js, logs.js and analyze.js.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const S = { tickets: [], ticket: "", path: "", colls: [], inv: null, fileMap: null, pick: {}, range: "", nodesOff: new Set(), page: "tickets", info: null, basket: [], dock: false, sigs: null, scan: null, hasAnalysis: false };
const PAGES = {}, HOOKS = {};

async function api(p, params) {
  const u = new URL(p, location.href);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== "" && v !== null) u.searchParams.set(k, v);
  const r = await fetch(u); const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
let toastT = 0;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 1800); }
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  toast(msg || "Copied");
}
const fromEpoch = e => new Date(e * 1000).toISOString().slice(0, 19).replace("T", " ");
const toEpoch = s => Date.parse(s.replace(" ", "T").replace(/Z$/, "") + "Z") / 1000;
const rxEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compact = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n.toLocaleString());
const fmtT = (e, one) => { const s = fromEpoch(e); return one ? s.slice(11) : s.slice(5); };
const fmtSize = n => (n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? Math.round(n / 1e6) + " MB" : n >= 1e3 ? Math.round(n / 1e3) + " KB" : n + " B");
const secs = s => { s = Math.round(s); if (s < 60) return s + "s"; if (s < 3600) return Math.floor(s / 60) + "m" + (s % 60 ? (s % 60) + "s" : ""); const m = Math.floor(s % 3600 / 60); return Math.floor(s / 3600) + "h" + (m ? m + "m" : ""); };
const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const dnodes = () => (S.inv ? S.inv.nodes.map(n => n.node) : S.fileMap ? Object.keys(S.fileMap) : []);
const nshort = n => { n = String(n); if (/^\d+\.\d+\.\d+\.\d+/.test(n)) return n; const f = n.split(".")[0], m = f.match(/-(\d{2,5})$/); return m ? m[1] : f; };
const ncolor = n => `hsl(${(Math.max(0, dnodes().indexOf(n)) * 53 + 12) % 360},62%,52%)`;
const dot = n => `<i class="dot" style="background:${ncolor(n)}"></i>`;
const busy = msg => { $("#page").innerHTML = `<div class="wrap"><div class="spin">${esc(msg || "Working...")}</div></div>`; };
const nodeServices = n => ((S.inv && S.inv.nodes.find(x => x.node === n)) || {}).services || "";

// ------------------------------------------------------------------ what the log files are
const GROUPS = [
  { id: "cm", label: "Cluster manager", files: { "ns_server.info.log": "Cluster events: failover, rebalance, node status", "ns_server.error.log": "Errors from the cluster manager", "ns_server.babysitter.log": "Starts, stops and crashes of Couchbase processes" } },
  { id: "cmd", label: "Cluster manager (debug)", files: { "ns_server.debug.log": "Very detailed cluster manager activity, including rebalance progress" } },
  { id: "kv", label: "Data service", files: { "memcached.log": "Data service: connections, slow operations, memory, DCP" } },
  { id: "xdcr", label: "XDCR", files: { "ns_server.goxdcr.log": "Cross data center replication" } },
  { id: "gsi", label: "Index", files: { "ns_server.indexer.log": "Index service", "ns_server.projector.log": "Feeds indexes from the data service" } },
  { id: "n1ql", label: "Query", files: { "ns_server.query.log": "Query service" } },
  { id: "fts", label: "Search", files: { "ns_server.fts.log": "Search (full text) service" } },
  { id: "ev", label: "Eventing", files: { "ns_server.eventing.log": "Eventing service" } },
  { id: "cbas", label: "Analytics", files: { "ns_server.analytics_info.log": "Analytics service", "ns_server.analytics_error.log": "Analytics errors" } },
  { id: "acc", label: "REST access", files: { "ns_server.http_access.log": "Every REST API call: who, what, status, size, time", "ns_server.http_access_internal.log": "REST calls between nodes" } },
  { id: "sys", label: "System and snapshots", files: { "diag.log": "Long retention cluster event log", "couchbase.log": "OS, services and configuration at collection time", "ns_server.stats.log": "Statistics snapshots", "stats.log": "Statistics snapshot" } },
];
const MAIN_FILES = ["ns_server.info.log", "ns_server.error.log", "ns_server.babysitter.log", "ns_server.debug.log", "memcached.log", "ns_server.goxdcr.log"];
const fileInfo = f => { for (const g of GROUPS) if (g.files[f]) return { group: g.label, gid: g.id, desc: g.files[f] }; return { group: /\.log$/.test(f) ? "Other logs" : "Other files", gid: "other", desc: "" }; };

// ------------------------------------------------------------------ which files are being read (per node, per file)
const pickKey = () => "pick:" + S.path;
function defaultPick() { const out = {}; for (const [n, fs] of Object.entries(S.fileMap || {})) { const a = MAIN_FILES.filter(f => fs[f]); if (a.length) out[n] = a; } return out; }
function loadPick() { try { const p = JSON.parse(localStorage.getItem(pickKey()) || "null"); if (p && Object.keys(p).length) { for (const n of Object.keys(p)) { if (!S.fileMap[n]) delete p[n]; else p[n] = p[n].filter(f => S.fileMap[n][f]); } if (Object.values(p).some(a => a.length)) return p; } } catch (e) {} return defaultPick(); }
function savePick() { try { localStorage.setItem(pickKey(), JSON.stringify(S.pick)); } catch (e) {} }
function effPick() { const o = {}; for (const [n, a] of Object.entries(S.pick)) if (a.length && !S.nodesOff.has(n)) o[n] = a; return o; }
const pickParam = () => JSON.stringify(effPick());
const pickFiles = () => [...new Set(Object.values(effPick()).flat())].sort();
function pickSummary() {
  const e = effPick(); let files = 0, bytes = 0; Object.entries(e).forEach(([n, a]) => a.forEach(f => { files++; bytes += ((S.fileMap[n] || {})[f] || {}).size || 0; }));
  return { nodes: Object.keys(e).length, files, bytes, types: pickFiles().length };
}
function setPickByNames(names, persist = true) { const o = {}; for (const [n, fs] of Object.entries(S.fileMap || {})) { const a = names.filter(f => fs[f]); if (a.length) o[n] = a; } if (Object.keys(o).length) { S.pick = o; if (persist) savePick(); return true; } return false; }
function pickCoverage() {
  let mn = 1e15, mx = 0; for (const [n, a] of Object.entries(effPick())) a.forEach(f => { const m = (S.fileMap[n] || {})[f]; if (m && m.first) { mn = Math.min(mn, toEpoch(m.first)); mx = Math.max(mx, toEpoch(m.last)); } });
  return mx ? { min: mn, max: mx } : null;
}
function scopeChanged() { drawScope(); if (HOOKS[S.page]) HOOKS[S.page](); }

// ------------------------------------------------------------------ popovers
function pop(anchor, html, after) {
  let p = $("#xpop");
  if (!p) { p = document.createElement("div"); p.id = "xpop"; p.className = "pop"; document.body.appendChild(p);
    document.addEventListener("mousedown", e => { if (!p.contains(e.target) && !e.target.closest("[data-pop]")) p.style.display = "none"; }); }
  p.innerHTML = html; p.style.display = "block";
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + innerWidth - 520)) + "px"; p.style.top = (window.scrollY + r.bottom + 8) + "px";
  if (after) after(p); return p;
}
const popClose = () => { const p = $("#xpop"); if (p) p.style.display = "none"; };

// ------------------------------------------------------------------ top bar and the ticket box
const STEPS = [["tickets", "1", "Ticket"], ["logs", "2", "Log files"], ["questions", "3", "Question"], ["analyze", "4", "Analysis"]];
function stepOk(k) { if (k === 'config') return true; return k === "tickets" || (k === "analyze" ? S.hasAnalysis : !!S.path); }
function drawTop() {
  $("#top").innerHTML = `<div class="logo"><i>cb</i>triage</div>
    <nav class="steps">${STEPS.map(([k, n, l], i) => `${i ? '<span class="sep">&rsaquo;</span>' : ""}<button data-p="${k}" class="${S.page === k ? "on" : ""}" ${stepOk(k) ? "" : 'disabled title="Finish the earlier steps first"'}><span class="n">${n}</span>${l}</button>`).join("")}</nav>
    ${S.ticket && S.path ? `<span class="tkpill" title="${esc(S.info ? S.info.subject : "")}">Ticket <b>${esc(S.ticket)}</b>${S.info && S.info.subject ? ` <span class="muted">${esc(S.info.subject.length > 46 ? S.info.subject.slice(0, 46) + "..." : S.info.subject)}</span>` : ""}</span>` : ""}
    ${S.colls.length > 1 ? `<select id="cl" title="Which collection of logs">${S.colls.map(x => `<option value="${esc(x.path)}" ${x.path === S.path ? "selected" : ""}>${esc(x.name)} (${x.nodes} nodes)</option>`).join("")}</select>` : ""}
    ${dlRunning().length ? `<button class="pillbtn" id="dlpill" title="A download is running. Click to see it.">Downloading ${esc(dlRunning().join(", "))} &middot; ${esc(secs(DL[dlRunning()[0]].seconds || 0))}</button>` : ""}<div class="grow"></div><button class="btn quiet" id="cfgbtn" title="Questions, known problems and the log files they read">Customize</button><button class="btn quiet" id="setbtn" title="Who you are, how tickets are listed, connections and folders">Settings</button><button class="btn" id="dockbtn" title="Lines, commands and notes you collected for your reply">Evidence for reply${S.basket.length ? " (" + S.basket.length + ")" : ""}</button>`;
  $$("#top .steps button").forEach(b => b.onclick = () => go(b.dataset.p));
  const cl = $("#cl"); if (cl) cl.onchange = e => { S.path = e.target.value; loadColl(); };
  $("#dockbtn").onclick = () => toggleDock(!S.dock);
  $("#cfgbtn").onclick = () => go("config"); $("#setbtn").onclick = () => go("settings");
  const dp = $("#dlpill"); if (dp) dp.onclick = () => showTicket(dlRunning()[0]);
}
function ticketBanner() {
  const i = S.info; if (!i) return "";
  const meta = [i.status && `<span class="pill ${i.status === "open" || i.status === "new" ? "medium" : ""}" style="text-transform:capitalize">${esc(i.status)}</span>`, i.organization && esc(i.organization), i.requester && esc(i.requester), (i.triage && i.triage.component || i.components.length) && esc((i.triage && i.triage.component) || i.components.join(", ")), i.triage && i.triage.case_type && "case type: " + esc(i.triage.case_type), i.triage && i.triage.version && "server " + esc(i.triage.version), i.triage && i.triage.operator && "operator " + esc(i.triage.operator), (i.triage && i.triage.impact || i.impact) && "impact: " + esc((i.triage && i.triage.impact) || i.impact), i.comments && i.comments + " comments", i.cbses.length && "CBSE " + esc(i.cbses.join(", ")), i.jira.length && "Jira " + esc(i.jira.join(", "))].filter(Boolean).join(" &middot; ");
  const lv = (S.inv && S.inv.versions) || [], tv = i.triage && i.triage.version, mm = tv && lv.length && !lv.some(v => v.split(".").slice(0, 2).join(".") === tv.split(".").slice(0, 2).join("."));
  const warn = mm ? `<div class="hint" style="margin-top:6px;color:var(--warn)"><b>Version check:</b> the ticket says Couchbase Server ${esc(tv)} but these logs are from ${esc(lv.join(", "))}.</div>` : "";
  return `<div class="tbanner"><div class="row sp"><div><b>Ticket ${esc(i.ticket)}</b> &mdash; ${esc(i.subject || "(no subject saved)")}</div><a id="tbch">Choose another ticket</a></div><div class="hint" style="margin-top:4px">${meta}</div>${warn}
    <div class="hint" style="margin-top:4px">Logs on this computer: <span class="mono">${esc(S.path)}</span> <a id="tbcp">Copy</a> &middot; <a id="tbop">Open folder</a></div>
    ${i.description ? `<details style="margin-top:6px"><summary class="hint" style="color:var(--accent)">Show the description</summary><pre style="max-height:240px">${esc(i.description)}</pre></details>` : ""}</div>`;
}
document.addEventListener("click", async e => { if (e.target.id === "tbch") go("tickets"); if (e.target.id === "tbcp") copyText(S.path, "Copied the folder path"); if (e.target.id === "tbop") { try { await fetch("/api/reveal", { method: "POST", body: JSON.stringify({ path: S.path }) }); } catch (er) {} } });
function drawScope() {
  const el = $("#scope"); if (!el) return;
  if (!S.path || !S.fileMap || S.page === "tickets") { el.style.display = "none"; return; }
  el.style.display = "flex";
  const ps = pickSummary(), off = [...S.nodesOff];
  el.innerHTML = `<span class="sl">Reading</span><button class="pillbtn" id="ssf" title="Choose log files">${ps.files} log files on ${ps.nodes} node${ps.nodes === 1 ? "" : "s"} <span class="car">Change</span></button>${S.narrowed ? '<span class="hint">(files chosen for this question)</span>' : ""}
    <span class="sl">during</span><button class="pillbtn" id="sst" data-pop>${S.range ? esc(S.range.length > 34 ? S.range.slice(0, 34) + "..." : S.range) : "any time"} <span class="car">Change</span></button>
    ${off.length ? `<span class="sl">without ${esc(off.map(nshort).join(", "))}</span> <a id="ssn">include all nodes</a>` : ""}`;
  $("#ssf").onclick = () => go("logs"); $("#sst").onclick = e => timePop(e.currentTarget);
  const a = $("#ssn"); if (a) a.onclick = () => { S.nodesOff.clear(); scopeChanged(); };
}
function keepScroll(fn) { const y = window.scrollY; fn(); window.scrollTo(0, y); }
function go(p, fromPop) {
  S.page = p; popClose(); document.body.classList.remove("drawer", "lp", "lpo", "lpt"); const x = $("#xdrawer"); if (x) x.style.display = "none";
  if (!fromPop) { try { history.pushState({ p }, "", "#" + p); } catch (e) {} }
  drawTop(); drawScope(); window.scrollTo(0, 0); PAGES[p]();
}
window.addEventListener("popstate", e => { let p = (e.state && e.state.p) || "tickets"; if (p === "analyze" && !S.hasAnalysis) p = "questions"; if (!S.path && !["tickets", "config", "settings"].includes(p)) p = "tickets"; go(p, true); });

// ------------------------------------------------------------------ time range, in any format the logs use
function timePop(anchor) {
  const cov = pickCoverage(), ex = ["2026-10-13 01:30", "2026-10-13 01:00 to 02:00", "13/Oct/2026:01", "Oct 13 2026"];
  const days = []; if (cov) for (let t = Math.max(Math.floor(cov.min / 86400), Math.floor(cov.max / 86400) - 13) * 86400; t <= cov.max; t += 86400) days.push(fromEpoch(t).slice(0, 10));
  pop(anchor, `<h3>Time range</h3><div class="cap" style="margin:4px 0 10px">Type any time format that appears in the logs. A partial time means the whole span: <code>2026-09</code> is all of September. UTC unless you add an offset.</div>
    <input id="xtin" style="width:100%" class="mono" placeholder="2026-09" value="${esc(S.range)}"><div class="hint" id="xtchk" style="margin:6px 0;min-height:20px"></div>
    ${cov ? `<div class="hint">The log files you picked cover ${esc(fromEpoch(cov.min))} to ${esc(fromEpoch(cov.max))} UTC</div><div class="row" style="margin:6px 0 12px;gap:6px"><span class="chip" data-e="${esc(fromEpoch(cov.min) + " to " + fromEpoch(cov.max))}">All of it</span><span class="chip" data-e="${esc(fromEpoch(Math.max(cov.min, cov.max - 3600)) + " to " + fromEpoch(cov.max))}">Last hour</span>${days.map(d => `<span class="chip" data-e="${d}">${d}</span>`).join("")}</div>` : ""}
    <div class="hint">More examples</div><div class="row" style="margin:6px 0 14px;gap:6px">${ex.map(e => `<span class="chip" data-e="${esc(e)}">${esc(e)}</span>`).join("")}</div>
    <div class="row"><button class="btn primary" id="xtok">Apply</button><button class="btn" id="xtclr">Any time</button></div>`, p => {
    const inp = $("#xtin"); let tm = 0;
    const check = () => { clearTimeout(tm); tm = setTimeout(async () => { const v = inp.value.trim(), o = $("#xtchk"); if (!o) return; if (!v) { o.textContent = ""; return; }
      try { const r = await api("/api/time", { expr: v }); o.innerHTML = `<span class="ok">From ${esc(r.from)} to ${esc(r.to)}</span>`; } catch (e) { o.innerHTML = `<span class="err">${esc(e.message.replace(/^ValueError: /, "").slice(0, 170))}</span>`; } }, 220); };
    inp.oninput = check; inp.onkeydown = e => { if (e.key === "Enter") $("#xtok").click(); }; inp.focus(); check();
    p.querySelectorAll("[data-e]").forEach(c => c.onclick = () => { inp.value = c.dataset.e; check(); inp.focus(); });
    $("#xtok").onclick = () => { S.range = inp.value.trim(); popClose(); scopeChanged(); };
    $("#xtclr").onclick = () => { S.range = ""; popClose(); scopeChanged(); };
  });
}

// ------------------------------------------------------------------ opening a ticket, or fetching it from Supportal
async function refreshTickets() { const t = await api("/api/tickets"); S.tickets = t.tickets; S.root = t.root; }
async function openTicket(raw) {
  const n = String(raw || "").trim();
  if (!/^\d{3,8}$/.test(n)) { toast("Type a ticket number, digits only"); return; }
  await refreshTickets();
  if (S.tickets.includes(n)) { let ok = false; try { const st = await api("/api/job", { ticket: n }); ok = st.has_logs; } catch (e) {} if (ok) return loadTicket(n); }
  showTicket(n);
}
// ------------------------------------------------------------------ downloading a ticket's logs: runs in the background, shown wherever you are
const DL = {}; let dlTimer = 0;
const dlRunning = () => Object.keys(DL).filter(k => DL[k].running);
async function startDownload(id) {
  try { const r = await fetch("/api/fetch", { method: "POST", body: JSON.stringify({ ticket: id }) }), j = await r.json(); if (j.error) throw new Error(j.error); }
  catch (e) { toast(String(e.message).replace(/^ValueError: /, "")); return; }
  DL[id] = { running: true, seconds: 0, bytes: 0, log: "", stage: "Starting..." }; drawTop(); updateDl(id); ensureDlPoll();
}
async function cancelDownload(id) { try { await fetch("/api/fetchcancel", { method: "POST", body: JSON.stringify({ ticket: id }) }); } catch (e) {} setTimeout(pollDl, 800); toast("Stopping the download..."); }
function ensureDlPoll() { if (!dlTimer) dlTimer = setInterval(pollDl, 2000); pollDl(); }
async function pollDl() {
  const ids = dlRunning(); if (!ids.length) { clearInterval(dlTimer); dlTimer = 0; return; }
  for (const id of ids) {
    try { const st = await api("/api/job", { ticket: id }); DL[id] = st; if (!st.running) { onDlDone(id, st); } } catch (e) {}
    updateDl(id);
  }
  drawTop();
}
async function onDlDone(id, st) {
  try { await refreshTickets(); } catch (e) {}
  if (st.rc === 0 && st.has_logs) toast(`Ticket ${id} is downloaded`); else toast(st.rc === 0 ? `Ticket ${id}: finished, but no cbcollect logs were found` : `Ticket ${id}: the download stopped with an error`);
  if (S.page === "tickets" && window.showTicket && window.ticketOpenId && window.ticketOpenId() === id) { if (st.rc === 0) showTicket(id); }
}
function dlInner(id) {
  const st = DL[id]; if (!st) return "";
  const tail = (st.log || "").split("\n").slice(-12).join("\n");
  if (st.running) return `<div class="prog"><div class="bar"><i></i></div></div><div class="row sp" style="margin:8px 0 4px"><b>Downloading... ${esc(secs(st.seconds || 0))}</b><span class="hint">${esc(fmtSize(st.bytes || 0))} on disk so far</span></div>
    <div class="hint" style="margin-bottom:6px">${esc(st.stage || "")}</div><pre class="dllog">${esc(tail) || "Starting..."}</pre>
    <div class="row"><button class="btn" data-dlcancel="${esc(id)}">Cancel the download</button><span class="hint">You can leave this page. The download keeps going and the top bar shows it.</span></div>`;
  if (st.rc === -15 || st.rc === -9) return `<div class="card tight" style="margin:0 0 10px"><b>The download was cancelled.</b> <span class="hint">Files fetched so far stay in the ticket folder.</span><div class="row" style="margin-top:8px"><button class="btn primary" data-dlgo="${esc(id)}">Start again</button></div></div>`;
  const ok = st.rc === 0;
  return `<div class="card tight" style="border-left:4px solid var(--${ok ? "warn" : "bad"});margin:0 0 10px"><b>${ok ? "The download finished, but no cbcollect logs were found for this ticket." : "The download stopped with an error (exit " + esc(st.rc) + ")."}</b>
    <pre class="dllog" style="margin-top:8px">${esc(tail)}</pre><div class="row"><button class="btn primary" data-dlgo="${esc(id)}">Try again</button><span class="hint">AWS sign-in expired? Run <code>aws sso login --profile supportal</code> in a terminal first.</span></div></div>`;
}
function updateDl(id) { const el = $("#dlbox"); if (el && el.dataset.id === id) { el.innerHTML = dlInner(id); wireDl(el); } }
function wireDl(root) { root.querySelectorAll("[data-dlcancel]").forEach(b => b.onclick = () => cancelDownload(b.dataset.dlcancel)); root.querySelectorAll("[data-dlgo]").forEach(b => b.onclick = () => startDownload(b.dataset.dlgo)); }
async function restoreDownloads() { try { const js = await api("/api/jobs"); for (const j of js) if (j.running) DL[j.ticket] = { running: true, seconds: j.seconds, bytes: 0, log: "", stage: "" }; if (dlRunning().length) ensureDlPoll(); } catch (e) {} }

// ------------------------------------------------------------------ loading a ticket and its logs
async function loadTicket(t) {
  S.ticket = t; try { localStorage.setItem("lastTicket", t); } catch (e) {}
  loadBasket(); S.nodesOff.clear(); S.range = ""; S.hasAnalysis = false; S.fileMap = null; S.inv = null; S.info = null;
  drawTop(); busy("Opening ticket " + t + "...");
  S.colls = await api("/api/collections", { ticket: t });
  if (!S.colls.length) { S.path = ""; S.info = null; drawTop(); drawScope(); toast("Ticket " + t + " has no cbcollect logs here"); go("tickets"); return; }
  try { S.info = await api("/api/ticketinfo", { ticket: t }); } catch (e) { S.info = null; }
  const snaps = S.colls.filter(c => !/merged/.test(c.name)); S.path = (snaps.length ? snaps[snaps.length - 1] : S.colls[0]).path;
  await loadColl();
}
async function loadColl(refresh) {
  busy("Reading the log files of every node...");
  const [inv, fm] = await Promise.all([api("/api/inventory", { path: S.path, refresh: refresh === true ? 1 : "" }), api("/api/files", { path: S.path, refresh: refresh === true ? 1 : "" })]);
  S.inv = inv; S.fileMap = fm; S.pick = loadPick(); S.range = ""; S.nodesOff.clear(); S.scan = null; S.hasAnalysis = false;
  if (window.analyzeReset) analyzeReset(); if (window.startReset) startReset(); if (window.logsReset) logsReset();
  S.page = "logs"; try { history.pushState({ p: "logs" }, "", "#logs"); } catch (e) {} drawTop(); drawScope(); PAGES.logs();
}

// ------------------------------------------------------------------ the reply draft: a label, the command and the verbatim output
function loadBasket() { try { S.basket = JSON.parse(localStorage.getItem("basket:" + S.ticket) || "[]"); } catch (e) { S.basket = []; } }
function saveBasket() { try { localStorage.setItem("basket:" + S.ticket, JSON.stringify(S.basket)); } catch (e) {} drawDock(); drawTop(); }
function addEvidence(items) {
  (Array.isArray(items) ? items : [items]).forEach(it => S.basket.push({ id: Date.now() + Math.random(), note: "", ...it }));
  S.dock = true; saveBasket(); toast(`Added to evidence (${S.basket.length})`);
}
function evidenceText(it, withNote) {
  const parts = []; if (withNote && it.note) parts.push(it.note.trim() + "\n");
  parts.push(`${it.label}:`); if (it.command) parts.push("```\n" + it.command + "\n```"); if (it.output) parts.push("```\n" + it.output + "\n```");
  return parts.join("\n");
}
function toggleDock(on) { S.dock = on; drawDock(); }
function drawDock() {
  const d = $("#dock"), b = S.basket; document.body.classList.toggle("dock", S.dock);
  if (!S.dock) { d.innerHTML = ""; return; }
  d.innerHTML = `<div class="row sp dhead"><h2>Evidence for your reply</h2><div class="row"><button class="btn sm primary" id="dall" ${b.length ? "" : "disabled"}>Copy all</button><button class="btn sm" id="dsave" ${b.length ? "" : "disabled"}>Save as file</button><button class="btn sm" id="dclose">Hide</button></div></div>
  <p class="cap">What you add collects here as a label, the command, and the exact output, ready to paste into a reply. Write a note above any block, reorder, copy one or all.</p>
  ${b.map((it, i) => `<div class="blk"><div class="row sp"><b>${esc(it.label)}</b><div class="row" style="gap:4px"><button class="btn sm quiet" data-up="${i}" ${i ? "" : "disabled"}>Up</button><button class="btn sm quiet" data-dn="${i}" ${i < b.length - 1 ? "" : "disabled"}>Down</button><button class="btn sm" data-cp="${i}">Copy</button><button class="btn sm quiet" data-rm="${i}">Remove</button></div></div>
    <textarea data-note="${i}" rows="1" placeholder="Your note above this block (optional)">${esc(it.note)}</textarea>
    ${it.command ? `<pre>${esc(it.command)}</pre>` : ""}${it.output ? `<pre>${esc(it.output.length > 3000 ? it.output.slice(0, 3000) + "\n..." : it.output)}</pre>` : ""}</div>`).join("") || '<div class="empty">Nothing here yet. Select lines and choose "Add to evidence".</div>'}
  ${b.length ? '<div class="row" style="margin-top:8px"><button class="btn sm quiet" id="dclr">Clear all</button></div>' : ""}`;
  $("#dclose").onclick = () => toggleDock(false);
  $$("#dock [data-note]").forEach(t => { t.oninput = () => { S.basket[+t.dataset.note].note = t.value; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; try { localStorage.setItem("basket:" + S.ticket, JSON.stringify(S.basket)); } catch (e) {} }; if (t.value) t.style.height = t.scrollHeight + "px"; });
  $$("#dock [data-cp]").forEach(x => x.onclick = () => copyText(evidenceText(b[+x.dataset.cp], true), "Copied block"));
  $$("#dock [data-rm]").forEach(x => x.onclick = () => { b.splice(+x.dataset.rm, 1); saveBasket(); });
  $$("#dock [data-up]").forEach(x => x.onclick = () => { const i = +x.dataset.up; [b[i - 1], b[i]] = [b[i], b[i - 1]]; saveBasket(); });
  $$("#dock [data-dn]").forEach(x => x.onclick = () => { const i = +x.dataset.dn; [b[i + 1], b[i]] = [b[i], b[i + 1]]; saveBasket(); });
  const all = $("#dall"); if (all) all.onclick = () => copyText(b.map(it => evidenceText(it, true)).join("\n\n"), "Copied all blocks");
  let armed = false; const clr = $("#dclr"); if (clr) clr.onclick = e => { if (!armed) { armed = true; e.target.textContent = "Click again to clear all"; setTimeout(() => { armed = false; if ($("#dclr")) $("#dclr").textContent = "Clear all"; }, 3000); return; } S.basket = []; saveBasket(); };
  const sv = $("#dsave"); if (sv) sv.onclick = async () => {
    const r = await fetch("/api/report", { method: "POST", body: JSON.stringify({ ticket: S.ticket, header: "Collection: " + S.path, items: b.map(it => ({ title: it.label, note: it.note, command: it.command, output: it.output, where: "" })) }) });
    const j = await r.json(); toast(j.error ? "Error: " + j.error : "Saved " + j.file.split("/").slice(-2).join("/"));
  };
}

async function boot() {
  try { await refreshTickets(); } catch (e) { S.tickets = []; }
  drawTop(); drawScope(); drawDock(); restoreDownloads();
  let last = ""; try { last = localStorage.getItem("lastTicket") || ""; } catch (e) {}
  S.ticket = ""; try { history.replaceState({ p: "tickets" }, "", "#tickets"); } catch (e) {} PAGES.tickets();
  document.addEventListener("keydown", e => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const i = $("#bigq") || $("#xq"); if (i) { e.preventDefault(); i.focus(); } } });
}
