// js/chart.js
export function drawTrendChart(canvas, tooltipEl, opts){
  const {
    data,                 // [{ts, sys, dia, pulse?}]
    showPulse,
    showZone,
    snapNearest,
    zone,
    hintTextSetter,
    axisLabels = { x:"Nap", y:"Érték (mmHg/BPM)" }
  } = opts;

  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const cssW = Math.max(320, Math.round(rect.width));
  const cssH = Math.max(240, Math.round(rect.height));
  const W = Math.round(cssW * dpr);
  const H = Math.round(cssH * dpr);

  if(canvas.width !== W || canvas.height !== H){
    canvas.width = W;
    canvas.height = H;
  }

  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);

  // background
  ctx.fillStyle = "rgba(0,0,0,.10)";
  ctx.fillRect(0,0,W,H);

  const pad = { l: Math.round(62*dpr), r: Math.round(18*dpr), t: Math.round(18*dpr), b: Math.round(46*dpr) };
  const plot = { x: pad.l, y: pad.t, w: W - pad.l - pad.r, h: H - pad.t - pad.b };

  if(!data || !data.length){
    if(hintTextSetter) hintTextSetter("Nincs adat a grafikonhoz");
    ctx.fillStyle = "rgba(255,255,255,.65)";
    ctx.font = `${Math.round(14*dpr)}px Arial`;
    ctx.textAlign = "center";
    ctx.fillText("Nincs adat a grafikonhoz.", W/2, H/2);
    return { plot:null, points:[] };
  }

  const points = data.slice().sort((a,b)=> new Date(a.ts) - new Date(b.ts));
  if(hintTextSetter) hintTextSetter(`Megjelenített pontok: ${points.length}`);

  const vals = [];
  points.forEach(p=>{
    vals.push(p.sys, p.dia);
    if(showPulse && typeof p.pulse==="number" && Number.isFinite(p.pulse)) vals.push(p.pulse);
  });

  let yMin = Math.min(...vals);
  let yMax = Math.max(...vals);
  if(!Number.isFinite(yMin) || !Number.isFinite(yMax)){ yMin=0; yMax=1; }

  const nice = niceBounds(yMin, yMax, 6);
  yMin = nice.min; yMax = nice.max; const yStep = nice.step;

  const xMax = Math.max(1, points.length - 1);
  const xToPx = (i)=> plot.x + (i/xMax)*plot.w;
  const yToPx = (y)=> plot.y + (yMax - y)/(yMax - yMin)*plot.h;

  // grid
  ctx.strokeStyle = "rgba(255,255,255,.10)";
  ctx.lineWidth = Math.max(1, 1*dpr);
  ctx.beginPath();
  for(let y=yMin; y<=yMax+0.0001; y+=yStep){
    const py = yToPx(y);
    ctx.moveTo(plot.x, py);
    ctx.lineTo(plot.x+plot.w, py);
  }
  const xTicks = chooseXTicks(points.length, 8);
  xTicks.forEach(i=>{
    const px = xToPx(i);
    ctx.moveTo(px, plot.y);
    ctx.lineTo(px, plot.y+plot.h);
  });
  ctx.stroke();

  // zone
  if(showZone){
    const zSysLo = clamp(zone.sysLo, 60, 260);
    const zSysHi = clamp(zone.sysHi, 60, 260);
    const zDiaLo = clamp(zone.diaLo, 40, 160);
    const zDiaHi = clamp(zone.diaHi, 40, 160);

    ctx.fillStyle = "rgba(255,204,102,.30)";

    const sysTop = yToPx(Math.max(zSysLo,zSysHi));
    const sysBot = yToPx(Math.min(zSysLo,zSysHi));
    ctx.fillRect(plot.x, sysTop, plot.w, sysBot - sysTop);

    const diaTop = yToPx(Math.max(zDiaLo,zDiaHi));
    const diaBot = yToPx(Math.min(zDiaLo,zDiaHi));
    ctx.fillRect(plot.x, diaTop, plot.w, diaBot - diaTop);
  }

  // axes
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.lineWidth = Math.max(1.2, 1.2*dpr);
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y+plot.h);
  ctx.moveTo(plot.x, plot.y+plot.h);
  ctx.lineTo(plot.x+plot.w, plot.y+plot.h);
  ctx.stroke();

  // y labels
  ctx.fillStyle = "rgba(255,255,255,.65)";
  ctx.font = `${Math.round(12*dpr)}px Arial`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for(let y=yMin; y<=yMax+0.0001; y+=yStep){
    ctx.fillText(String(Math.round(y)), plot.x - Math.round(10*dpr), yToPx(y));
  }

  // x labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  xTicks.forEach(i=>{
    ctx.fillText(formatDayShort(points[i].ts), xToPx(i), plot.y+plot.h + Math.round(8*dpr));
  });

  // axis titles
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `${Math.round(11*dpr)}px Arial`;
  ctx.fillText(axisLabels.y, plot.x, Math.round(2*dpr));
  ctx.textAlign = "right";
  ctx.fillText(axisLabels.x, plot.x+plot.w, plot.y+plot.h + Math.round(30*dpr));

  // series
  drawSeries(ctx, points, p=>p.sys, xToPx, yToPx, dpr, "rgba(110,231,255,.95)");
  drawSeries(ctx, points, p=>p.dia, xToPx, yToPx, dpr, "rgba(167,139,250,.95)");
  if(showPulse){
    drawSeries(ctx, points, p=> (typeof p.pulse==="number" && Number.isFinite(p.pulse)) ? p.pulse : null, xToPx, yToPx, dpr, "rgba(62,230,160,.95)");
  }

  // tooltip
  const state = { plot, dpr, points, xToPx, yToPx };
  attachTooltip(canvas, tooltipEl, state, { snapNearest });

  return state;
}

