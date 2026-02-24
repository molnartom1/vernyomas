// js/app.js
import { drawTrendChart, buildPrintChartDataUrl } from "./chart.js";
import { makeSupabase, cloudPull, cloudPush } from "./sync.js";

const STORAGE_KEY = "bp_log_v20";
const UI_KEY = "bp_ui_v20";
const PREF_KEY = "bp_chart_v20";
const SYNC_KEY = "bp_sync_v20";

const $ = (id)=>document.getElementById(id);

const els = {
  form: $("bpForm"),
  formTitle: $("formTitle"),
  saveBtn: $("saveBtn"),
  cancelEditBtn: $("cancelEditBtn"),

  dt: $("dt"),
  sys: $("sys"),
  dia: $("dia"),
  pulse: $("pulse"),
  arm: $("arm"),
  context: $("context"),
  note: $("note"),

  list: $("list"),
  empty: $("empty"),

  search: $("search"),
  range: $("range"),
  rangeCustomWrap: $("rangeCustomWrap"),
  rangeCustomDays: $("rangeCustomDays"),

  avgSys: $("avgSys"),
  avgDia: $("avgDia"),
  avgPulse: $("avgPulse"),

  countLabel: $("countLabel"),
  filteredLabel: $("filteredLabel"),

  pageSize: $("pageSize"),
  pager: $("pager"),

  chartWrap: $("chartWrap"),
  toggleChart: $("toggleChart"),
  chart: $("chart"),
  chartHint: $("chartHint"),
  tooltip: $("tooltip"),

  showPulse: $("showPulse"),
  showZone: $("showZone"),
  snapNearest: $("snapNearest"),

  zoneSysLo: $("zoneSysLo"),
  zoneSysHi: $("zoneSysHi"),
  zoneDiaLo: $("zoneDiaLo"),
  zoneDiaHi: $("zoneDiaHi"),

  fillNow: $("fillNow"),
  quickMorning: $("quickMorning"),
  quickEvening: $("quickEvening"),

  exportJsonBtn: $("exportJsonBtn"),
  exportCsvAllBtn: $("exportCsvAllBtn"),
  exportCsvFilteredBtn: $("exportCsvFilteredBtn"),
  importFile: $("importFile"),
  clearAll: $("clearAll"),
  seedDemo: $("seedDemo"),
  printBtn: $("printBtn"),

  // sync ui
  syncDot: $("syncDot"),
  syncText: $("syncText"),
  syncMeta: $("syncMeta"),
  syncSettingsBtn: $("syncSettingsBtn"),
  syncNowBtn: $("syncNowBtn"),

  // modal
  modalOverlay: $("modalOverlay"),
  modalClose: $("modalClose"),
  modalCancel: $("modalCancel"),
  modalSave: $("modalSave"),
  mLogId: $("mLogId"),
  mPin: $("mPin"),
  mPinHint: $("mPinHint"),
  mMode: $("mMode"),

  printArea: $("printArea"),
  toast: $("toast"),
};

let entries = loadEntries();
let editingId = null;

let chartVisible = true;
let page = 1;
let pageSize = 5;

let uiPrefs = loadJson(UI_KEY, { range:"all", rangeCustomDays:14, pageSize:5, chartVisible:true });
let chartPrefs = loadJson(PREF_KEY, {
  showPulse:true,
  showZone:true,
  snapNearest:true,
  zoneSysLo:110, zoneSysHi:130, zoneDiaLo:70, zoneDiaHi:85
});

let syncCfg = loadJson(SYNC_KEY, {
  enabled:false, logId:"", pinHint:"", lastPullAt:null, lastPushAt:null, lastRemoteAt:null
});
let localRevision = Date.now();
let syncBusy = false;
let sb = null;

/* toast */
function toast(msg, ms=2400){
  els.toast.textContent = msg;
  els.toast.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> els.toast.style.display="none", ms);
}

/* init */
boot();

function boot(){
  // defaults
  setNow();

  // restore UI
  els.range.value = uiPrefs.range || "all";
  els.rangeCustomDays.value = String(uiPrefs.rangeCustomDays || 14);
  els.pageSize.value = (uiPrefs.pageSize === "all") ? "all" : String(uiPrefs.pageSize || 5);
  pageSize = (els.pageSize.value === "all") ? Infinity : clampInt(parseInt(els.pageSize.value,10), 1, 9999);

  chartVisible = uiPrefs.chartVisible !== false;
  els.chartWrap.style.display = chartVisible ? "block" : "none";
  els.toggleChart.textContent = chartVisible ? "Grafikon elrejt" : "Grafikon mutat";

  // restore chart prefs
  els.showPulse.checked = !!chartPrefs.showPulse;
  els.showZone.checked = !!chartPrefs.showZone;
  els.snapNearest.checked = !!chartPrefs.snapNearest;
  els.zoneSysLo.value = chartPrefs.zoneSysLo;
  els.zoneSysHi.value = chartPrefs.zoneSysHi;
  els.zoneDiaLo.value = chartPrefs.zoneDiaLo;
  els.zoneDiaHi.value = chartPrefs.zoneDiaHi;

  syncRangeCustomUI();

  // supabase init (GitHub Pages: HTTPS OK)
  sb = makeSupabase();
  updateSyncUI();

  // events
  wire();

  renderAll();
  toast("Betöltve ✔");
}

