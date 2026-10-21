// The workspace: one search box, a time control, and a merged timeline of matching lines from every node.
(function () {
const W = { text: "", fixed: false, icase: true, t: { mode: "any", a: null, r: 60, from: "", to: "" }, focus: null, view: "lines", res: null, busy: false, err: "", sel: new Set(), last: null, open: {}, seq: 0, tall: false };
const TS = /\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?: ?(?:Z|[+-]\d\d:?\d\d))?|\d{1,2}\/[A-Za-z]{3}\/\d{4}:\d\d:\d\d:\d\d(?: [+-]\d{4})?|\b1[5-9]\d{8}(?:\.\d+)?\b/;
// the time inside whatever was pasted (a whole log line, a copied field), or the text unchanged
const timeIn = s => { const m = String(s).match(TS); return m ? m[0].replace(",", ".").replace(/ (?=[+-]\d|Z)/, "") : String(s).trim(); };
const utcNote = async v => { const m = v.match(TS); if (!m || !/(Z|[+-]\d\d:?\d\d)$/.test(m[0].trim())) return ""; try { const r = await api("/api/time", { expr: v }); return " = " + r.from.slice(0, 19) + " UTC"; } catch (e) { return ""; } };
const RADII = [[0, "this second"], [1, "\u00b11s"], [5, "\u00b15s"], [30, "\u00b130s"], [60, "\u00b11m"], [300, "\u00b15m"], [3600, "\u00b11h"]];
const rlabel = r => (RADII.find(x => x[0] === r) || [0, "\u00b1" + secs(r)])[1];
const short = (s, n) => (s.length > n ? s.slice(0, n) + "..." : s);
const dt = e => fromEpoch(e).slice(0, 19);   // always UTC: what the searches use
// ---- time zones: searches stay in UTC, what you read and type can be in the logs' zone, your own, or any other
const TZ = { id: "utc", key: "", logs: null };
try { TZ.id = localStorage.getItem("tz") || "utc"; } catch (e) {}
const p2 = n => String(Math.abs(n)).padStart(2, "0");
const fmtOff = s => (s < 0 ? "-" : "+") + p2(Math.floor(Math.abs(s) / 3600)) + ":" + p2(Math.floor(Math.abs(s) % 3600 / 60));
const fmts = {};
function ianaOff(id, e) {
  try { const k = id; const f = fmts[k] || (fmts[k] = new Intl.DateTimeFormat("en-CA", { timeZone: id === "local" ? undefined : id, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    const q = Object.fromEntries(f.formatToParts(new Date(e * 1000)).map(x => [x.type, x.value])); return Date.UTC(+q.year, q.month - 1, +q.day, +q.hour, +q.minute, +q.second) / 1000 - Math.floor(e); } catch (x) { return 0; }
}
const logsOff = () => (TZ.logs && TZ.logs.length && TZ.logs.every(x => x === TZ.logs[0]) ? TZ.logs[0] : null);
const mineName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return "your computer"; } };
const offOf = (id, e) => (id === "utc" ? 0 : id === "logs" ? logsOff() || 0 : ianaOff(id, e));
const tzOff = e => offOf(TZ.id, e);
const dz = e => (isFinite(e) ? fromEpoch(Math.floor(e) + tzOff(e)).slice(0, 19) : "");        // an epoch as the chosen zone shows it
const dzs = s => (s ? dz(toEpoch(s)) : "");                                           // a UTC time string from the server, as the chosen zone shows it
const parseZ = s => { const e0 = toEpoch(s); return e0 - tzOff(e0); };     // what was typed in the chosen zone, as an epoch
const zlabel = (id, e) => (id === "utc" ? "UTC" : id === "logs" ? (logsOff() == null ? "UTC" : "UTC" + fmtOff(logsOff()) + " (the logs)") : id === "local" ? "UTC" + fmtOff(ianaOff("local", e || Date.now() / 1000)) + " (" + mineName() + ")" : id + " (UTC" + fmtOff(ianaOff(id, e || Date.now() / 1000)) + ")");
const zshort = () => (TZ.id === "utc" ? "UTC" : "UTC" + fmtOff(tzOff(Date.now() / 1000)) + (TZ.id === "logs" ? "" : ""));
function loadTz() { if (TZ.key === S.path) return; TZ.key = S.path; TZ.logs = null; api("/api/tz", { path: S.path }).then(r => { TZ.logs = Object.values(r.nodes); TZ.nodes = r.nodes; chips(); if (!W.res && !W.busy && !W.err && $("#wres")) start(); }).catch(() => { TZ.logs = []; }); }
// the same moment everywhere, for the little converter
const everywhere = e => { const rows = [["UTC", dt(e)]]; if (logsOff() != null && logsOff() !== 0) rows.push([zlabel("logs"), dz2("logs", e)]); rows.push([zlabel("local", e), dz2("local", e)]); if (!["utc", "logs", "local"].includes(TZ.id)) rows.push([zlabel(TZ.id, e), dz2(TZ.id, e)]); return rows; };
const dz2 = (id, e) => fromEpoch(Math.floor(e) + offOf(id, e)).slice(0, 19);

window.wsCounts = () => (W.res ? W.res.counts : null);
const FRESH = () => ({ fv: null, id: 0, text: "", fixed: false, icase: true, t: { mode: "any", a: null, r: 60, from: "", to: "" }, focus: null, view: "lines", res: null, all: null, pk: "", busy: false, err: "", sel: new Set(), last: null, open: {}, tall: false, scroll: 0, off: [], run: null });
// Every search is a tab. The open tab lives in W; the others are kept as they were left, results and scroll position included.
const TABS = { list: [] };
let tabSeq = 0, cur = "";
const saved = {};
const live = id => (id === W.id ? W : (TABS.list.find(x => x.id === id) || {}).s);
const stash = () => { const t = TABS.list.find(x => x.id === W.id); if (t) t.s = Object.assign({}, W, { scroll: window.scrollY, off: [...S.nodesOff] }); };
const loadTab = t => { Object.assign(W, FRESH(), t.s); S.nodesOff = new Set(t.s.off || []); };
const addTab = () => { const id = ++tabSeq; TABS.list.push({ id, s: Object.assign(FRESH(), { id }) }); return TABS.list[TABS.list.length - 1]; };
// each collection of logs keeps its own tabs, so leaving and coming back finds everything as it was
window.workspaceSwitch = path => {
  if (cur && TABS.list.length) { stash(); saved[cur] = { list: TABS.list, active: W.id }; }
  cur = path; const s = saved[path];
  if (s) { TABS.list = s.list; loadTab(TABS.list.find(x => x.id === s.active) || TABS.list[0]); }
  else { TABS.list = []; loadTab(addTab()); }
};
const sameQuery = (a, b) => a.text === b.text && a.fixed === b.fixed && a.icase === b.icase && a.focus === b.focus && JSON.stringify(a.t) === JSON.stringify(b.t);
const isBlank = s => !s.res && !s.busy && !s.err && !s.text && s.t.mode === "any" && !s.focus;
function tabLabel(s) {
  if (isBlank(s)) return s.fv ? short(s.fv.file.replace(/\.log$/, ""), 24) + " \u00b7 " + nshort(s.fv.node) : "New search";
  const p = [s.text ? short(s.text, 26) : "All lines"]; if (s.t.mode !== "any") p.push(timeLabel(s.t)); if (s.focus) p.push(nshort(s.focus)); return p.join(" · ");
}
function drawTabs() {
  const el = $("#wtabs"); if (!el) return;
  el.innerHTML = TABS.list.map(t => { const s = t.id === W.id ? W : t.s, n = s.res ? s.res.matched : null;
    return `<div class="wtab ${t.id === W.id ? "on" : ""}" data-t="${t.id}" title="${esc(tabLabel(s))}"><span class="tl">${esc(tabLabel(s))}</span>${s.busy ? '<span class="tn">...</span>' : n != null ? `<span class="tn">${compact(n)}</span>` : ""}<a class="tx" data-x="${t.id}" title="Close this search">&times;</a></div>`; }).join("") + '<button class="wtab add" id="wnew" title="Start another search and keep this one">+ New search</button>';
  el.querySelectorAll("[data-t]").forEach(d => d.onclick = e => { if (e.target.closest("[data-x]")) return; switchTab(+d.dataset.t); });
  el.querySelectorAll("[data-x]").forEach(x => x.onclick = e => { e.stopPropagation(); closeTab(+x.dataset.x); });
  $("#wnew").onclick = () => { openTab({}); const q = $("#wq"); if (q) q.focus(); };
}
// paint the open tab: the box, the options, the results
function syncUI() {
  const q = $("#wq"); if (!q) return; q.value = W.text; $("#wfx").checked = W.fixed; $("#wic").checked = W.icase; const sm = $("#wsmart"); if (sm) sm.innerHTML = "";
  if (W.res && W.pk !== pickParam()) { W.res = null; W.all = null; }
  chips(); if (W.res || W.busy || W.err) drawRes(); else start(); drawSel();
  window.scrollTo(0, W.scroll || 0);
}
function switchTab(id) { if (id === W.id) return; stash(); const t = TABS.list.find(x => x.id === id); if (!t) return; loadTab(t); syncUI(); if (!W.res && !W.busy && ready()) run(); }
function closeTab(id) {
  const i = TABS.list.findIndex(x => x.id === id); if (i < 0) return;
  if (TABS.list.length === 1) { TABS.list = []; loadTab(addTab()); syncUI(); return; }
  if (id === W.id) { const nb = TABS.list[i + 1] || TABS.list[i - 1]; TABS.list.splice(i, 1); loadTab(nb); syncUI(); if (!W.res && !W.busy && ready()) run(); }
  else { TABS.list.splice(i, 1); drawTabs(); }
}
// a search that should not cover the one you are reading: it opens beside it (or jumps to the tab that already has it)
function openTab(init) {
  init = Object.assign({ off: [...S.nodesOff] }, init || {});
  stash();
  const want = Object.assign(FRESH(), init || {});
  const dup = !isBlank(want) && TABS.list.find(t => sameQuery(t.id === W.id ? W : t.s, want) && !(t.id === W.id && isBlank(W)));
  if (dup) { if (dup.id !== W.id) { loadTab(dup); } syncUI(); if (!W.res && !W.busy && ready()) run(); return; }
  if (isBlank(W) && TABS.list.length) { Object.assign(W, init || {}); }
  else { const t = addTab(); loadTab(t); Object.assign(W, init || {}); }
  S.nodesOff = new Set(W.off || []); syncUI(); if (ready()) run();
}

// ------------------------------------------------------------------ the time window
function expr() {
  const t = W.t, cov = pickCoverage();
  if (t.mode === "around" && t.a != null) { const a = Math.floor(t.a); return `${dt(a - t.r)} to ${dt(a + t.r)}`; }
  if (t.mode === "after" && t.a != null) return `${dt(Math.floor(t.a))} to ${cov ? dt(cov.max + 86400) : "2100-01-01 00:00:00"}`;
  if (t.mode === "before" && t.a != null) return `${cov ? dt(cov.min - 86400) : "1970-01-02 00:00:00"} to ${dt(Math.floor(t.a))}`;
  if (t.mode === "between" && t.from && t.to) return `${t.from} to ${t.to}`;
  return "";
}
function timeLabel(tt) {
  const t = tt || W.t, f = e => dz(e).slice(5), g = s => dzs(s);
  if (t.mode === "around" && t.a != null) return `Around ${f(t.a)} ${rlabel(t.r)}`;
  if (t.mode === "after" && t.a != null) return `After ${f(t.a)}`;
  if (t.mode === "before" && t.a != null) return `Before ${f(t.a)}`;
  if (t.mode === "between" && t.from && t.to) return `${g(t.from).slice(5)} to ${g(t.to).slice(g(t.to).slice(0, 10) === g(t.from).slice(0, 10) ? 11 : 5)}`;
  return "Any time";
}
const setTime = (mode, a, r) => { W.t = { mode, a, r: r == null ? W.t.r : r, from: "", to: "" }; };
async function toE(text) { const r = await api("/api/time", { expr: text }); return toEpoch(r.from); }

// pick the time from the span the logs cover: a track to click or drag, a calendar field, and one chip per day
function timePopup(anchor) {
  const cov = pickCoverage(), lo = cov ? cov.min : null, hi = cov ? cov.max : null, span = cov ? Math.max(1, hi - lo) : 0;
  let mode = W.t.mode === "any" ? "around" : W.t.mode;
  const mid = cov ? Math.floor((lo + hi) / 2) : Math.floor(Date.now() / 1000), pad = cov ? Math.max(60, Math.floor(span * 0.04)) : 1800;
  let A = W.t.a != null ? W.t.a : mid, F = W.t.from ? toEpoch(W.t.from) : mid - pad, T2 = W.t.to ? toEpoch(W.t.to) : mid + pad, R = W.t.r;
  const clamp = e => (cov ? Math.max(lo, Math.min(hi, e)) : e), iso = e => dz(e).replace(" ", "T");
  const pct = e => (cov ? Math.max(0, Math.min(100, (e - lo) / span * 100)) : 0);
  const days = []; if (cov) { const o = tzOff(lo); for (let d = Math.floor((lo + o) / 86400) * 86400 - o; d <= hi && days.length < 40; d += 86400) days.push(d); }
  const win = () => mode === "around" ? [Math.floor(A) - R, Math.floor(A) + R] : mode === "after" ? [Math.floor(A), cov ? hi : null] : mode === "before" ? [cov ? lo : null, Math.floor(A)] : [F, T2];
  const preview = () => { if (mode === "any") return "Search the whole log."; const [x, y] = win(); return `Searching ${x == null ? "" : "from <b>" + dz(x) + "</b> "}${y == null ? "" : "to <b>" + dz(y) + "</b> "}${esc(zlabel(TZ.id, x == null ? y : x))}`; };
  const p = pop(anchor, "", () => {});
  const paint = () => {
    const one = p.querySelector("#ta"), f = p.querySelector("#tf"), t = p.querySelector("#tt"), mk = p.querySelector("#mk"), rg = p.querySelector("#rg");
    if (one && document.activeElement !== one) one.value = iso(A); if (f && document.activeElement !== f) f.value = iso(F); if (t && document.activeElement !== t) t.value = iso(T2);
    if (mk) mk.style.left = pct(A) + "%";
    if (rg) { const l = pct(Math.min(F, T2)), h = pct(Math.max(F, T2)); rg.style.left = l + "%"; rg.style.width = Math.max(0.6, h - l) + "%"; }
    p.querySelector("#tprev").innerHTML = preview();
    const cv = p.querySelector("#tconv"); if (cv) { const e = mode === "between" ? F : A; cv.innerHTML = mode === "any" ? "" : "Same moment: " + everywhere(e).map(([n, v]) => `<span class="mono">${esc(v.slice(5))}</span> ${esc(n)}`).join(" &middot; "); }
    p.querySelectorAll("[data-r]").forEach(c => c.classList.toggle("on", +c.dataset.r === R));
  };
  const draw = () => {
    const field = (id, v) => `<input id="${id}" type="datetime-local" step="1" class="mono" value="${iso(v)}" ${cov ? `min="${iso(lo)}" max="${iso(hi)}"` : ""}>`;
    p.innerHTML = `<h3>Time <a class="hint" id="tzin" style="font-weight:400" title="Change the time zone">in ${esc(zlabel(TZ.id))}</a></h3>
      <div class="seg" style="margin:10px 0">${[["any", "Any"], ["around", "Around"], ["after", "After"], ["before", "Before"], ["between", "Between"]].map(([k, l]) => `<button data-m="${k}" class="${mode === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${mode === "any" ? "" : `<div class="row" style="gap:8px;align-items:center">${mode === "between" ? `${field("tf", F)}<span class="hint">to</span>${field("tt", T2)}` : field("ta", A)}</div>
      ${cov ? `<div class="track" id="trk" title="${mode === "between" ? "Drag to choose a range" : "Click or drag to choose a moment"}"><div class="line"></div>${mode === "between" ? '<b class="rg" id="rg"></b>' : '<i class="mk" id="mk"></i>'}</div><div class="ends"><span>${esc(dz(lo))}</span><span>${esc(dz(hi))}</span></div>
      <div class="hint" style="margin:8px 0 4px">Pick a day <span class="hint">(scroll sideways for more)</span></div><div class="row dayrow" style="gap:5px">${days.map((d, i) => `<span class="chip" data-d="${d}">${esc(dz(d).slice(5, 10))}</span>`).join("")}</div>` : '<div class="hint">No logs are selected, so there is no range to pick from.</div>'}`}
      ${mode === "around" ? `<div class="row" style="gap:6px;margin-top:12px">${RADII.map(([r, l]) => `<span class="chip" data-r="${r}">${l}</span>`).join("")}</div>` : ""}
      <div class="hint" id="tprev" style="min-height:22px;margin:10px 0 2px"></div><div class="hint" id="tconv" style="margin:0 0 10px"></div>
      <div class="row"><button class="btn primary" id="tok">Apply</button><button class="btn quiet" id="tclr">Any time</button></div>`;
    p.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { mode = b.dataset.m; draw(); });
    const zi = p.querySelector("#tzin"); if (zi) zi.onclick = () => zonePopup(anchor);
    p.querySelectorAll("[data-r]").forEach(c => c.onclick = () => { R = +c.dataset.r; paint(); });
    p.querySelectorAll("[data-d]").forEach(c => c.onclick = () => { const d = +c.dataset.d; if (mode === "between") { F = clamp(d); T2 = clamp(d + 86399); } else A = clamp(d + (mode === "around" ? 43200 : 0)); paint(); });
    const rd = (id, set) => { const el = p.querySelector(id); if (el) el.onchange = () => { const v = el.value && parseZ(el.value.replace("T", " ")); if (v && !isNaN(v)) { set(clamp(v)); paint(); } }; };
    rd("#ta", v => (A = v)); rd("#tf", v => (F = v)); rd("#tt", v => (T2 = v));
    const trk = p.querySelector("#trk");
    if (trk) {
      const at = ev => { const r = trk.getBoundingClientRect(); return Math.round(lo + Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * span); };
      let down = null;
      trk.onpointerdown = ev => { trk.setPointerCapture(ev.pointerId); down = at(ev); if (mode === "between") { F = down; T2 = down; } else A = down; paint(); };
      trk.onpointermove = ev => { if (down == null) return; const e = at(ev); if (mode === "between") { F = Math.min(down, e); T2 = Math.max(down, e); } else A = e; paint(); };
      trk.onpointerup = () => { if (mode === "between" && T2 - F < 1) T2 = Math.min(hi, F + pad); down = null; paint(); };
    }
    $("#tclr").onclick = () => { setTime("any", null); popClose(); go2(); };
    $("#tok").onclick = () => {
      if (mode === "any") setTime("any", null);
      else if (mode === "between") { if (T2 <= F) { $("#tprev").innerHTML = '<span class="err">The end must be after the start.</span>'; return; } W.t = { mode, a: null, r: R, from: dt(F), to: dt(T2) }; }
      else setTime(mode, A, R);
      popClose(); go2();
    };
    paint();
  };
  draw();
}

// ------------------------------------------------------------------ what a pasted line can become
const mask = s => {
  let out = "", last = 0;
  const rx = /[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}|\b[0-9a-fA-F]{12,}\b|\d+(?:\.\d+)?/g; let m;
  while ((m = rx.exec(s))) { out += rxEsc(s.slice(last, m.index)) + (/^\d+(\.\d+)?$/.test(m[0]) ? "\\d+(\\.\\d+)?" : "[0-9a-fA-F-]{8,}"); last = m.index + m[0].length; }
  return (out + rxEsc(s.slice(last))).replace(/(\\d\+(\\\.\\d\+\)\?)?)(?:[-:.\/]?\1)+/g, "$1");
};
const body = line => { const m = line.match(TS); return (m ? line.replace(m[0], " ") : line).replace(/\s+/g, " ").trim(); };
function likeThis(line) {
  let b = body(line); if (b.length > 150) b = b.slice(0, 150).replace(/[^\s,:"{}\[\]]*$/, "");
  return mask(b).replace(/\\ /g, " +").replace(/ /g, " +");
}
function smart() {
  const v = $("#wq") ? $("#wq").value : ""; const m = v.match(TS), el = $("#wsmart"); if (!el) return;
  if (!m) { el.innerHTML = ""; return; }
  const rest = body(v), only = rest.length < 6;
  el.innerHTML = `<span class="hint">Found the time <b class="mono">${esc(m[0])}</b><span id="wutc"></span> in what you pasted. Search:</span>
    <button class="btn sm primary" data-sm="t">Everything logged around this time, all nodes</button>
    ${only ? "" : `<button class="btn sm" data-sm="like">Lines like this one</button><button class="btn sm" data-sm="exact">This exact text</button><button class="btn sm" data-sm="both">Lines like this one, only around this time</button>`}`;
  utcNote(m[0]).then(n => { const u = $("#wutc"); if (u && n) u.textContent = n; });
  el.querySelectorAll("[data-sm]").forEach(b => b.onclick = async () => {
    try {
      const k = b.dataset.sm; let a = await toE(timeIn(m[0])); if (!/(Z|[+-]\d\d:?\d\d)\s*$/.test(timeIn(m[0])) && !/^\d{10}/.test(m[0])) a -= tzOff(a);   // no zone in what was pasted: it is in the chosen zone
      const tm = (r) => ({ mode: "around", a, r, from: "", to: "" }), any = { mode: "any", a: null, r: W.t.r, from: "", to: "" };
      if (k === "t") openTab({ t: tm(W.t.mode === "around" ? W.t.r : 5) });
      else if (k === "like") openTab({ text: likeThis(v), t: any });
      else if (k === "exact") openTab({ text: short(body(v), 200).replace(/\.\.\.$/, ""), fixed: true, t: any });
      else openTab({ text: likeThis(v), t: tm(30) });
    } catch (e) { el.innerHTML = `<span class="err">${esc(String(e.message).replace(/^ValueError: /, ""))}</span>`; }
  });
}

// ------------------------------------------------------------------ the page
PAGES.workspace = function () {
  if (!S.path) { go("tickets"); return; }
  if (!TABS.list.length) { cur = S.path; loadTab(addTab()); }
  if (!pickSummary().files) { S.pick = defaultPick(); savePick(); }   // never land on an empty selection
  $("#page").innerHTML = `<div class="wrap wide ws">
    <div class="wtabs" id="wtabs"></div>
    <form class="bigsearch" id="wf"><input id="wq" autocomplete="off" spellcheck="false" placeholder="Paste a log line or a time, or type text or a regex to search every node"><button class="btn primary" type="submit">Search</button></form>
    <div id="wsmart" class="row smart"></div>
    <div class="row wchips"><button class="pillbtn" id="wt" data-pop></button><button class="pillbtn" id="wn" data-pop></button><button class="pillbtn" id="wfi" data-pop></button><button class="pillbtn" id="wz" data-pop title="The time zone times are shown and typed in"></button><span id="wfoc"></span>
      <label class="hint"><input type="checkbox" id="wfx"> plain text</label><label class="hint"><input type="checkbox" id="wic"> ignore case</label></div>
    <div id="wres"></div></div><div id="wsel" class="selbar"></div><div id="tip"></div>`;
  const q = $("#wq"); q.value = W.text; $("#wfx").checked = W.fixed; $("#wic").checked = W.icase;
  q.oninput = smart; q.addEventListener("paste", () => setTimeout(smart, 0));
  $("#wf").onsubmit = e => { e.preventDefault(); const b = $("#wsmart [data-sm]"); const v = q.value.trim();
    if (TS.test(v) && b && v !== W.text) { b.click(); return; } if (!v && W.t.mode === "any") return; openTab({ text: v, fixed: $("#wfx").checked, icase: $("#wic").checked, t: Object.assign({}, W.t), off: [...S.nodesOff] }); };
  $("#wfx").onchange = () => { W.fixed = $("#wfx").checked; if (W.text) go2(); }; $("#wic").onchange = () => { W.icase = $("#wic").checked; if (W.text) go2(); };
  $("#wt").onclick = e => timePopup(e.currentTarget); $("#wn").onclick = e => nodesPopup(e.currentTarget); $("#wfi").onclick = () => openSources(); $("#wz").onclick = e => zonePopup(e.currentTarget);
  loadTz(); syncUI(); if (!W.text && W.t.mode === "any") q.focus();
  if (!W.res && !W.busy && ready()) run();
};
HOOKS.workspace = () => { chips(); if (ready()) run(); else if (!W.res && !W.busy && !W.err) start(); };
const ready = () => !!(W.text || ["around", "between"].includes(W.t.mode) && expr());
function chips() {
  const ps = pickSummary(), off = S.nodesOff.size;
  const t = $("#wt"), n = $("#wn"), f = $("#wfi"); if (!t) return;
  t.innerHTML = `<span class="sl">When</span> <b>${esc(timeLabel())}</b> <span class="car">Change</span>`; t.classList.toggle("act", W.t.mode !== "any");
  n.innerHTML = `<span class="sl">Nodes</span> <b>${off ? ps.nodes + " of " + dnodes().length : "All " + ps.nodes}</b> <span class="car">Change</span>`;
  const fc = $("#wfoc"); if (fc) { fc.innerHTML = W.focus ? `<span class="chip on" id="wfocx" title="Click to include every node again">Only ${esc(nshort(W.focus))} <span class="x">&times;</span></span>` : ""; const x = $("#wfocx"); if (x) x.onclick = () => { W.focus = null; go2(); }; }
  drawTabs();
  const zb = $("#wz"); if (zb) zb.innerHTML = `<span class="sl">Times in</span> <b>${esc(TZ.id === "utc" ? "UTC" : TZ.id === "logs" ? "the logs' zone" : TZ.id === "local" ? "my zone" : TZ.id)}</b> <span class="car">Change</span>`;
  f.innerHTML = `<span class="sl">Files</span> <b>${ps.files} log files</b> <span class="car">Change</span>`;
}
function zonePopup(a) {
  const lg = logsOff(), now = Date.now() / 1000, uniq = TZ.logs ? [...new Set(TZ.logs)] : [];
  const opts = [["utc", "UTC", ""], ["logs", "The logs' own zone", lg == null ? (uniq.length > 1 ? "differs by node: " + uniq.map(fmtOff).join(", ") + ", so UTC is used" : "not known yet") : "UTC" + fmtOff(lg)], ["local", "My computer: " + mineName(), "UTC" + fmtOff(ianaOff("local", now))]];
  const other = !["utc", "logs", "local"].includes(TZ.id);
  let list = []; try { list = Intl.supportedValuesOf("timeZone"); } catch (e) {}
  const p = pop(a, `<h3>Time zone</h3><div class="cap" style="margin:4px 0 8px">What times are shown and typed in. Searches always run on UTC underneath.</div>
    <div class="col" style="gap:6px">${opts.map(([k, l, n]) => `<label class="row" style="gap:8px"><input type="radio" name="tzr" value="${k}" ${TZ.id === k ? "checked" : ""}><span>${esc(l)}</span><span class="hint">${esc(n)}</span></label>`).join("")}
      <label class="row" style="gap:8px"><input type="radio" name="tzr" value="other" ${other ? "checked" : ""}><span>Another zone</span><input id="tzo" list="tzlist" class="mono" style="width:220px" placeholder="America/New_York" value="${other ? esc(TZ.id) : ""}"><datalist id="tzlist">${list.map(z => `<option value="${esc(z)}">`).join("")}</datalist></label></div>
    <div style="margin:14px 0 6px"><b>Convert a time</b></div><input id="tzc" class="mono" style="width:100%" placeholder="Paste a time, with or without an offset, e.g. 2026-10-14T07:21:10-04:00"><div class="hint" id="tzcout" style="margin-top:8px;min-height:20px"></div>`, () => {});
  const apply = id => { TZ.id = id; try { localStorage.setItem("tz", id); } catch (e) {} chips(); if (W.res) drawRes(); else if (!W.busy && !W.err) start(); };
  p.querySelectorAll("[name=tzr]").forEach(r => r.onchange = () => { if (r.value === "other") { const v = $("#tzo").value.trim(); if (v && ianaOff(v, now) !== undefined && (!list.length || list.includes(v))) apply(v); else $("#tzo").focus(); } else apply(r.value); });
  $("#tzo").onchange = () => { const v = $("#tzo").value.trim(); if (!v) return; if (list.length && !list.includes(v)) { $("#tzcout").innerHTML = '<span class="err">Not a known zone name. Try one like Europe/Paris.</span>'; return; } p.querySelector("[value=other]").checked = true; apply(v); };
  let tm = 0; $("#tzc").oninput = () => { clearTimeout(tm); tm = setTimeout(async () => { const v = $("#tzc").value.trim(), o = $("#tzcout"); if (!v) { o.innerHTML = ""; return; }
    try { let e = await toE(timeIn(v)); if (!/(Z|[+-]\d\d:?\d\d)\s*$/.test(timeIn(v)) && !/^\d{10}/.test(v)) e = e - tzOff(e);   // no zone given: it means the chosen zone
      o.innerHTML = everywhere(e).map(([n, t]) => `<div><span class="mono">${esc(t)}</span> &nbsp;${esc(n)}</div>`).join(""); } catch (x) { o.innerHTML = `<span class="err">${esc(String(x.message).replace(/^ValueError: /, "").slice(0, 120))}</span>`; } }, 250); };
}
function nodesPopup(a) {
  const nodes = dnodes().filter(n => S.pick[n] && S.pick[n].length);
  pop(a, `<h3>Nodes</h3><div class="col" style="margin-top:8px;gap:4px">${nodes.map(n => `<label class="row" style="gap:8px"><input type="checkbox" data-n="${esc(n)}" ${S.nodesOff.has(n) ? "" : "checked"}>${dot(n)}<span>${esc(nshort(n))}</span><span class="hint">${esc(nodeServices(n))}</span></label>`).join("")}</div>`, p => {
    p.querySelectorAll("[data-n]").forEach(c => c.onchange = () => { c.checked ? S.nodesOff.delete(c.dataset.n) : S.nodesOff.add(c.dataset.n); if (S.nodesOff.size >= nodes.length) { S.nodesOff.clear(); c.checked = true; } W.focus = null; W.off = [...S.nodesOff]; chips(); go2(); });
  });
}
function filesPopup(a) {
  const fs = pickFiles(), ps = pickSummary();
  pop(a, `<h3>Log files</h3><div class="cap" style="margin:4px 0 8px">Reading ${ps.files} files on ${ps.nodes} nodes.</div><div class="row" style="gap:5px;max-width:480px">${fs.slice(0, 24).map(f => `<span class="chip">${esc(f.replace(/\.log$/, ""))}</span>`).join("")}${fs.length > 24 ? `<span class="hint">+${fs.length - 24} more</span>` : ""}</div>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="wpick">Choose files per node</button></div>`, p => { $("#wpick").onclick = () => { popClose(); go("logs"); }; });
}
function go2() { W.res = null; W.err = ""; W.sel.clear(); W.open = {}; const q = $("#wq"); if (q && q.value !== W.text) q.value = W.text; const sm = $("#wsmart"); if (sm) sm.innerHTML = ""; chips(); if (ready()) run(); else start(); }

function start() { if (!W.text && W.t.mode === "any" && S.fileMap) return drawFile(); help(); }
function help() {
  const el = $("#wres"); if (!el) return;
  const cov = pickCoverage();
  el.innerHTML = `<div class="empty ws0"><h2>What do you want to find?</h2>
    <div class="ex"><div><b>Paste a log line</b><span>Copy a line from a ticket or log. cbtriage finds its time and offers to show everything logged then, on every node.</span></div>
    <div><b>Type text</b><span>Plain text or a regex. Use <b>When</b> to limit it to after a date, before one, or around a moment.</span></div>
    <div><b>Pick a time</b><span>Choose <b>When</b> &rarr; Around, to read what every node logged at that moment.</span></div></div>
    ${cov ? `<div class="hint" style="margin-top:14px">The log files you picked cover ${esc(dz(cov.min))} to ${esc(dz(cov.max))} ${esc(zshort())}.${logsOff() != null && logsOff() !== 0 ? ` These logs were written in UTC${fmtOff(logsOff())}.` : logsOff() === 0 ? " These logs were written in UTC." : ""}</div>` : ""}</div>`;
}

// ------------------------------------------------------------------ running
const params = () => {
  const e = effPick(); let pick = e; if (W.focus && e[W.focus]) pick = { [W.focus]: e[W.focus] };
  return { path: S.path, regex: W.text, pick: JSON.stringify(pick), time: expr(), bucket: "auto", icase: W.icase ? 1 : 0, fixed: W.fixed ? 1 : 0, rows: 500 };
};
async function run() {
  const id = W.id, tok = {}, prm = params(); W.run = tok; W.pk = pickParam(); W.busy = true; W.err = ""; W.sel.clear(); drawRes(); drawTabs();
  let r = null, err = "";
  try { r = await api("/api/sx", prm); } catch (e) { err = String(e.message).replace(/^ValueError: /, ""); }
  const h = live(id); if (!h || h.run !== tok) return;   // the tab was closed or searched again meanwhile
  h.busy = false; h.res = r; h.err = err; if (r && !h.focus) h.all = r.counts;
  if (h === W) { if (S.page === "workspace") drawRes(); }
  if (S.page === "workspace") drawTabs();
}
const nodeCounts = r => { const m = {}; (r.counts || []).forEach(c => { m[c.node] = (m[c.node] || 0) + c.n; }); return m; };
const msgOf = l => { const m = l.match(TS); return m && m.index < 4 ? l.slice(m.index + m[0].length).replace(/^\s+/, "") : l; };
function hl(text) {
  if (!W.text) return esc(text);
  try { const u = new RegExp(W.fixed ? rxEsc(W.text) : W.text, W.icase ? "gi" : "g"); let out = "", last = 0, m, n = 0;
    while ((m = u.exec(text)) && n++ < 20) { if (!m[0]) { u.lastIndex++; continue; } out += esc(text.slice(last, m.index)) + "<mark>" + esc(m[0]) + "</mark>"; last = m.index + m[0].length; } return out + esc(text.slice(last)); } catch (e) { return esc(text); }
}

// ------------------------------------------------------------------ results
function drawRes() {
  const el = $("#wres"); if (!el) return; const r = W.res;
  if (W.err) { el.innerHTML = `<div class="card err" style="margin-top:14px">${esc(W.err)}</div>`; return; }
  if (!r) { el.innerHTML = W.busy ? '<div class="spin" style="margin-top:20px">Searching every node...</div>' : ""; return; }
  const nc = nodeCounts(r), all = W.all ? nodeCounts({ counts: W.all }) : nc, order = Object.keys(all).sort((a, b) => all[b] - all[a]);
  if (!r.matched) { el.innerHTML = `<div class="empty ws0" style="margin-top:14px"><h2>Nothing matched</h2><div class="hint">${W.text ? `No line has <b>${esc(short(W.text, 80))}</b>` : "Nothing was logged"}${expr() ? " in " + esc(timeLabel().toLowerCase()) : ""}${W.focus ? " on " + esc(nshort(W.focus)) : ""}. Try a wider time, or turn on <b>ignore case</b>.</div><div class="row" style="margin-top:10px;gap:8px">${W.t.mode !== "any" ? '<button class="btn" id="wany">Search any time</button>' : ""}${W.focus ? '<button class="btn" id="wallnodes">Include all nodes</button>' : ""}</div></div>`;
    const an = $("#wallnodes"); if (an) an.onclick = () => { W.focus = null; go2(); };
    const wa = $("#wany"); if (wa) wa.onclick = () => { setTime("any", null); go2(); }; return; }
  const rows = r.rows, timed = rows.filter(x => x.t), multiDay = timed.length > 1 && timed[0].t.slice(0, 10) !== timed[timed.length - 1].t.slice(0, 10);
  const views = [["lines", "Lines"], ["groups", "Grouped"]].concat(r.has_groups ? [["counts", "Counts"]] : []);
  el.innerHTML = `<div class="rhead"><div class="grow"><b>${r.matched.toLocaleString()}</b> lines${W.text ? "" : " logged"} <span class="muted">on ${order.length} node${order.length === 1 ? "" : "s"}${r.window ? ", " + esc(dzs(r.window.from)) + " to " + esc(dzs(r.window.to)) + " " + esc(zshort()) : ""}</span>${r.rows_truncated && W.view === "lines" ? ` <span class="warn">&middot; showing the first ${rows.length}, narrow the time to see the rest</span>` : ""}</div>
      <div class="seg">${views.map(([k, l]) => `<button data-v="${k}" class="${W.view === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="row" style="gap:6px;margin:8px 0">${order.map(n => `<span class="chip ${W.focus === n ? "on" : ""}" data-f="${esc(n)}" title="${W.focus === n ? "Show every node again" : "Show only this node"}">${dot(n)}${esc(nshort(n))} <b>${(all[n] || 0).toLocaleString()}</b></span>`).join("")}${W.focus ? '<a id="wall" class="hint">all nodes</a>' : ""}</div>
    ${strip(r)}<div id="wbody"></div>`;
  el.querySelectorAll("[data-v]").forEach(b => b.onclick = () => { W.view = b.dataset.v; drawRes(); });
  el.querySelectorAll("[data-f]").forEach(c => c.onclick = () => { W.focus = W.focus === c.dataset.f ? null : c.dataset.f; run(); });
  const wa = $("#wall"); if (wa) wa.onclick = () => { W.focus = null; run(); };
  wireStrip(r);
  const b = $("#wbody");
  if (W.view === "lines") drawLines(b, rows, multiDay); else if (W.view === "groups") drawGroups(b, r); else drawCounts(b, r);
  drawSel();
}

// the density strip: how many lines per slice of time. Drag across it to look at just that part.
function strip(r) {
  const H = r.histogram; if (!H || H.length < 2) return "";
  const mx = Math.max(...H.map(h => h.total), 1);
  return `<div class="dstrip" id="wstrip" title="Drag across to look at just that part"><div class="bars">${H.map((h, i) => `<i data-i="${i}" style="height:${Math.max(2, Math.round(h.total / mx * 100))}%" title="${esc(dzs(h.t))}: ${h.total.toLocaleString()} lines"></i>`).join("")}</div><div class="ends"><span>${esc(dzs(H[0].t).slice(5))}</span><span>${esc(dzs(H[H.length - 1].t).slice(5))} ${esc(zshort())}</span></div><div class="sel" id="wsr" style="display:none"></div></div>`;
}
function wireStrip(r) {
  const el = $("#wstrip"); if (!el) return; const H = r.histogram, bars = [...el.querySelectorAll(".bars i")], sr = $("#wsr");
  const bs = Math.max(1, Math.round(toEpoch(H[1].t) - toEpoch(H[0].t)));
  const idx = ev => { const b = el.querySelector(".bars").getBoundingClientRect(); return Math.max(0, Math.min(H.length - 1, Math.floor((ev.clientX - b.left) / b.width * H.length))); };
  let a = null;
  const paint = (x, y) => { const l = Math.min(x, y), h = Math.max(x, y), w = el.getBoundingClientRect(), b = el.querySelector(".bars").getBoundingClientRect(); sr.style.display = "block"; sr.style.left = (b.left - w.left + l / H.length * b.width) + "px"; sr.style.width = ((h - l + 1) / H.length * b.width) + "px"; };
  el.onmousedown = ev => { a = idx(ev); paint(a, a); ev.preventDefault(); };
  window.onmousemove = ev => { if (a != null) paint(a, idx(ev)); };
  window.onmouseup = ev => { if (a == null) return; const e = idx(ev), l = Math.min(a, e), h = Math.max(a, e); a = null;
    openTab({ text: W.text, fixed: W.fixed, icase: W.icase, off: [...S.nodesOff], t: { mode: "between", a: null, r: W.t.r, from: dt(toEpoch(H[l].t)), to: dt(toEpoch(H[h].t) + bs - 1) } }); };
}

// ------------------------------------------------------------------ the lines
function drawLines(b, rows, multiDay) {
  const nodes = dnodes();
  b.innerHTML = `<div class="lines">${rows.map((x, i) => `<div class="ln ${W.sel.has(i) ? "sel" : ""}" data-i="${i}"><span class="lt" title="${x.t ? (x.inh ? "This line continues the entry that started at " : "") + esc(x.t.slice(0, 19)) + " UTC" : "This line has no time of its own: it belongs to the line above it"}">${x.t ? (x.inh ? "<i>" : "") + esc(multiDay ? dzs(x.t).slice(5) : dzs(x.t).slice(11)) + (x.inh ? "</i>" : "") : "&middot;&middot;&middot;"}</span><span class="lnode" title="${esc(x.node)}">${dot(x.node)}${esc(nshort(x.node))}</span><span class="lfile">${esc(x.file.replace(/\.log$/, ""))}</span><span class="lm">${hl(msgOf(x.line))}</span>
      <span class="lact"><a data-a="copy" title="Copy this line">Copy</a>${x.t ? '<a data-a="all" title="Open everything logged on every node within 5 seconds of this line, in a new tab">Everything at this time</a>' : ""}<a data-a="near" title="The lines just before and after, in this file">Nearby</a><a data-a="sim" title="Lines like this one">Find similar</a></span></div><div class="nearby" id="nb${i}"></div>`).join("")}</div>`;
  b.querySelectorAll(".ln").forEach(row => {
    const i = +row.dataset.i, x = rows[i];
    row.onclick = e => { const a = e.target.closest("[data-a]"); if (a) { act(a.dataset.a, x, i); return; } if (window.getSelection().toString()) return; pick(i, e.shiftKey); };
  });
  b.querySelectorAll(".nearby").forEach(n => { const i = +n.id.slice(2); if (W.open[i]) fillNear(i, rows[i]); });
}
function pick(i, range) {
  if (range && W.last != null) { const [a, b] = [Math.min(W.last, i), Math.max(W.last, i)]; for (let k = a; k <= b; k++) W.sel.add(k); } else if (W.sel.has(i)) W.sel.delete(i); else W.sel.add(i);
  W.last = i; $$(".ln").forEach(r => r.classList.toggle("sel", W.sel.has(+r.dataset.i))); drawSel();
}
async function act(k, x, i) {
  if (k === "copy") return copyText(x.line, "Copied the line");
  if (k === "all") { toast("Opened everything logged around " + dzs(x.t) + " " + zshort() + " in a new tab"); return openTab({ t: { mode: "around", a: toEpoch(x.t), r: 5, from: "", to: "" }, off: [...S.nodesOff] }); }
  if (k === "sim") return openTab({ text: likeThis(x.line), t: Object.assign({}, W.t), off: [...S.nodesOff] });
  if (k === "near") { W.open[i] = !W.open[i]; if (W.open[i]) fillNear(i, x); else $("#nb" + i).innerHTML = ""; }
}
async function fillNear(i, x) {
  const el = $("#nb" + i); if (!el) return; el.innerHTML = '<div class="hint" style="padding:6px 0 6px 12px">Reading...</div>';
  try { const c = await api("/api/context", { path: S.path, node: x.node, file: x.file, line: x.lineno, before: 6, after: 6 });
    el.innerHTML = `<div class="ctx"><div class="row sp"><span class="hint">${esc(nshort(x.node))} &middot; ${esc(x.file)} &middot; lines ${c.start}&ndash;${c.start + c.lines.length - 1}</span><span class="row" style="gap:6px"><button class="btn sm" data-c="1">Copy</button><button class="btn sm" data-c="2">Copy with command</button><button class="btn sm" data-c="3">Add to evidence</button></span></div>
      <pre>${c.lines.map((l, k) => `<span class="${c.start + k === c.target ? "hit" : ""}">${esc(l)}</span>`).join("\n")}</pre></div>`;
    const txt = c.lines.join("\n"), cmd = `cd ${shq(x.node)} 2>/dev/null; ${c.command}`;
    el.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { b.dataset.c === "1" ? copyText(txt, "Copied") : b.dataset.c === "2" ? copyText(`$ ${cmd}\n${txt}`, "Copied with the command") : addEvidence({ label: `${nshort(x.node)}, ${x.file} around line ${x.lineno}`, command: cmd, output: txt }); });
  } catch (e) { el.innerHTML = `<div class="err" style="padding:6px 12px">${esc(e.message)}</div>`; }
}

// ------------------------------------------------------------------ copying what is selected, with the command that finds it
function command() {
  const r = W.res; if (!r) return ""; let c = r.command;
  if (r.window) c += r.window.iso_prefix ? ` | rg -a -N ${shq(r.window.iso_prefix)}` : `   # UTC window ${r.window.from.slice(0, 19)} to ${r.window.to.slice(0, 19)}`;
  return c;
}
function drawSel() {
  if (fvActive()) return fvSel();
  const el = $("#wsel"); if (!el) return; const n = W.sel.size; el.classList.toggle("on", n > 0);
  if (!n) { el.innerHTML = ""; return; }
  el.innerHTML = `<b>${n} line${n === 1 ? "" : "s"} selected</b><button class="btn sm" data-s="c">Copy lines</button><button class="btn sm" data-s="m">Copy with command</button><button class="btn sm" data-s="e">Add to evidence</button><button class="btn sm" data-s="x">Clear</button>`;
  const lines = () => [...W.sel].sort((a, b) => a - b).map(i => W.res.rows[i]), raw = () => lines().map(x => x.line).join("\n"), tag = () => lines().map(x => `${nshort(x.node)}/${x.file}: ${x.line}`).join("\n");
  el.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { const k = b.dataset.s;
    if (k === "c") copyText(raw(), `Copied ${n} line${n === 1 ? "" : "s"}`); else if (k === "m") copyText(`$ ${command()}\n${tag()}`, "Copied with the command");
    else if (k === "e") addEvidence({ label: W.text ? `Lines matching ${short(W.text, 60)}` : `Lines around ${timeLabel().toLowerCase()}`, command: command(), output: tag() }); else { W.sel.clear(); $$(".ln.sel").forEach(r => r.classList.remove("sel")); drawSel(); } });
}

// ------------------------------------------------------------------ the whole file, when there is nothing to search for
const fvActive = () => !W.res && !W.busy && !W.err && !W.text && W.t.mode === "any" && !!W.fv && !!$("#fvl");
const lvl = t => (/\b(CRITICAL|FATAL|ERROR|ERRO)\b|^\[\w+:(error|critical),|\[(Error|Fatal)\]/.test(t.slice(0, 220)) ? "e" : /\b(WARNING|WARN)\b|^\[\w+:warn|\[Warn/.test(t.slice(0, 220)) ? "w" : "");
const FV_N = 300;
function fvDefault() {
  const e = effPick(), names = [...new Set(Object.values(e).flat())];
  const rank = f => { const i = MAIN_FILES.indexOf(f); return i < 0 ? 99 : i; };
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const file = names[0]; return { file, node: Object.keys(e).find(n => e[n].includes(file)) };
}
async function fvLoad(f, start) {
  const box = $("#fvl"); if (box && W.fv === f) box.innerHTML = '<div class="spin">Reading...</div>';
  try { const j = await api("/api/readfile", { path: S.path, node: f.node, file: f.file, start, n: FV_N }); f.start = j.start; f.total = j.total; f.lines = j.lines; f.cmd = j.command; f.err = ""; }
  catch (e) { f.err = String(e.message).replace(/^ValueError: /, ""); f.lines = []; }
  if (W.fv === f && fvActive()) fvPaint();
}
function drawFile() {
  const el = $("#wres"); if (!el) return; const e = effPick(), files = pickFiles();
  if (!files.length) { help(); return; }
  let f = W.fv; if (!f || !e[f.node] || !e[f.node].includes(f.file)) f = W.fv = Object.assign({ start: 1, total: 0, lines: [], sel: new Set(), last: null, hit: 0, err: "" }, fvDefault());
  const nodes = Object.keys(e).filter(n => e[n].includes(f.file)), m = (S.fileMap[f.node] || {})[f.file] || {}, fi = fileInfo(f.file);
  drawTabs();
  const rank = x => { const i = MAIN_FILES.indexOf(x); return i < 0 ? 99 : i; }; const sorted = files.slice().sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  el.innerHTML = `<div class="fvhead"><div class="row" style="gap:10px;flex-wrap:wrap"><select id="fvf" class="mono">${sorted.map(x => `<option ${x === f.file ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
      <span class="hint">on</span>${nodes.map(n => `<span class="chip ${n === f.node ? "on" : ""}" data-fn="${esc(n)}" title="${esc(n)}">${dot(n)}${esc(nshort(n))}</span>`).join("")}</div>
    <div class="hint" style="margin-top:4px">${esc(fi.desc || "")}${fi.desc ? " &middot; " : ""}${esc(fmtSize(m.size || 0))}${m.first ? ` &middot; covers ${esc(dz(toEpoch(m.first)))} to ${esc(dz(toEpoch(m.last)))} ${esc(zshort())}` : ""}</div>
    <div class="row" style="gap:16px;margin:10px 0;flex-wrap:wrap"><div class="row" id="fvpg" style="gap:6px"></div>
      <form class="row" id="fvgt" style="gap:6px"><span class="hint">Go to time</span><input id="fvgtv" placeholder="${esc(m.first ? dz(toEpoch(m.first)) : "2026-10-13 01:33")}" style="width:180px"><button class="btn sm" type="submit">Go</button></form>
      <form class="row" id="fvgl" style="gap:6px"><span class="hint">Go to line</span><input id="fvglv" inputmode="numeric" style="width:90px"><button class="btn sm" type="submit">Go</button></form></div><div class="hint" id="fvmsg" style="min-height:18px"></div></div>
    <div class="card" id="fvl" style="padding:8px 6px"></div>`;
  $("#fvf").onchange = e => { W.fv = Object.assign({ start: 1, total: 0, lines: [], sel: new Set(), last: null, hit: 0, err: "" }, { file: e.target.value, node: (Object.keys(e0()).find(n => e0()[n].includes(e.target.value))) }); drawFile(); };
  const e0 = () => effPick();
  el.querySelectorAll("[data-fn]").forEach(c => c.onclick = () => { f.node = c.dataset.fn; f.sel.clear(); f.lines = []; drawFile(); });
  $("#fvgt").onsubmit = async ev => { ev.preventDefault(); const v = $("#fvgtv").value.trim(); if (!v) return; $("#fvmsg").textContent = "Looking...";
    try { let t = await toE(timeIn(v)); if (!/(Z|[+-]\d\d:?\d\d)\s*$/.test(timeIn(v)) && !/^\d{10}/.test(v)) t -= tzOff(t);
      const j = await api("/api/findline", { path: S.path, node: f.node, file: f.file, time: dt(t) + "Z" }); $("#fvmsg").textContent = ""; f.hit = j.line; fvLoad(f, Math.max(1, j.line - 8)); }
    catch (er) { $("#fvmsg").innerHTML = `<span class="err">${esc(String(er.message).replace(/^ValueError: /, "").slice(0, 160))}</span>`; } };
  $("#fvgl").onsubmit = ev => { ev.preventDefault(); const n = parseInt($("#fvglv").value, 10); if (!n) return; f.hit = n; fvLoad(f, Math.max(1, n - 8)); };
  if (f.lines.length || f.err) fvPaint(); else fvLoad(f, f.start || 1);
}
function fvPaint() {
  const f = W.fv, box = $("#fvl"); if (!f || !box) return; const end = f.start + f.lines.length - 1;
  $("#fvpg").innerHTML = `<button class="btn sm" data-pg="first">First</button><button class="btn sm" data-pg="prev">&lsaquo; Previous</button><b style="font-size:13.5px">lines ${f.start.toLocaleString()} to ${Math.max(f.start, end).toLocaleString()} of ${f.total.toLocaleString()}</b><button class="btn sm" data-pg="next">Next &rsaquo;</button><button class="btn sm" data-pg="last">Last</button>`;
  $$("#fvpg [data-pg]").forEach(b => b.onclick = () => { const k = b.dataset.pg; fvLoad(f, k === "first" ? 1 : k === "prev" ? f.start - FV_N : k === "next" ? f.start + FV_N : Math.max(1, f.total - FV_N + 1)); window.scrollTo({ top: 0 }); });
  box.innerHTML = f.err ? `<div class="err" style="padding:8px">${esc(f.err)}</div>` : f.lines.map((t, i) => { const n = f.start + i; return `<div class="rl ${lvl(t)} ${f.sel.has(n) ? "sel" : ""} ${n === f.hit ? "hit" : ""}" data-n="${n}"><span class="n">${n}</span><span class="t mono">${esc(t)}</span></div>`; }).join("") || '<div class="empty">This part of the file is empty.</div>';
  box.querySelectorAll(".rl").forEach(d => d.onclick = ev => { if (String(window.getSelection()).length) return; const n = +d.dataset.n;
    if (ev.shiftKey && f.last) { const [a, b] = [Math.min(f.last, n), Math.max(f.last, n)]; for (let i = a; i <= b; i++) f.sel.add(i); } else if (f.sel.has(n)) f.sel.delete(n); else f.sel.add(n); f.last = n;
    box.querySelectorAll(".rl").forEach(r => r.classList.toggle("sel", f.sel.has(+r.dataset.n))); fvSel(); });
  const h = box.querySelector(".hit"); if (h) h.scrollIntoView({ block: "center" }); fvSel();
}
function fvSel() {
  const f = W.fv, el = $("#wsel"); if (!el || !f) return; const n = f.sel.size; el.classList.toggle("on", n > 0);
  if (!n) { el.innerHTML = ""; return; }
  const ls = () => [...f.sel].sort((a, b) => a - b).filter(x => x >= f.start && x < f.start + f.lines.length).map(x => ({ n: x, t: f.lines[x - f.start] }));
  const blocks = () => { const out = []; let run = []; const flush = () => { if (run.length) out.push({ label: `${nshort(f.node)}, ${f.file}`, command: `sed -n '${run[0].n},${run[run.length - 1].n}p' ${f.file}`, output: run.map(x => x.t).join("\n") }); run = []; };
    ls().forEach(x => { if (run.length && x.n !== run[run.length - 1].n + 1) flush(); run.push(x); }); flush(); return out; };
  el.innerHTML = `<b>${n} line${n === 1 ? "" : "s"} selected</b><button class="btn sm" data-s="c">Copy lines</button><button class="btn sm" data-s="m">Copy with command</button><button class="btn sm" data-s="e">Add to evidence</button><button class="btn sm" data-s="x">Clear</button>`;
  el.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { const k = b.dataset.s;
    if (k === "c") copyText(ls().map(x => x.t).join("\n"), `Copied ${n} line${n === 1 ? "" : "s"}`); else if (k === "m") copyText(blocks().map(x => evidenceText(x)).join("\n\n"), "Copied with the command");
    else if (k === "e") addEvidence(blocks()); else { f.sel.clear(); $$("#fvl .rl.sel").forEach(r => r.classList.remove("sel")); fvSel(); } });
}

// ------------------------------------------------------------------ the other two views
function drawGroups(b, r) {
  const g = r.repeats; if (!g.length) { b.innerHTML = '<div class="muted">Nothing to group.</div>'; return; }
  b.innerHTML = `<div class="cap">Lines that differ only in numbers, ids or times are one row. Click a row to search for just those lines.</div><div class="lines">${g.slice(0, 60).map((x, i) => `<div class="ln grp" data-g="${i}"><span class="lt gn">${x.n.toLocaleString()}</span><span class="lnode">${Object.keys(x.nodes).length} node${Object.keys(x.nodes).length === 1 ? "" : "s"}</span><span class="lfile">${esc(x.first.slice(5, 19))}</span><span class="lm">${esc(short(msgOf(x.sample), 300))}</span></div>`).join("")}</div>${r.repeats_sampled ? `<div class="hint">Grouped from a sample of ${r.repeat_sample.toLocaleString()} lines.</div>` : ""}`;
  b.querySelectorAll("[data-g]").forEach(d => d.onclick = () => { openTab({ text: likeThis(g[+d.dataset.g].sample), t: Object.assign({}, W.t), off: [...S.nodesOff] }); });
}
function drawCounts(b, r) {
  const g = r.groups; if (!g.length) { b.innerHTML = '<div class="muted">The regex has a capture group, but nothing was captured.</div>'; return; }
  b.innerHTML = `<div class="cap">How many lines have each value of the part of your regex in parentheses.</div><div class="lines">${g.slice(0, 80).map(x => `<div class="ln grp"><span class="lt gn">${x.n.toLocaleString()}</span><span class="lnode">${Object.keys(x.nodes).length} node${Object.keys(x.nodes).length === 1 ? "" : "s"}</span><span class="lm mono">${esc(x.key)}</span></div>`).join("")}</div>`;
}
})();