export function buildPrintChartDataUrl(filtered, chartConfig){
  // chartConfig: { showPulse, showZone, zone, axisLabels, title, subtitle }
  if(!filtered || !filtered.length) return null;

  const points = filtered.slice().sort((a,b)=> new Date(a.ts)-new Date(b.ts));

  // chart canvas
  const chartOnly = document.createElement("canvas");
  chartOnly.width = 1400;
  chartOnly.height = 560;
  const ctx = chartOnly.getContext("2d");
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,chartOnly.width,chartOnly.height);

  const pad = { l: 80, r: 20, t: 20, b: 60 };
  const plot = { x: pad.l, y: pad.t, w: chartOnly.width-pad.l-pad.r, h: chartOnly.height-pad.t-pad.b };

  const vals = [];
  points.forEach(p=>{
    vals.push(p.sys, p.dia);
    if(chartConfig.showPulse && typeof p.pulse==="number" && Number.isFinite(p.pulse)) vals.push(p.pulse);
  });

  let yMin = Math.min(...vals), yMax = Math.max(...vals);
  if(!Number.isFinite(yMin)||!Number.isFinite(yMax)){ yMin=0;yMax=1; }
  const nice = niceBounds(yMin,yMax,6);
  yMin=nice.min; yMax=nice.max; const yStep=nice.step;

  const xMax = Math.max(1, points.length-1);
  const xToPx = (i)=> plot.x + (i/xMax)*plot.w;
  const yToPx = (y)=> plot.y + (yMax-y)/(yMax-yMin)*plot.h;

  // grid
  ctx.strokeStyle = "rgba(0,0,0,.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for(let y=yMin; y<=yMax+0.0001; y+=yStep){
    const py=yToPx(y);
    ctx.moveTo(plot.x,py); ctx.lineTo(plot.x+plot.w,py);
  }
  const xTicks = chooseXTicks(points.length, 8);
  xTicks.forEach(i=>{
    const px=xToPx(i);
    ctx.moveTo(px,plot.y); ctx.lineTo(px,plot.y+plot.h);
  });
  ctx.stroke();

  // zone
  if(chartConfig.showZone){
    const z = chartConfig.zone;
    ctx.fillStyle = "rgba(255,204,102,.30)";
    const sysTop = yToPx(Math.max(z.sysLo,z.sysHi));
    const sysBot = yToPx(Math.min(z.sysLo,z.sysHi));
    ctx.fillRect(plot.x, sysTop, plot.w, sysBot-sysTop);

    const diaTop = yToPx(Math.max(z.diaLo,z.diaHi));
    const diaBot = yToPx(Math.min(z.diaLo,z.diaHi));
    ctx.fillRect(plot.x, diaTop, plot.w, diaBot-diaTop);
  }

  // axes
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(plot.x,plot.y); ctx.lineTo(plot.x,plot.y+plot.h);
  ctx.moveTo(plot.x,plot.y+plot.h); ctx.lineTo(plot.x+plot.w,plot.y+plot.h);
  ctx.stroke();

  // y labels
  ctx.fillStyle = "rgba(0,0,0,.60)";
  ctx.font = "12px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for(let y=yMin; y<=yMax+0.0001; y+=yStep){
    ctx.fillText(String(Math.round(y)), plot.x-10, yToPx(y));
  }

  // x labels
  ctx.textAlign="center";
  ctx.textBaseline="top";
  xTicks.forEach(i=>{
    ctx.fillText(formatDayShort(points[i].ts), xToPx(i), plot.y+plot.h+10);
  });

  // axis titles
  ctx.font="11px Arial";
  ctx.textAlign="left";
  ctx.textBaseline="top";
  ctx.fillText(chartConfig.axisLabels?.y || "Érték (mmHg/BPM)", plot.x, 2);
  ctx.textAlign="right";
  ctx.fillText(chartConfig.axisLabels?.x || "Nap", plot.x+plot.w, plot.y+plot.h+34);

  // series
  drawSeriesPrint(ctx, points, p=>p.sys, xToPx, yToPx, "rgba(110,231,255,.95)");
  drawSeriesPrint(ctx, points, p=>p.dia, xToPx, yToPx, "rgba(167,139,250,.95)");
  if(chartConfig.showPulse){
    drawSeriesPrint(ctx, points, p=> (typeof p.pulse==="number" && Number.isFinite(p.pulse)) ? p.pulse : null, xToPx, yToPx, "rgba(62,230,160,.95)");
  }

  // Compose final (title + subtitle + chart + legend)
  const out = document.createElement("canvas");
  out.width = 1400;
  out.height = 900;
  const o = out.getContext("2d");
  o.fillStyle="#fff"; o.fillRect(0,0,out.width,out.height);
  o.strokeStyle="#bbb"; o.lineWidth=2;
  o.strokeRect(12,12,out.width-24,out.height-24);

  o.fillStyle="#000";
  o.textAlign="center";
  o.font="bold 28px Arial";
  o.fillText(chartConfig.title || "Vérnyomás trend grafikon", out.width/2, 44);

  o.font="16px Arial";
  o.fillText(chartConfig.subtitle || "", out.width/2, 72);

  o.drawImage(chartOnly, 0, 110);

  // legend
  const legendTop = 110 + 560 + 30;
  o.textAlign="left";
  o.font="bold 16px Arial";
  o.fillText("Színmagyarázat:", 240, legendTop);

  const items = [
    {label:"SYS (mmHg)", color:"rgba(110,231,255,.95)", border:"#666"},
    {label:"DIA (mmHg)", color:"rgba(167,139,250,.95)", border:"#666"},
    {label:"Pulzus (BPM)", color:"rgba(62,230,160,.95)", border:"#666"},
    {label:"Célzóna", color:"rgba(255,204,102,.45)", border:"rgba(255,204,102,.85)"}
  ];
  o.font="14px Arial";
  let x=240, y=legendTop+26;
  for(const it of items){
    o.fillStyle=it.color; o.fillRect(x, y-8, 18, 18);
    o.strokeStyle=it.border; o.lineWidth=1; o.strokeRect(x, y-8, 18, 18);
    o.fillStyle="#111"; o.fillText(it.label, x+26, y+1);
    x += 240;
    if(x > 1180){ x=240; y += 26; }
  }

  try{ return out.toDataURL("image/png"); }catch{ return null; }
}