function wire(){
  els.form.addEventListener("submit", onSave);
  els.cancelEditBtn.addEventListener("click", ()=>{ exitEdit(); toast("Szerkesztés megszakítva."); });

  els.fillNow.addEventListener("click", ()=>{ setNow(); toast("Idő ✔"); });
  els.quickMorning.addEventListener("click", ()=>{ setPreset(7,0); if(!els.note.value.trim()) els.note.value="Reggel"; els.sys.focus(); toast("Reggel ✔"); });
  els.quickEvening.addEventListener("click", ()=>{ setPreset(19,0); if(!els.note.value.trim()) els.note.value="Este"; els.sys.focus(); toast("Este ✔"); });

  els.search.addEventListener("input", ()=>{ page=1; renderAll(); });
  els.range.addEventListener("change", ()=>{ uiPrefs.range = els.range.value; saveJson(UI_KEY, uiPrefs); syncRangeCustomUI(); page=1; renderAll(); });
  els.rangeCustomDays.addEventListener("input", ()=>{ uiPrefs.rangeCustomDays = clampInt(parseInt(els.rangeCustomDays.value,10), 1, 3650); saveJson(UI_KEY, uiPrefs); page=1; renderAll(); });

  els.pageSize.addEventListener("change", ()=>{
    const v = els.pageSize.value;
    pageSize = (v === "all") ? Infinity : clampInt(parseInt(v,10), 1, 9999);
    uiPrefs.pageSize = (v === "all") ? "all" : pageSize;
    saveJson(UI_KEY, uiPrefs);
    page = 1;
    renderAll();
  });

  els.toggleChart.addEventListener("click", ()=>{
    chartVisible = !chartVisible;
    uiPrefs.chartVisible = chartVisible;
    saveJson(UI_KEY, uiPrefs);
    els.chartWrap.style.display = chartVisible ? "block" : "none";
    els.toggleChart.textContent = chartVisible ? "Grafikon elrejt" : "Grafikon mutat";
    renderChart();
  });

  [els.showPulse, els.showZone, els.snapNearest, els.zoneSysLo, els.zoneSysHi, els.zoneDiaLo, els.zoneDiaHi].forEach(el=>{
    el.addEventListener("input", ()=>{
      chartPrefs = getChartPrefsFromUI();
      saveJson(PREF_KEY, chartPrefs);
      renderChart();
      markChangedAndMaybeSync();
    });
  });

  els.exportJsonBtn.addEventListener("click", exportJson);
  els.exportCsvAllBtn.addEventListener("click", ()=> exportCsv(entries, `vernyomasnaplo_${stamp()}_osszes.csv`));
  els.exportCsvFilteredBtn.addEventListener("click", ()=>{
    const filtered = getFiltered().filtered;
    exportCsv(filtered, `vernyomasnaplo_${stamp()}_szurt.csv`);
  });

  els.importFile.addEventListener("change", importJson);
  els.clearAll.addEventListener("click", clearAll);
  els.seedDemo.addEventListener("click", seedDemo);

  els.printBtn.addEventListener("click", async ()=>{
    await buildPrint();
    setTimeout(()=> window.print(), 50);
  });

  // modal openers
  els.syncSettingsBtn.addEventListener("click", ()=> openModal("enable"));
  els.syncNowBtn.addEventListener("click", ()=> openModal("sync"));

  // modal controls
  els.modalClose.addEventListener("click", closeModal);
  els.modalCancel.addEventListener("click", closeModal);
  els.modalOverlay.addEventListener("click", (e)=>{ if(e.target === els.modalOverlay) closeModal(); });
  els.modalSave.addEventListener("click", onModalSave);

  // redraw chart on resize
  window.addEventListener("resize", ()=>{
    if(chartVisible) renderChart();
  });
}

