// Settings: who you are, which tickets to list, how to reach Supportal, and where everything is kept on this computer.
(function () {
let found = null;
const row = (label, path, note, canOpen) => `<tr><td style="white-space:nowrap;font-weight:600;vertical-align:top">${esc(label)}${note ? `<div class="hint" style="font-weight:400;max-width:260px">${esc(note)}</div>` : ""}</td><td class="mono" style="word-break:break-all">${esc(path || "(not set)")}</td>
  <td style="white-space:nowrap">${path ? `<button class="btn sm" data-cp="${esc(path)}">Copy</button> ${canOpen ? `<button class="btn sm" data-op="${esc(path)}">Open folder</button>` : ""}` : ""}</td></tr>`;

PAGES.settings = async function () {
  $("#page").innerHTML = '<div class="wrap"><div class="spin">Loading...</div></div>';
  let r; try { r = await api("/api/settings"); } catch (e) { $("#page").innerHTML = `<div class="wrap"><div class="err">${esc(e.message)}</div></div>`; return; }
  S.settings = r.settings; S.detected = r.detected; S.paths = r.paths; draw(r);
};
function draw(r) {
  const st = r.settings, p = r.paths, me = st.user;
  $("#page").innerHTML = `<div class="wrap"><div class="crumb"><a id="sb">&lsaquo; Back</a></div><h1>Settings</h1>
    <p class="lead">Who you are, how tickets are listed, how cbtriage reaches Supportal, and where everything is stored on this computer.</p>
    <section class="card"><h2>You</h2><p class="cap">cbtriage uses this to find <b>your</b> open tickets. Anyone running the app sets their own.</p>
      <div class="row" style="gap:16px;align-items:flex-start"><div class="fld grow"><label class="l">Name</label><input id="u_name" style="width:100%" value="${esc(me.name || (r.detected && r.detected.name) || "")}"></div><div class="fld grow"><label class="l">Email</label><input id="u_email" style="width:100%" value="${esc(me.email)}"></div>
        <div class="fld"><label class="l">Zendesk user id</label><input id="u_id" style="width:190px" class="mono" inputmode="numeric" value="${esc(me.zendesk_id || "")}" placeholder="found for you"></div></div>
      <div class="hint" id="u_note">${r.detected ? `Found in your saved tickets: <b>${esc(r.detected.name)}</b> (${esc(r.detected.id)}). ${String(me.zendesk_id || "") === String(r.detected.id) ? "" : '<a id="u_use">Use it</a>'}` : "Not found in your saved tickets yet."}
        ${me.zendesk_id ? "" : r.detected ? " It is used automatically when this box is empty." : ""}</div>
      <div class="row" style="margin-top:10px"><button class="btn" id="u_find">Find me among the open tickets</button><span class="hint">Lists the owners of everyone's open tickets so you can pick yourself.</span></div><div id="u_people" class="row" style="margin-top:8px;gap:6px"></div></section>
    <section class="card"><h2>Ticket list</h2><p class="cap">Which tickets count as open.</p>
      <div class="row" style="gap:10px">${["new", "open", "pending", "hold", "solved", "closed"].map(s => `<label class="chip ${st.statuses.includes(s) ? "on" : ""}" style="text-transform:capitalize"><input type="checkbox" data-s="${s}" ${st.statuses.includes(s) ? "checked" : ""} style="display:none">${s}</label>`).join("")}<span class="hint" style="margin-left:12px">Tickets per page</span><select id="pp">${[25, 50, 100].map(n => `<option ${st.per_page === n ? "selected" : ""}>${n}</option>`).join("")}</select></div></section>
    <section class="card"><h2>Connections</h2><p class="cap">Tickets and their history come from Supportal, which needs the Couchbase VPN. Downloading logs also needs an AWS sign-in.</p>
      <div class="fld"><label class="l">Supportal address</label><input id="sp" style="width:420px" class="mono" value="${esc(st.supportal_base)}"> <button class="btn" id="chk">Check connection</button></div>
      <div class="fld"><label class="l">AWS profile for downloads</label><input id="aw" style="width:220px" class="mono" value="${esc(st.aws_profile)}"></div><div id="conn" class="hint"></div></section>
    <section class="card"><h2>Where things are</h2><p class="cap">Everything cbtriage reads and writes. Ticket folders hold the logs you download.</p>
      ${p.mismatch ? `<div class="card tight" style="border-left:4px solid var(--warn)"><b>The download script and cbtriage use different folders.</b><div class="hint" style="margin:4px 0 8px">The script saves into <span class="mono">${esc(p.script_logs_root)}</span> but cbtriage reads <span class="mono">${esc(p.logs_root)}</span>, so downloaded tickets will not show up here.</div><button class="btn sm" id="usescript">Use the script's folder as the logs folder</button></div>` : ""}
      <table><tbody>${row("Logs folder", p.logs_root, p.exists ? p.tickets_here + " ticket folders in it" : "this folder does not exist", p.exists)}
        ${row("One ticket's folder", p.ticket_folder, "", false)}${row("A node's logs", p.cbcollect, "where the cbcollect files of one node are", false)}
        ${row("Download script", p.script, p.script_exists ? "from the parent repo; uses AWS and Supportal" : "not found", false)}${row("Where the script saves", p.script_logs_root, "DIR_TICKETS in the parent repo's .env", !!p.script_logs_root)}
        ${row("Index cache", p.cache, "speeds up the timeline; safe to delete", true)}${row("Questions and known problems", p.config, "your own lists and backups", true)}${row("Settings file", p.settings_file, "", false)}</tbody></table>
      <div class="fld"><label class="l">Change the logs folder</label><input id="lr" style="width:100%" class="mono" value="${esc(st.logs_root || p.logs_root)}" placeholder="/path/to/folder/with/one/folder/per/ticket"><div class="hint">Takes effect right away and is remembered for next time.</div></div></section>
    <section class="card"><div class="row sp"><div><h2>Questions and known problems</h2><p class="cap" style="margin:4px 0 0">Add, edit or remove what the Question step offers, and which log files each one reads.</p></div><button class="btn" id="cz">Customize</button></div></section>
    <div class="stickybar"><div id="sst">Changes apply when you save.</div><button class="btn" id="save">Save settings</button></div></div>`;
  $("#sb").onclick = () => history.back(); $("#cz").onclick = () => go("config");
  const use = $("#u_use"); if (use) use.onclick = () => { $("#u_id").value = r.detected.id; if (!$("#u_name").value) $("#u_name").value = r.detected.name; };
  $$("[data-s]").forEach(c => c.onchange = () => c.parentElement.classList.toggle("on", c.checked));
  $$("[data-cp]").forEach(b => b.onclick = () => copyText(b.dataset.cp, "Copied the path")); $$("[data-op]").forEach(b => b.onclick = async () => { const j = await (await fetch("/api/reveal", { method: "POST", body: JSON.stringify({ path: b.dataset.op }) })).json(); if (j.error) toast(j.error); });
  const us = $("#usescript"); if (us) us.onclick = () => { $("#lr").value = p.script_logs_root; save(); };
  $("#u_find").onclick = async () => { const box = $("#u_people"); box.innerHTML = '<span class="hint">Asking Supportal...</span>'; try { const x = await api("/api/sp/tickets", { assignee: "all", statuses: "open,pending" }); const m = new Map(); x.tickets.forEach(t => { if (t.assignee && t.assignee_id) m.set(t.assignee_id, t.assignee); });
    box.innerHTML = [...m].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => `<span class="chip" data-pick="${id}" data-nm="${esc(n)}">${esc(n)}</span>`).join("") || '<span class="hint">' + esc((x.errors || ["No owners found."])[0]) + "</span>";
    $$("[data-pick]").forEach(c => c.onclick = () => { $("#u_id").value = c.dataset.pick; $("#u_name").value = c.dataset.nm; toast("Picked " + c.dataset.nm + ". Save to keep it."); }); } catch (e) { box.innerHTML = `<span class="err">${esc(e.message)}</span>`; } };
  $("#chk").onclick = async () => { const o = $("#conn"); o.textContent = "Checking..."; await save(true); try { const c = await api("/api/sp/status");
    o.innerHTML = `<div>${c.supportal.reachable ? `<span class="ok">&#10003; Supportal answers</span> (${c.supportal.ms} ms)` : `<span class="err">&#10007; ${esc(c.supportal.error)}</span> Connect to the Couchbase VPN and try again.`}</div>
      <div>${c.aws.ok ? `<span class="ok">&#10003; AWS signed in</span> (profile ${esc(c.aws.profile)})` : `<span class="warn">&#10007; AWS: ${esc(c.aws.error)}</span> To sign in, run <code>aws sso login --profile ${esc(c.aws.profile)}</code> in a terminal.`}</div>`; } catch (e) { o.innerHTML = `<span class="err">${esc(e.message)}</span>`; } };
  $("#save").onclick = () => save();
}
async function save(quiet) {
  const body = { user: { name: $("#u_name").value.trim(), email: $("#u_email").value.trim(), zendesk_id: $("#u_id").value.trim() ? Number($("#u_id").value.trim()) : null },
    supportal_base: $("#sp").value, statuses: $$("[data-s]").filter(c => c.checked).map(c => c.dataset.s), per_page: Number($("#pp").value), aws_profile: $("#aw").value.trim() };
  const lr = $("#lr").value.trim(); if (lr && lr !== (S.paths && S.paths.logs_root)) body.logs_root = lr;
  try {
    const r = await fetch("/api/settings", { method: "POST", body: JSON.stringify(body) }), j = await r.json(); if (j.error) throw new Error(j.error);
    S.settings = j.settings; S.paths = j.paths; S.tickets = []; try { await refreshTickets(); } catch (e) {}
    if (!quiet) { toast("Settings saved"); draw({ settings: j.settings, paths: j.paths, detected: S.detected }); }
  } catch (e) { const s = $("#sst"); if (s) s.innerHTML = `<span style="color:#ff9b94"><b>Not saved.</b> ${esc(e.message.replace(/^ValueError: /, ""))}</span>`; }
}
})();