/* internals */
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, Number(v)||lo)); }

function niceStep(raw){
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const frac = raw / pow;
  let niceFrac;
  if(frac <= 1) niceFrac = 1;
  else if(frac <= 2) niceFrac = 2;
  else if(frac <= 5) niceFrac = 5;
  else niceFrac = 10;
  return niceFrac * pow;
}
function niceBounds(min, max, ticks){
  if(min === max){ min -= 1; max += 1; }
  const span = max - min;
  const rawStep = span / Math.max(2, ticks);
  const step = niceStep(rawStep);
  const niceMin = Math.floor(min/step) * step;
  const niceMax = Math.ceil(max/step) * step;
  return { min: niceMin, max: niceMax, step };
}
function chooseXTicks(n, maxTicks){
  if(n <= 1) return [0];
  const ticks = Math.min(maxTicks, n);
  const step = Math.max(1, Math.round((n-1)/(ticks-1)));
  const out = [];
  for(let i=0; i<n; i+=step) out.push(i);
  if(out[out.length-1] !== n-1) out.push(n-1);
  return out;
}
function formatDayShort(iso){
  const d = new Date(iso);
  const pad=(n)=>String(n).padStart(2,"0");
  return `${pad(d.getMonth()+1)}.${pad(d.getDate())}`;
}