/* CRUD */
function onSave(e){
  e.preventDefault();

  const ts = els.dt.value ? new Date(els.dt.value).toISOString() : null;
  const sys = toInt(els.sys.value);
  const dia = toInt(els.dia.value);
  const pulse = els.pulse.value.trim() ? toInt(els.pulse.value) : null;

  if(!ts) return toast("Adj meg dátumot és időt.");
  if(!Number.isFinite(sys) || !Number.isFinite(dia)) return toast("SYS és DIA kötelező.");
  if(sys < 60 || sys > 260 || dia < 40 || dia > 160) return toast("Érték határon kívül.");
  if(sys <= dia) return toast("SYS általában nagyobb, mint DIA.");

  const item = {
    id: editingId ? editingId : randId(),
    ts,
    sys, dia,
    pulse: (pulse && Number.isFinite(pulse)) ? pulse : null,
    arm: els.arm.value,
    context: els.context.value,
    note: (els.note.value || "").trim()
  };

  if(editingId){
    const idx = entries.findIndex(x=>x.id===editingId);
    if(idx >= 0){
      entries[idx] = item;
      sortDesc(entries);
      saveEntries(entries);
      exitEdit();
      toast("Módosítva ✔");
      page = 1;
      renderAll();
      markChangedAndMaybeSync();
      return;
    }
  }

  entries.unshift(item);
  sortDesc(entries);
  saveEntries(entries);
  els.note.value = "";
  toast("Mentve ✔");
  page = 1;
  renderAll();
  markChangedAndMaybeSync();
}

function enterEdit(item){
  editingId = item.id;
  els.formTitle.textContent = "Bejegyzés szerkesztése";
  els.saveBtn.textContent = "Módosítás mentése";
  els.cancelEditBtn.style.display = "inline-flex";

  els.dt.value = toDatetimeLocal(item.ts);
  els.sys.value = item.sys;
  els.dia.value = item.dia;
  els.pulse.value = (item.pulse ?? "");
  els.arm.value = item.arm;
  els.context.value = item.context;
  els.note.value = item.note || "";

  window.scrollTo({ top: 0, behavior: "smooth" });
  els.sys.focus();
}

function exitEdit(){
  editingId = null;
  els.formTitle.textContent = "Új mérés rögzítése";
  els.saveBtn.textContent = "Mentés";
  els.cancelEditBtn.style.display = "none";

  els.sys.value = "";
  els.dia.value = "";
  els.pulse.value = "";
  els.note.value = "";
}

/* filtering + paging */
function getFiltered(){
  const total = entries.length;
  const q = (els.search.value || "").trim().toLowerCase();

  let days = null;
  if(els.range.value === "all") days = null;
  else if(els.range.value === "custom") days = clampInt(toInt(els.rangeCustomDays.value), 1, 3650);
  else days = toInt(els.range.value);

  const now = new Date();
  let filtered = entries.slice();

  if(days){
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    filtered = filtered.filter(e => new Date(e.ts) >= from);
  }
  if(q){
    filtered = filtered.filter(e => (e.note||"").toLowerCase().includes(q));
  }

  sortDesc(filtered);
  return { filtered, total };
}

