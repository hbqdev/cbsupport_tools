// Step 1: which ticket. Your open tickets from Supportal, everyone's, or the ones already on this computer.
// Click one to read its whole history, see where its logs are, and download them.
(function () {
const T = { view: "list", tab: "mine", mine: null, local: null, id: null, doc: null, filt: "", err: "", busy: false, newest: true, statuses: null, hist: true };
const ago = iso => { if (!iso) return ""; const d = (Date.now() - Date.parse(iso)) / 1000; if (isNaN(d)) return ""; return d < 90 ? "just now" : d < 3600 ? Math.round(d / 60) + " min ago" : d < 86400 * 2 ? Math.round(d / 3600) + " h ago" : d < 86400 * 45 ? Math.round(d / 86400) + " days ago" : iso.slice(0, 10); };
const pill = (s, cls) => `<span class="pill ${cls || (s === "open" || s === "new" ? "medium" : s === "pending" || s === "hold" ? "" : "")}" style="text-transform:capitalize">${esc(s || "unknown")}</span>`;
const prio = p => (p && p !== "normal" ? `<span class="pill ${p === "urgent" || p === "high" ? "high" : ""}" style="text-transform:capitalize">${esc(p)}</span>` : "");
window.getSettings = async function (force) { if (!S.settings || force) { const r = await api("/api/settings"); S.settings = r.settings; S.detected = r.detected; S.paths = r.paths; } return S.settings; };

const rowActs = (id, has) => `<span class="ract">${has ? `<button class="btn sm primary" data-ra="go" title="Open the logs without reading the ticket first">Analyze logs</button><button class="btn sm quiet" data-ra="del" title="Delete this ticket's logs from the disk">Delete logs</button>` : `<button class="btn sm" data-ra="dl" title="Choose snapshots and download the logs">Download logs</button>`}<button class="btn sm" data-ra="view">Ticket</button></span>`;
PAGES.tickets = async function () {
  T.view = "list"; await getSettings().catch(() => {});
  try { T.tab = localStorage.getItem("tk_tab") === "local" ? "local" : "mine"; T.hist = localStorage.getItem("tk_hist") !== "0"; } catch (e) {}
  T.statuses = T.statuses || (S.settings ? S.settings.statuses.slice() : ["new", "open", "pending", "hold"]);
  drawList(); loadTab();
};
async function loadLocal() { try { T.local = await api("/api/ticketlist"); } catch (e) { T.local = []; } }
async function loadTab(force) {
  const tab = T.tab; T.err = "";
  if (tab === "local") { if (!T.local || force) { await loadLocal(); } drawList(); return; }
  if (!T.local) loadLocal().then(drawList);
  if (T[tab] && !force) { drawList(); return; }
  T.busy = true; drawList();
  try {
    const r = await api("/api/sp/tickets", { assignee: "me", statuses: T.statuses.join(","), retry: force ? 1 : "" });
    T[tab] = r; T.err = r.errors && r.errors.length ? r.errors[0] : "";
  } catch (e) { T[tab] = { tickets: [], errors: [e.message] }; T.err = e.message; }
  T.busy = false; if (S.page === "tickets" && T.view === "list") drawList();
}

function drawList() {
  if (S.page !== "tickets" || T.view !== "list") return;
  const mine = T.mine && T.mine.tickets, loc = T.local;
  const cnt = a => (a ? ` <span class="hint">${a.length}</span>` : "");
  const cur = T.tab === "local" ? null : T[T.tab];
  $("#page").innerHTML = `<div class="wrap"><h1>Which ticket?</h1>
    <p class="lead">Your open tickets from Supportal, or the ones already on this computer. Pick one to read its history and get its logs.</p>
    <form class="bigsearch" id="nt" autocomplete="off"><input id="ntn" inputmode="numeric" placeholder="Or type a ticket number, for example 81395"><button class="btn primary" type="submit">Open ticket</button></form>
    <div class="row sp" style="margin:26px 0 14px"><div class="seg"><button data-tab="mine" class="${T.tab === "mine" ? "on" : ""}">My open tickets${cnt(mine)}</button><button data-tab="local" class="${T.tab === "local" ? "on" : ""}">On this computer${cnt(loc)}</button></div>
      <div class="row">${T.tab === "local" ? "" : `<span class="hint">Show</span>${["new", "open", "pending", "hold"].map(s => `<span class="chip ${T.statuses.includes(s) ? "on" : ""}" data-st="${s}" style="text-transform:capitalize">${s}</span>`).join("")}`}
        <input id="tf" placeholder="Filter by number, customer or subject" style="width:260px" value="${esc(T.filt)}">
        ${T.tab === "local" ? "" : `<button class="btn" id="trf" ${T.busy ? "disabled" : ""}>${T.busy ? "Loading..." : "Refresh"}</button>`}</div></div>
    ${T.err ? `<div class="card" style="border-left:4px solid var(--warn)"><b>Supportal tickets could not be loaded.</b><div class="hint" style="margin:4px 0 8px">${esc(T.err)}</div><div class="row"><button class="btn sm" id="tretry">Try again</button><button class="btn sm" id="tset">Check the connection in Settings</button><span class="hint">Tickets already on this computer are still available under "On this computer".</span></div></div>` : ""}
    <div id="tl"></div></div>`;
  $("#nt").onsubmit = e => { e.preventDefault(); const n = $("#ntn").value.trim(); if (!/^\d{3,8}$/.test(n)) { toast("Type a ticket number, digits only"); return; } showTicket(n); };
  $$("[data-tab]").forEach(b => b.onclick = () => { T.tab = b.dataset.tab; try { localStorage.setItem("tk_tab", T.tab); } catch (e) {} loadTab(); });
  $$("[data-st]").forEach(c => c.onclick = () => { const s = c.dataset.st; T.statuses = T.statuses.includes(s) ? T.statuses.filter(x => x !== s) : T.statuses.concat([s]); if (!T.statuses.length) T.statuses = [s]; T.mine = null; loadTab(); });
  $("#tf").oninput = e => { T.filt = e.target.value; drawRows(); };
  const rf = $("#trf"); if (rf) rf.onclick = () => { T.mine = null; loadTab(true); };
  const rt = $("#tretry"); if (rt) rt.onclick = () => { T.mine = null; loadTab(true); }; const ts = $("#tset"); if (ts) ts.onclick = () => go("settings");
  drawRows();
}
function drawRows() {
  const el = $("#tl"); if (!el) return; const f = T.filt.trim().toLowerCase();
  const localSet = new Set((T.local || []).filter(t => t.has_logs).map(t => t.ticket));
  if (T.tab === "local") {
    const rows = (T.local || []).filter(t => !f || [t.ticket, t.subject, t.organization, t.requester].join(" ").toLowerCase().includes(f));
    el.innerHTML = !T.local ? '<div class="spin">Reading the tickets on this computer...</div>' : rows.map(t => `<div class="trow ${t.ticket === S.ticket ? "cur" : ""}" data-t="${esc(t.ticket)}"><div class="tnum mono">${esc(t.ticket)}</div><div class="grow"><div class="tsub">${esc(t.subject || "(no subject saved)")}</div>
      <div class="hint">${pill(t.status)} ${t.organization ? esc(t.organization) + " &middot; " : ""}${t.requester ? esc(t.requester) + " &middot; " : ""}${(t.triage && t.triage.component) ? esc(t.triage.component) + " &middot; " : ""}${(t.triage && t.triage.version) ? "server " + esc(t.triage.version) + " &middot; " : ""}${t.has_logs ? `${t.nodes} nodes${t.collections > 1 ? ", " + t.collections + " collections" : ""}` : '<span class="warn">no cbcollect logs here yet</span>'} &middot; changed ${esc(ago(new Date(t.mtime * 1000).toISOString()))}</div></div>
      ${t.ticket === S.ticket ? '<span class="pill" style="background:var(--ok)">Current</span>' : ""}${rowActs(t.ticket, t.has_logs)}</div>`).join("") || '<div class="empty">No tickets on this computer yet. Type a number above to look one up.</div>';
  } else {
    const d = T.mine; if (!d) { el.innerHTML = '<div class="spin">Asking Supportal...</div>'; return; }
    if (d.need_identity) { el.innerHTML = `<div class="card"><b>Who are you?</b><p class="cap" style="margin:4px 0 12px">cbtriage does not know which Zendesk user is you yet, so it cannot pick out your tickets. Tell it once in Settings, then this list fills in.</p><button class="btn primary" id="tid">Open Settings</button></div>`; $("#tid").onclick = () => go("settings"); return; }
    const rows = d.tickets.filter(t => (!f || [t.id, t.subject, t.org, t.assignee, t.cbse, t.esc_ent, t.bug].join(" ").toLowerCase().includes(f)) && true);
    el.innerHTML = (rows.map(t => `<div class="trow" data-t="${esc(t.id)}"><div class="tnum mono">${esc(t.id)}</div><div class="grow"><div class="tsub">${esc(t.subject || "(no subject)")}</div>
      <div class="hint">${pill(t.status)} ${prio(t.priority)} ${t.org ? esc(t.org) + " &middot; " : ""}${t.triage && t.triage.component ? esc(t.triage.component) + " &middot; " : ""}${t.triage && t.triage.version ? "server " + esc(t.triage.version) + " &middot; " : ""}${esc(t.assignee || "unassigned")} &middot; updated ${esc(ago(t.updated))}${[t.cbse, t.esc_ent, t.bug].filter(Boolean).map(k => ` <span class="pill" style="background:var(--info,#2563eb)">${esc(k)}</span>`).join("")}</div></div>
      ${rowActs(t.id, localSet.has(t.id))}</div>`).join("") ||
      `<div class="empty">${d.errors && d.errors.length ? "" : "No tickets match."}</div>`) + (d.fetched && !T.err ? `<p class="hint" style="text-align:center">${rows.length} shown &middot; loaded from Supportal ${esc(ago(d.fetched))}</p>` : "");
  }
  $$("#tl .trow").forEach(r => r.onclick = () => showTicket(r.dataset.t));
  $$("#tl [data-ra]").forEach(b => b.onclick = e => { e.stopPropagation(); const id = b.closest(".trow").dataset.t, k = b.dataset.ra;
    if (k === "go") loadTicket(id); else if (k === "view") showTicket(id); else if (k === "dl") downloadDialog(id, () => showTicket(id));
    else if (k === "del") clearDialog(id, ((S.paths && S.paths.logs_root) || "") + "/" + id, () => { T.local = null; loadTab(true); }); });
}

// ------------------------------------------------------------------ one ticket: the whole history, the logs, and the download
window.ticketOpenId = () => (T.view === "ticket" ? T.id : null);
window.showTicket = async function (id, retry) {
  S.page = "tickets"; T.view = "ticket"; T.id = id; T.doc = null; try { history.pushState({ p: "tickets" }, "", "#ticket-" + id); } catch (e) {}
  drawTop(); drawScope(); window.scrollTo(0, 0); $("#page").innerHTML = '<div class="wrap"><div class="spin">Asking Supportal for ticket ' + esc(id) + "...</div></div>";
  try { T.doc = await api("/api/sp/ticket", { id, retry: retry ? 1 : "" }); } catch (e) { T.doc = { error: e.message }; }
  if (S.page === "tickets" && T.view === "ticket" && T.id === id) drawTicket();
};
let flt = "all", openAll = new Set();
const setHist = on => { T.hist = on; try { localStorage.setItem("tk_hist", on ? "1" : "0"); } catch (e) {} };
const roleOf = e => (!e.public ? "internal" : e.role === "end-user" ? "customer" : "support");
const ROLE = { customer: ["Customer", "var(--warn)"], support: ["Support", "var(--accent)"], internal: ["Internal note", "var(--muted)"] };
function drawTicket() {
  const d = T.doc, el = $("#page");
  if (!d || d.error) { el.innerHTML = `<div class="wrap"><div class="crumb"><a id="tback">&lsaquo; All tickets</a></div><h1>Ticket ${esc(T.id)}</h1><div class="card" style="border-left:4px solid var(--warn)"><b>Could not load this ticket.</b><div class="hint" style="margin:4px 0 10px">${esc(d ? d.error : "")}</div><div class="row"><button class="btn" id="tre">Try again</button><button class="btn" id="tset">Check the connection in Settings</button></div></div></div>`;
    $("#tback").onclick = () => go("tickets"); $("#tre").onclick = () => showTicket(T.id, true); $("#tset").onclick = () => go("settings"); return; }
  const t = d.ticket, loc = d.local, root = (S.paths && S.paths.logs_root) || "", where = loc.dir || (root + "/" + t.id);
  const evs = d.events.filter(e => flt === "all" || roleOf(e) === flt); if (T.newest) evs.reverse();
  let lastDay = "";
  el.innerHTML = `<div class="wrap"><div class="crumb"><a id="tback">&lsaquo; All tickets</a></div>
    ${d.source !== "supportal" ? `<div class="card tight" style="border-left:4px solid var(--warn);margin-bottom:16px"><b>Showing the copy saved on this computer</b> <span class="hint">from ${esc((d.as_of || "").slice(0, 16).replace("T", " "))} UTC. ${esc(d.warning || "")}</span></div>` : ""}
    <div class="row sp" style="align-items:flex-start"><div class="grow"><h1><span class="mono" style="color:var(--accent)">${esc(t.id)}</span> ${esc(t.subject)}</h1>
      <div class="hint">${pill(t.status)} ${prio(t.priority)} ${t.organization ? esc(t.organization) + " &middot; " : ""}${t.requester.name ? "from " + esc(t.requester.name) + " &middot; " : ""}${t.assignee.name ? "owner " + esc(t.assignee.name) + " &middot; " : ""}${t.components.length ? esc(t.components.join(", ")) + " &middot; " : ""}${t.impact ? "impact: " + esc(t.impact) + " &middot; " : ""}opened ${esc(t.created.slice(0, 10))}, updated ${esc(ago(t.updated || (d.events.length ? d.events[d.events.length - 1].time : "")))}</div></div></div>
    ${d.triage && d.triage.length ? `<div class="card tight" style="margin-top:18px"><div class="row sp"><b>Triage</b><span class="hint">the fields Support fills in on the ticket</span></div><div class="tgrid">${d.triage.map(f => `<div><span class="hint">${esc(f.label)}</span><div class="tv">${esc(f.value)}</div></div>`).join("")}</div></div>` : ""}
    <div class="card" style="margin-top:18px"><div class="row sp"><h2>Logs</h2>${loc.has_logs ? '<div class="row" style="gap:8px"><button class="btn primary" id="tgo">Analyze the logs &rsaquo;</button><button class="btn" id="tdl2">Download more...</button><button class="btn quiet" id="tdel">Delete logs from disk</button></div>' : `<button class="btn primary" id="tdl" ${DL[t.id] && DL[t.id].running ? "disabled" : ""}>${DL[t.id] && DL[t.id].running ? "Downloading..." : "Download the logs"}</button>`}</div>
      <div id="dlbox" data-id="${esc(t.id)}" style="margin:0 0 12px">${!loc.has_logs && DL[t.id] ? dlInner(t.id) : ""}</div>
      <p class="cap" style="margin:6px 0 10px">${loc.has_logs ? `On this computer: ${loc.nodes} nodes${loc.collections > 1 ? ", " + loc.collections + " collections" : ""}.` : "Not on this computer yet. Downloading fetches the snapshots, uploaded files and attachments listed below into this folder."}</p>
      <div class="row" style="gap:8px"><span class="mono" style="background:var(--code);padding:5px 10px;border-radius:8px;word-break:break-all">${esc(where)}</span><button class="btn sm" id="tcp">Copy path</button>${loc.exists ? '<button class="btn sm" id="tof">Open folder</button>' : ""}</div>
      <div class="row" style="margin-top:12px;gap:24px;align-items:flex-start">
        <div class="grow"><div class="hint"><b>Snapshots</b> (cbcollect from the cluster)</div>${d.snapshots.map(s => `<div class="mono hint">${esc((s.time || "").replace("T", " ").slice(0, 16))} &middot; ${s.nodes} nodes &middot; ${esc(s.uuid.slice(0, 10))}</div>`).join("") || '<div class="hint">none</div>'}</div>
        <div class="grow"><div class="hint"><b>Uploaded by the customer</b></div>${d.files.map(f => `<div class="mono hint" title="${esc(f.url)}">${esc(f.name)} <span style="opacity:.7">${esc((f.time || "").slice(0, 10))}</span></div>`).join("") || '<div class="hint">none</div>'}</div>
        <div class="grow"><div class="hint"><b>Attached to the ticket</b></div>${d.attachments.slice(0, 12).map(a => `<div class="mono hint">${esc(a.name)}</div>`).join("") || '<div class="hint">none</div>'}${d.attachments.length > 12 ? `<div class="hint">and ${d.attachments.length - 12} more</div>` : ""}</div></div></div>
    ${d.linked.length ? `<div class="card tight"><b>Linked issues</b> &nbsp;${d.linked.map(l => `<span class="pill" style="background:var(--info,#2563eb)" title="${esc(l.kind + (l.summary ? ": " + l.summary : ""))}">${esc(l.key)}</span>`).join(" ")}</div>` : ""}
    <div class="card"><div class="row sp"><h2>History <span class="hint">${d.events.length} messages</span></h2><div class="row">${T.hist ? `<div class="seg">${[["all", "All"], ["customer", "Customer"], ["support", "Support"], ["internal", "Internal notes"]].map(([k, l]) => `<button data-f="${k}" class="${flt === k ? "on" : ""}">${l}</button>`).join("")}</div><button class="btn sm" id="tnew">${T.newest ? "Newest first" : "Oldest first"}</button><button class="btn sm" id="tcopy">Copy as text</button>` : ""}<button class="btn sm ${T.hist ? "" : "primary"}" id="thist">${T.hist ? "Hide history" : "Show history"}</button></div></div>
      ${T.hist ? `<div id="hist" style="margin-top:12px">${evs.map(e => { const day = e.time.slice(0, 10), head = day !== lastDay ? `<div class="dayh">${esc(day)}</div>` : ""; lastDay = day; const [rl, col] = ROLE[roleOf(e)], long = e.text.split("\n").length > 14 || e.text.length > 1400, open = openAll.has(e.id) || !long;
        return `${head}<div class="ev ${roleOf(e)}"><div class="evh"><span class="avatar" style="background:${col}">${esc((e.author || "?").trim().charAt(0).toUpperCase())}</span><b>${esc(e.author || "Unknown")}</b><span class="pill" style="background:${col}">${rl}</span><span class="hint">${esc(e.time.slice(11, 16))} UTC &middot; ${esc(ago(e.time))}</span></div>
          <div class="evb ${open ? "" : "clip"}">${esc(e.text)}</div>${long ? `<a class="more" data-e="${esc(e.id)}">${open ? "Show less" : "Show the whole message"}</a>` : ""}${e.attachments.length ? `<div class="row" style="margin-top:6px;gap:6px">${e.attachments.map(a => `<span class="chip" title="${esc(a.url)}">&#128206; ${esc(a.name)}</span>`).join("")}</div>` : ""}</div>`; }).join("") || '<div class="empty">No messages match.</div>'}</div>` : '<p class="cap" style="margin:8px 0 0">The history is hidden. Use "Show history" to read it.</p>'}</div></div>`;
  $("#tback").onclick = () => go("tickets");
  const go_ = $("#tgo"); if (go_) go_.onclick = () => loadTicket(t.id); const dl = $("#tdl"); if (dl) dl.onclick = () => downloadDialog(t.id); const d2 = $("#tdl2"); if (d2) d2.onclick = () => downloadDialog(t.id); const dd = $("#tdel"); if (dd) dd.onclick = () => clearDialog(t.id, where, () => { T.local = null; showTicket(t.id); }); wireDl($("#dlbox"));
  $("#tcp").onclick = () => copyText(where, "Copied the folder path"); const of = $("#tof"); if (of) of.onclick = async () => { try { await fetch("/api/reveal", { method: "POST", body: JSON.stringify({ path: where }) }); } catch (e) {} };
  $("#thist").onclick = () => { setHist(!T.hist); drawTicket(); };
  $$("[data-f]").forEach(b => b.onclick = () => { flt = b.dataset.f; drawTicket(); });
  const tn = $("#tnew"); if (tn) tn.onclick = () => { T.newest = !T.newest; drawTicket(); };
  const tc = $("#tcopy"); if (tc) tc.onclick = () => copyText(d.events.map(e => `[${e.time.replace("T", " ").slice(0, 16)}] ${e.author} (${ROLE[roleOf(e)][0]})\n${e.text}`).join("\n\n"), "Copied the whole history");
  $$("#hist .more").forEach(a => a.onclick = () => { const i = a.dataset.e; openAll.has(i) ? openAll.delete(i) : openAll.add(i); keepScroll(drawTicket); });
}
})();