function drawSeries(ctx, points, getY, xToPx, yToPx, dpr, color){
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, 2*dpr);
  ctx.beginPath();
  let started=false;
  points.forEach((p,i)=>{
    const y=getY(p);
    if(y===null || !Number.isFinite(y)){ started=false; return; }
    const px=xToPx(i), py=yToPx(y);
    if(!started){ ctx.moveTo(px,py); started=true; } else ctx.lineTo(px,py);
  });
  ctx.stroke();

  ctx.fillStyle = color;
  points.forEach((p,i)=>{
    const y=getY(p);
    if(y===null || !Number.isFinite(y)) return;
    const px=xToPx(i), py=yToPx(y);
    ctx.beginPath();
    ctx.arc(px, py, Math.max(3, 3*dpr), 0, Math.PI*2);
    ctx.fill();
  });
}
function drawSeriesPrint(ctx, points, getY, xToPx, yToPx, color){
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started=false;
  points.forEach((p,i)=>{
    const y=getY(p);
    if(y===null || !Number.isFinite(y)){ started=false; return; }
    const px=xToPx(i), py=yToPx(y);
    if(!started){ ctx.moveTo(px,py); started=true; } else ctx.lineTo(px,py);
  });
  ctx.stroke();

  ctx.fillStyle = color;
  points.forEach((p,i)=>{
    const y=getY(p);
    if(y===null || !Number.isFinite(y)) return;
    const px=xToPx(i), py=yToPx(y);
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI*2);
    ctx.fill();
  });
}

function attachTooltip(canvas, tooltipEl, state, { snapNearest }){
  function hide(){ tooltipEl.style.display="none"; }
  function show(html, x, y){
    tooltipEl.innerHTML = html;
    tooltipEl.style.display="block";
    const pad = 10;
    const rect = canvas.getBoundingClientRect();
    const maxX = rect.width - tooltipEl.offsetWidth - pad;
    const maxY = rect.height - tooltipEl.offsetHeight - pad;
    tooltipEl.style.left = Math.max(pad, Math.min(maxX, x + 12)) + "px";
    tooltipEl.style.top  = Math.max(pad, Math.min(maxY, y + 12)) + "px";
  }

  canvas.onmouseleave = hide;
  canvas.onmousemove = (ev)=>{
    if(!state.plot) return hide();
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;

    const dpr = state.dpr;
    const px = x * dpr;
    const py = y * dpr;

    // find nearest point by x
    let best = { i:-1, dist:Infinity };
    state.points.forEach((p,i)=>{
      const dx = Math.abs(state.xToPx(i) - px);
      if(dx < best.dist){ best={i, dist:dx}; }
    });
    if(best.i < 0) return hide();

    const i = best.i;
    const p = state.points[i];
    const pX = state.xToPx(i);
    const nearEnough = best.dist <= 18*dpr;

    if(snapNearest && !nearEnough) return hide();

    const html =
      `<b>${formatDayShort(p.ts)}</b><br>` +
      `SYS: <b>${p.sys}</b><br>` +
      `DIA: <b>${p.dia}</b>` +
      (Number.isFinite(p.pulse) ? `<br>Pulzus: <b>${p.pulse}</b>` : "");
    show(html, x, y);
  };
}