function getPaged(filtered){
  const totalItems = filtered.length;
  const perPage = (pageSize === Infinity) ? (totalItems || 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  page = clampInt(page, 1, totalPages);

  if(pageSize === Infinity){
    return { items: filtered.slice(), totalItems, totalPages, page };
  }
  const start = (page - 1) * perPage;
  return { items: filtered.slice(start, start + perPage), totalItems, totalPages, page };
}

/* render */
function renderAll(){
  const { filtered, total } = getFiltered();

  els.countLabel.textContent = `${total} bejegyzés`;
  els.filteredLabel.textContent = filtered.length === total ? "Szűrés: nincs" : `Szűrés: ${filtered.length}/${total}`;

  renderStats(filtered);
  renderChart(filtered);
  renderList(filtered);
}

function renderStats(arr){
  if(!arr.length){
    els.avgSys.textContent = "–";
    els.avgDia.textContent = "–";
    els.avgPulse.textContent = "–";
    return;
  }
  const n = arr.length;
  const sSys = arr.reduce((a,b)=>a + b.sys, 0);
  const sDia = arr.reduce((a,b)=>a + b.dia, 0);
  const pulses = arr.map(x=>x.pulse).filter(v=>typeof v==="number" && Number.isFinite(v));
  const sPulse = pulses.reduce((a,b)=>a+b,0);

  els.avgSys.textContent = Math.round(sSys/n);
  els.avgDia.textContent = Math.round(sDia/n);
  els.avgPulse.textContent = pulses.length ? Math.round(sPulse/pulses.length) : "–";
}

function renderChart(filteredOverride=null){
  if(!chartVisible){
    els.tooltip.style.display = "none";
    return;
  }
  const filtered = filteredOverride ?? getFiltered().filtered;

  const zone = {
    sysLo: toInt(els.zoneSysLo.value),
    sysHi: toInt(els.zoneSysHi.value),
    diaLo: toInt(els.zoneDiaLo.value),
    diaHi: toInt(els.zoneDiaHi.value),
  };

  drawTrendChart(els.chart, els.tooltip, {
    data: filtered,
    showPulse: els.showPulse.checked,
    showZone: els.showZone.checked,
    snapNearest: els.snapNearest.checked,
    zone,
    axisLabels: { x:"Nap", y:"Érték (mmHg/BPM)" },
    hintTextSetter: (t)=> els.chartHint.textContent = t
  });
}

function renderList(filtered){
  const paged = getPaged(filtered);

  els.list.innerHTML = "";
  if(!paged.items.length){
    els.empty.style.display = "block";
    els.pager.style.display = "none";
    return;
  }
  els.empty.style.display = "none";

  // pager
  renderPager(paged.totalPages, paged.page);

  for(const e of paged.items){
    const risk = classify(e.sys, e.dia);
    const alert = isAlert(e.sys, e.dia);

    const item = document.createElement("div");
    item.className = "item";

    const left = document.createElement("div");
    left.className = "l";

    const row1 = document.createElement("div");
    row1.className = "row";
    row1.innerHTML = `
      <span class="badge">SYS ${e.sys} (${risk})</span>
      <span class="badge">DIA ${e.dia}</span>
      <span class="badge">${e.pulse ? "Pulzus "+e.pulse : "Pulzus –"}</span>
      <span class="tag">${escapeHtml(e.arm)} kar</span>
      <span class="tag">${escapeHtml(e.context)}</span>
      ${alert ? `<span class="alertTag">⚠ Riasztás</span>` : ``}
    `;
    const row2 = document.createElement("div");
    row2.className = "row";
    row2.innerHTML = `<span class="mini">${escapeHtml(formatHu(e.ts))}</span>`;

    left.append(row1, row2);
    if(e.note){
      const n = document.createElement("div");
      n.className = "note";
      n.textContent = e.note;
      left.appendChild(n);
    }

    const right = document.createElement("div");
    right.className = "r";
    const edit = document.createElement("button");
    edit.className = "iconbtn";
    edit.type = "button";
    edit.textContent = "Szerkesztés";
    edit.onclick = ()=> enterEdit(e);

    const del = document.createElement("button");
    del.className = "iconbtn d";
    del.type = "button";
    del.textContent = "Törlés";
    del.onclick = ()=>{
      if(!confirm("Törlöd ezt a bejegyzést?")) return;
      entries = entries.filter(x=>x.id!==e.id);
      saveEntries(entries);
      if(editingId === e.id) exitEdit();
      toast("Törölve.");
      const { filtered } = getFiltered();
      const meta = getPaged(filtered);
      page = meta.page;
      renderAll();
      markChangedAndMaybeSync();
    };

    right.append(edit, del);
    item.append(left, right);
    els.list.appendChild(item);
  }
}

function renderPager(totalPages, current){
  if(totalPages <= 1){
    els.pager.style.display = "none";
    els.pager.innerHTML = "";
    return;
  }
  els.pager.style.display = "flex";
  els.pager.innerHTML = "";

  const mkBtn = (label, target, disabled=false, active=false)=>{
    const b = document.createElement("button");
    b.type="button";
    b.className = "pbtn" + (active ? " active":"");
    b.textContent = label;
    b.disabled = disabled;
    b.onclick = ()=>{
      page = target;
      renderAll();
    };
    return b;
  };

  els.pager.appendChild(mkBtn("⏮", 1, current===1));
  els.pager.appendChild(mkBtn("◀", Math.max(1,current-1), current===1));

  const windowPages = pageWindow(current, totalPages, 5);
  if(windowPages[0] > 1){
    els.pager.appendChild(mkBtn("1", 1, false, current===1));
    if(windowPages[0] > 2){
      const d = document.createElement("span");
      d.className = "dots";
      d.textContent = "…";
      els.pager.appendChild(d);
    }
  }
  for(const p of windowPages){
    els.pager.appendChild(mkBtn(String(p), p, false, p===current));
  }
  if(windowPages[windowPages.length-1] < totalPages){
    if(windowPages[windowPages.length-1] < totalPages-1){
      const d = document.createElement("span");
      d.className = "dots";
      d.textContent = "…";
      els.pager.appendChild(d);
    }
    els.pager.appendChild(mkBtn(String(totalPages), totalPages, false, current===totalPages));
  }

  els.pager.appendChild(mkBtn("▶", Math.min(totalPages,current+1), current===totalPages));
  els.pager.appendChild(mkBtn("⏭", totalPages, current===totalPages));
}

/* print */
async function buildPrint(){
  const { filtered } = getFiltered();
  const title = "Vérnyomásnapló – export";
  const rangeLabel = getRangeLabel();
  const q = (els.search.value||"").trim();

  const chartUrl = buildPrintChartDataUrl(filtered, {
    showPulse: els.showPulse.checked,
    showZone: els.showZone.checked,
    zone: {
      sysLo: toInt(els.zoneSysLo.value),
      sysHi: toInt(els.zoneSysHi.value),
      diaLo: toInt(els.zoneDiaLo.value),
      diaHi: toInt(els.zoneDiaHi.value),
    },
    axisLabels: { x:"Nap", y:"Érték (mmHg/BPM)" },
    title: "Vérnyomás trend grafikon",
    subtitle: `${rangeLabel}${q ? " • Keresés: "+q : ""}`
  });

  const summary = computeSummary(filtered);
  const now = new Date().toISOString();

  const rows = filtered
    .slice().sort((a,b)=> new Date(a.ts)-new Date(b.ts))
    .map(e=>`
      <tr>
        <td>${escapeHtml(formatHu(e.ts))}</td>
        <td>${escapeHtml(e.context)}</td>
        <td>${escapeHtml(e.arm)}</td>
        <td><b>${escapeHtml(e.sys)}</b></td>
        <td><b>${escapeHtml(e.dia)}</b></td>
        <td>${escapeHtml(e.pulse ?? "")}</td>
        <td>${isAlert(e.sys,e.dia) ? "⚠ " : ""}${escapeHtml(e.note||"")}</td>
      </tr>
    `).join("");

  els.printArea.innerHTML = `
    <div class="printDoc">
      <div class="printHead">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <div style="font-size:12px;color:#222;margin-top:4px;">
            Szűrés: <b>${escapeHtml(rangeLabel)}</b>${q ? ` • Keresés: <b>${escapeHtml(q)}</b>` : ""} • Tételek: <b>${filtered.length}</b>
          </div>
        </div>
        <div class="printMeta">Generálva: <b>${escapeHtml(formatHu(now))}</b></div>
      </div>

      <div class="printStats">
        <div class="pBox"><div style="color:#555">Átlag SYS</div><b>${summary.avgSys ?? "–"}</b> mmHg</div>
        <div class="pBox"><div style="color:#555">Átlag DIA</div><b>${summary.avgDia ?? "–"}</b> mmHg</div>
        <div class="pBox"><div style="color:#555">Átlag pulzus</div><b>${summary.avgPulse ?? "–"}</b> BPM</div>
        <div class="pBox"><div style="color:#555">Időszak</div><b>${escapeHtml(summary.period ?? "–")}</b></div>
      </div>

      <div class="printChartBox">
        ${chartUrl ? `<img src="${chartUrl}" alt="Grafikon">` : `<div style="color:#555">Nincs elég adat a grafikonhoz.</div>`}
      </div>

      <table class="printTable">
        <thead>
          <tr>
            <th>Dátum/idő</th><th>Helyzet</th><th>Kar</th><th>SYS</th><th>DIA</th><th>Pulzus</th><th>Megjegyzés</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="7">Nincs adat.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function getRangeLabel(){
  if(els.range.value === "all") return "Összes";
  if(els.range.value === "custom") return `Utolsó ${clampInt(toInt(els.rangeCustomDays.value),1,3650)} nap (egyéni)`;
  return `Utolsó ${toInt(els.range.value)} nap`;
}

function computeSummary(arr){
  if(!arr.length) return { avgSys:null, avgDia:null, avgPulse:null, period:null };
  const n = arr.length;
  const sSys = arr.reduce((a,b)=>a+b.sys,0);
  const sDia = arr.reduce((a,b)=>a+b.dia,0);
  const pulses = arr.map(x=>x.pulse).filter(v=>typeof v==="number" && Number.isFinite(v));
  const sPulse = pulses.reduce((a,b)=>a+b,0);
  const sorted = arr.slice().sort((a,b)=> new Date(a.ts)-new Date(b.ts));
  return {
    avgSys: Math.round(sSys/n),
    avgDia: Math.round(sDia/n),
    avgPulse: pulses.length ? Math.round(sPulse/pulses.length) : null,
    period: `${formatShort(sorted[0].ts)} – ${formatShort(sorted[sorted.length-1].ts)}`
  };
}

/* export/import */
function exportJson(){
  const obj = buildExportObject();
  downloadBlob(JSON.stringify(obj,null,2), `vernyomasnaplo_export_${stamp()}.json`, "application/json");
  toast("JSON export ✔");
}
function buildExportObject(){
  return {
    exportedAt: new Date().toISOString(),
    version: 20,
    entries,
    chartPrefs: getChartPrefsFromUI(),
    uiPrefs,
    localRevision
  };
}
function importJson(e){
  const file = e.target.files?.[0];
  if(!file) return;
  file.text().then(text=>{
    const json = JSON.parse(text);
    const incoming = Array.isArray(json) ? json : (json.entries || []);
    if(!Array.isArray(incoming)) throw new Error("Hibás formátum.");
    const cleaned = incoming.map(normalizeEntry).filter(Boolean);
    if(!cleaned.length) return toast("Nincs importálható bejegyzés.");

    const map = new Map(entries.map(x=>[x.id,x]));
    cleaned.forEach(x=>map.set(x.id,x));
    entries = Array.from(map.values());
    sortDesc(entries);
    saveEntries(entries);

    if(json.chartPrefs){
      chartPrefs = { ...chartPrefs, ...json.chartPrefs };
      saveJson(PREF_KEY, chartPrefs);
      applyChartPrefsToUI(chartPrefs);
    }
    if(json.uiPrefs){
      uiPrefs = { ...uiPrefs, ...json.uiPrefs };
      saveJson(UI_KEY, uiPrefs);
    }

    toast(`Import kész: ${cleaned.length} db ✔`);
    page = 1;
    renderAll();
    markChangedAndMaybeSync();
  }).catch(()=>{
    toast("Import hiba.", 5000);
  }).finally(()=>{
    els.importFile.value = "";
  });
}
function exportCsv(arr, filename){
  const csv = buildCsv(arr);
  downloadBlob(csv, filename, "text/csv;charset=utf-8");
  toast("CSV export ✔");
}
function buildCsv(arr){
  const BOM = "\uFEFF";
  const header = ["DatumIdo","SYS","DIA","Pulzus","Kar","Helyzet","Riasztas","Megjegyzes"];
  const rows = arr.slice().sort((a,b)=> new Date(a.ts)-new Date(b.ts)).map(e => ([
    formatHu(e.ts),
    e.sys, e.dia,
    (e.pulse ?? ""),
    e.arm,
    e.context,
    isAlert(e.sys,e.dia) ? "Igen" : "Nem",
    (e.note || "")
  ].map(csvEscape).join(",")));
  return BOM + header.join(",") + "\n" + rows.join("\n");
}
function csvEscape(v){
  const s = String(v ?? "");
  if(/[",\n\r]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function downloadBlob(text, filename, mime){
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function clearAll(){
  if(!confirm("Biztosan törlöd az összes bejegyzést?")) return;
  entries = [];
  saveEntries(entries);
  exitEdit();
  page = 1;
  renderAll();
  markChangedAndMaybeSync();
  toast("Minden törölve.");
}
function seedDemo(){
  if(entries.length && !confirm("Már vannak adataid. Hozzáadjam a demo adatokat?")) return;

  const now = new Date();
  const demo = [];
  for(let i=0;i<22;i++){
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(7 + (i%3)*2, 15, 0, 0);
    const baseSys = 116 + (i%6)*4;
    const baseDia = 74 + (i%5)*3;
    demo.push({
      id: randId(),
      ts: d.toISOString(),
      sys: baseSys + (i%2?2:-1),
      dia: baseDia + (i%2?1:0),
      pulse: 62 + (i%7)*3,
      note: i%3===0 ? "Reggel" : (i%4===0 ? "Kávé után" : ""),
      arm: i%2 ? "Bal" : "Jobb",
      context: i%5===0 ? "Terhelés után" : "Ülve"
    });
  }
  entries = [...demo, ...entries];
  sortDesc(entries);
  saveEntries(entries);
  page = 1;
  renderAll();
  markChangedAndMaybeSync();
  toast("Demo adatok ✔");
}

/* Sync modal + logic */
function openModal(mode){
  if(!sb){
    toast("Supabase nem elérhető (SDK betöltés hiba).", 5000);
    return;
  }
  if(!crypto?.subtle){
    toast("Felhő szinkronhoz HTTPS/WebCrypto kell.", 5000);
    return;
  }

  els.mMode.value = mode;
  els.mLogId.value = syncCfg.logId || "";
  els.mPin.value = "";
  els.mPinHint.value = syncCfg.pinHint || "";

  els.modalOverlay.style.display = "flex";
  els.modalOverlay.setAttribute("aria-hidden","false");
  els.mLogId.focus();
}
function closeModal(){
  els.modalOverlay.style.display = "none";
  els.modalOverlay.setAttribute("aria-hidden","true");
  els.mPin.value = "";
}
async function onModalSave(){
  try{
    const mode = els.mMode.value;
    const logId = (els.mLogId.value || "").trim();
    const pin = (els.mPin.value || "").trim();
    const hint = (els.mPinHint.value || "").trim();

    if(mode === "disable"){
      syncCfg = { ...syncCfg, enabled:false, logId:"", pinHint:"" };
      saveJson(SYNC_KEY, syncCfg);
      updateSyncUI();
      closeModal();
      toast("Felhő szinkron kikapcsolva.");
      return;
    }

    if(!logId) return toast("Add meg a Napló azonosítót (logId).", 4000);
    if(!pin) return toast("Add meg a PIN/Jelszót.", 4000);

    syncCfg = { ...syncCfg, enabled:true, logId, pinHint:hint };
    saveJson(SYNC_KEY, syncCfg);
    updateSyncUI();

    if(mode === "enable" || mode === "sync"){
      await syncNow(pin);
      closeModal();
      return;
    }
  }catch(err){
    console.error(err);
    toast("Felhő művelet hiba. Nézd a Console-t.", 6000);
  }
}
async function syncNow(pin){
  if(!sb || !syncCfg.enabled || !syncCfg.logId) return;

  syncBusy = true; updateSyncUI();

  try{
    // pull
    const pulled = await cloudPull(sb, syncCfg.logId, pin);
    syncCfg.lastPullAt = new Date().toISOString();
    if(pulled.exists && pulled.obj){
      const remoteRev = Number(pulled.obj.localRevision || 0);
      const remoteNewer = remoteRev > (localRevision || 0);

      if(remoteNewer){
        if(Array.isArray(pulled.obj.entries)){
          entries = pulled.obj.entries.map(normalizeEntry).filter(Boolean);
          sortDesc(entries);
          saveEntries(entries);
        }
        if(pulled.obj.chartPrefs){
          chartPrefs = { ...chartPrefs, ...pulled.obj.chartPrefs };
          saveJson(PREF_KEY, chartPrefs);
          applyChartPrefsToUI(chartPrefs);
        }
        if(pulled.obj.uiPrefs){
          uiPrefs = { ...uiPrefs, ...pulled.obj.uiPrefs };
          saveJson(UI_KEY, uiPrefs);
        }
        localRevision = remoteRev || Date.now();
        toast("Felhőből frissítve ✔");
        page = 1;
        renderAll();
      }
      syncCfg.lastRemoteAt = pulled.updated_at;
    }

    // push
    const obj = buildExportObject();
    const pushed = await cloudPush(sb, syncCfg.logId, pin, obj);
    syncCfg.lastPushAt = pushed.updated_at;
    syncCfg.lastRemoteAt = pushed.updated_at;
    saveJson(SYNC_KEY, syncCfg);
    toast("Felhő szinkron kész ✔");
  } finally {
    syncBusy = false; updateSyncUI();
  }
}

function markChangedAndMaybeSync(){
  localRevision = Date.now();
  if(syncCfg.enabled && syncCfg.logId && sb){
    // debounced push (csak push, pull nélkül)
    clearTimeout(markChangedAndMaybeSync._t);
    markChangedAndMaybeSync._t = setTimeout(async ()=>{
      try{
        const pinHint = syncCfg.pinHint ? ` (PIN: ${syncCfg.pinHint})` : "";
        // PIN-t nem tudjuk automatikusan (biztonság), ezért nem tolunk PIN nélkül.
        // Ez szándékos: automata pushhoz kéne “remember PIN”, amit nem ajánlok.
        // Itt csak UI jelzés:
        toast("Változás mentve. Szinkronhoz nyomj: Szinkron most" + pinHint, 3500);
      }catch{}
    }, 600);
  }
}

function updateSyncUI(){
  if(!sb){
    els.syncText.textContent = "Felhő szinkron: Supabase nem töltött be";
    els.syncDot.className = "syncDot bad";
    els.syncMeta.textContent = "—";
    return;
  }
  if(!syncCfg.enabled || !syncCfg.logId){
    els.syncText.textContent = "Felhő szinkron: kikapcsolva";
    els.syncDot.className = "syncDot";
    els.syncMeta.textContent = "—";
    return;
  }
  if(!crypto?.subtle){
    els.syncText.textContent = "Felhő szinkron: HTTPS szükséges";
    els.syncDot.className = "syncDot bad";
    els.syncMeta.textContent = "WebCrypto nem elérhető.";
    return;
  }
  els.syncText.textContent = syncBusy ? "Felhő szinkron: folyamatban…" : "Felhő szinkron: aktív";
  els.syncDot.className = syncBusy ? "syncDot mid" : "syncDot ok";

  const pull = syncCfg.lastPullAt ? formatHu(syncCfg.lastPullAt) : "—";
  const push = syncCfg.lastPushAt ? formatHu(syncCfg.lastPushAt) : "—";
  els.syncMeta.textContent = `Letöltés: ${pull} • Feltöltés: ${push}`;
}

/* helpers */
function getChartPrefsFromUI(){
  return {
    showPulse: !!els.showPulse.checked,
    showZone: !!els.showZone.checked,
    snapNearest: !!els.snapNearest.checked,
    zoneSysLo: toInt(els.zoneSysLo.value),
    zoneSysHi: toInt(els.zoneSysHi.value),
    zoneDiaLo: toInt(els.zoneDiaLo.value),
    zoneDiaHi: toInt(els.zoneDiaHi.value)
  };
}
function applyChartPrefsToUI(p){
  els.showPulse.checked = !!p.showPulse;
  els.showZone.checked = !!p.showZone;
  els.snapNearest.checked = !!p.snapNearest;
  els.zoneSysLo.value = p.zoneSysLo;
  els.zoneSysHi.value = p.zoneSysHi;
  els.zoneDiaLo.value = p.zoneDiaLo;
  els.zoneDiaHi.value = p.zoneDiaHi;
}

function syncRangeCustomUI(){
  els.rangeCustomWrap.style.display = (els.range.value === "custom") ? "inline-flex" : "none";
}

function loadEntries(){
  const arr = loadJson(STORAGE_KEY, []);
  const clean = Array.isArray(arr) ? arr.map(normalizeEntry).filter(Boolean) : [];
  sortDesc(clean);
  return clean;
}
function saveEntries(arr){ localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }

function normalizeEntry(e){
  try{
    if(!e) return null;
    const id = String(e.id || randId());
    const ts = new Date(e.ts || e.date || Date.now()).toISOString();
    const sys = toInt(e.sys);
    const dia = toInt(e.dia);
    const pulse = (e.pulse===null || e.pulse===undefined || e.pulse==="") ? null : toInt(e.pulse);
    if(!Number.isFinite(sys) || !Number.isFinite(dia)) return null;
    return {
      id, ts,
      sys, dia,
      pulse: (pulse && Number.isFinite(pulse)) ? pulse : null,
      note: String(e.note || "").trim(),
      arm: (e.arm==="Jobb"||e.arm==="Bal") ? e.arm : "Bal",
      context: String(e.context || "Ülve")
    };
  }catch{ return null; }
}

function loadJson(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return fallback;
    return JSON.parse(raw);
  }catch{ return fallback; }
}
function saveJson(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
}

function toInt(v){ const n=parseInt(String(v).trim(),10); return Number.isFinite(n)?n:NaN; }
function clampInt(v, lo, hi){ const n=parseInt(v,10); if(!Number.isFinite(n)) return lo; return Math.max(lo, Math.min(hi, n)); }
function randId(){
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return "bp_" + a[0].toString(16).padStart(8,"0") + a[1].toString(16).padStart(8,"0");
}
function sortDesc(arr){ arr.sort((a,b)=> new Date(b.ts)-new Date(a.ts)); }
function isAlert(sys, dia){ return sys>=140 || dia>=90; }
function classify(sys, dia){
  if(sys < 130 && dia < 85) return "OK";
  if(sys < 140 && dia < 90) return "Emelkedett";
  return "Magas";
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function pad(n){ return String(n).padStart(2,"0"); }
function formatHu(iso){
  const d=new Date(iso);
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatShort(iso){
  const d=new Date(iso);
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())}`;
}
function toDatetimeLocal(iso){
  const d=new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function setNow(){
  const d=new Date();
  els.dt.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function setPreset(h,m){
  const base = els.dt.value ? new Date(els.dt.value) : new Date();
  base.setHours(h,m,0,0);
  els.dt.value = toDatetimeLocal(base.toISOString());
}
function stamp(){ return new Date().toISOString().slice(0,10); }

function pageWindow(current, total, size){
  const w = Math.max(3, size|0);
  let start = current - Math.floor(w/2);
  let end = start + w - 1;
  if(start < 1){ end += (1-start); start = 1; }
  if(end > total){ start -= (end-total); end = total; }
  start = Math.max(1, start);
  const out=[];
  for(let p=start;p<=end;p++) out.push(p);
  return out;
}
