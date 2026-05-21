import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "previews");
const SVG_PATH = path.join(OUT_DIR, "meridian-pnl-calendar.svg");
const HTML_PATH = path.join(OUT_DIR, "meridian-dashboard.html");
const LEGACY_HTML_PATH = path.join(OUT_DIR, "meridian-pnl-calendar.html");

const FILES = ["paper-trading.json", "decision-log.json", "state.json", "pool-memory.json", "strategy-library.json", "lessons.json", "user-config.json"];
const SECRET_KEYS = new Set(["rpcUrl", "walletKey", "llmApiKey", "telegramBotToken", "telegramChatId", "whatsappChatId", "hiveMindApiKey", "publicApiKey"]);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")); }
  catch { return fallback; }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

function ymd(date) { return date.toISOString().slice(0, 10); }

function sourceData() {
  return Object.fromEntries(FILES.map((file) => [file, readJson(file, file.endsWith(".json") ? {} : null)]));
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SECRET_KEYS.has(key) ? "[redacted]" : redactSecrets(item),
  ]));
}

async function fetchRates() {
  const envSolUsd = Number(process.env.SOL_USD || NaN);
  const envUsdIdr = Number(process.env.USD_IDR || NaN);
  if (Number.isFinite(envSolUsd) && Number.isFinite(envUsdIdr)) {
    return {
      source: "env:SOL_USD,USD_IDR",
      SOL_USD: envSolUsd,
      SOL_IDR: envSolUsd * envUsdIdr,
      USD_IDR: envUsdIdr,
      fetchedAt: new Date().toISOString(),
    };
  }

  try {
    const solRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    if (!solRes.ok) throw new Error(`CoinGecko HTTP ${solRes.status}`);
    const solJson = await solRes.json();
    const solUsd = Number(solJson?.solana?.usd);
    if (!Number.isFinite(solUsd)) throw new Error("CoinGecko response missing solana.usd");

    const fxUrls = [
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
      "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
    ];
    let fxJson;
    let fxSource;
    let lastFxError;
    for (const url of fxUrls) {
      try {
        const fxRes = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
          headers: { accept: "application/json" },
        });
        if (!fxRes.ok) throw new Error(`HTTP ${fxRes.status}`);
        fxJson = await fxRes.json();
        fxSource = url;
        break;
      } catch (error) {
        lastFxError = error;
      }
    }
    if (!fxJson) throw new Error(`exchange-api USD/IDR fetch failed: ${lastFxError?.message || "unknown error"}`);
    const usdIdr = Number(fxJson?.usd?.idr);
    if (!Number.isFinite(usdIdr)) throw new Error("exchange-api response missing usd.idr");

    return {
      source: `coingecko:solana.usd + exchange-api:usd.idr (${fxSource})`,
      SOL_USD: solUsd,
      SOL_IDR: solUsd * usdIdr,
      USD_IDR: usdIdr,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn(`Warning: live FX/price fetch failed: ${error.message}. USD/IDR preview values will show N/A.`);
    return {
      source: "unavailable",
      SOL_USD: null,
      SOL_IDR: null,
      USD_IDR: null,
      fetchedAt: null,
      error: error.message,
    };
  }
}

function normalize(raw, rates) {
  const paper = raw["paper-trading.json"] || {};
  const decisionsRaw = raw["decision-log.json"];
  const decisions = Array.isArray(decisionsRaw) ? decisionsRaw : decisionsRaw?.decisions || [];
  const lessonsRaw = raw["lessons.json"] || {};
  const lessonPerformance = Array.isArray(lessonsRaw.performance) ? lessonsRaw.performance : [];
  const history = Array.isArray(paper.history) ? paper.history : [];
  const openPositions = Array.isArray(paper.positions) ? paper.positions : [];
  const days = new Map();
  const events = [];

  function day(key) {
    if (!days.has(key)) days.set(key, { date: key, pnlSol: 0, feesSol: 0, opens: 0, closes: 0, deploys: 0, wins: 0, losses: 0, positionIds: new Set(), events: [] });
    return days.get(key);
  }

  for (const item of history) {
    const key = String(item.at || "").slice(0, 10);
    if (!key) continue;
    const d = day(key);
    if (item.position) d.positionIds.add(item.position);
    if (item.type === "open") d.opens += 1;
    if (item.type === "close") {
      const pnl = Number(item.pnl_sol ?? item.profit_sol ?? 0) || 0;
      d.closes += 1; d.pnlSol += pnl; d.feesSol += Number(item.fees_sol || 0) || 0;
      if (pnl >= 0) d.wins += 1; else d.losses += 1;
    }
    const event = { source: "paper", ...item };
    d.events.push(event); events.push(event);
  }
  for (const item of decisions) {
    const key = String(item.ts || item.at || item.created_at || "").slice(0, 10);
    if (!key) continue;
    const event = { source: "decision", ...item };
    if (item.type === "deploy") day(key).deploys += 1;
    day(key).events.push(event); events.push(event);
  }
  for (const item of lessonPerformance) {
    const key = String(item.recorded_at || item.closed_at || item.at || "").slice(0, 10);
    if (!key) continue;
    const event = {
      source: "lesson-performance",
      type: "close_reason",
      at: item.recorded_at || item.closed_at,
      position: item.position,
      pool: item.pool,
      pool_name: item.pool_name,
      pnl_pct: item.pnl_pct,
      pnl_usd: item.pnl_usd,
      reason: item.close_reason || item.reason || "close reason unavailable",
      ...item,
    };
    day(key).events.push(event); events.push(event);
  }
  for (const item of openPositions) {
    const key = String(item.opened_at || item.created_at || "").slice(0, 10);
    if (!key) continue;
    const d = day(key);
    if (item.position) d.positionIds.add(item.position);
  }
  const normalizedDays = [...days.values()].map((d) => ({
    ...d,
    deploys: d.deploys || d.opens,
    positionsCount: d.positionIds.size || d.opens + d.closes,
    positionIds: [...d.positionIds],
  })).sort((a, b) => a.date.localeCompare(b.date));
  return {
    generatedAt: new Date().toISOString(),
    rates,
    summary: {
      currentSol: Number(paper.sol ?? 0),
      initialSol: Number(paper.initial_sol ?? 0),
      openPositions: openPositions.length,
      decisions: decisions.length,
      closedTrades: history.filter((h) => h.type === "close").length,
      realizedPnlSol: [...days.values()].reduce((sum, d) => sum + d.pnlSol, 0),
    },
    openPositions,
    decisions,
    history,
    days: normalizedDays,
    events: events.sort((a, b) => String(b.at || b.ts || "").localeCompare(String(a.at || a.ts || ""))).slice(0, 250),
    raw: redactSecrets(raw),
  };
}

function renderSvg(data) {
  const width = 1200, height = 680, cell = 150, top = 120, left = 30;
  const days = data.days.length ? data.days : Array.from({ length: 14 }, (_, i) => ({ date: ymd(new Date(Date.now() - (13 - i) * 86400000)), pnlSol: 0, opens: 0, closes: 0, wins: 0, losses: 0 }));
  const latest = days.slice(-28);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];
  parts.push(`<rect width="100%" height="100%" rx="28" fill="#0b0d10"/>`);
  parts.push(`<text x="30" y="48" fill="#f8fafc" font-family="Inter,Arial" font-size="24" font-weight="800">Meridian PnL Preview</text>`);
  parts.push(`<text x="30" y="78" fill="#94a3b8" font-family="Inter,Arial" font-size="13">${esc(data.generatedAt)} • ${data.summary.openPositions} open • ${data.summary.closedTrades} closed</text>`);
  latest.forEach((d, i) => {
    const x = left + (i % 7) * (cell + 12), y = top + Math.floor(i / 7) * 118;
    const pnl = Number(d.pnlSol || 0);
    parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="96" rx="18" fill="${pnl < 0 ? "#241216" : pnl > 0 ? "#0d211b" : "#12161d"}" stroke="#243041"/>`);
    parts.push(`<text x="${x + 14}" y="${y + 28}" fill="#cbd5e1" font-family="Inter,Arial" font-size="13" font-weight="700">${esc(d.date)}</text>`);
    parts.push(`<text x="${x + 14}" y="${y + 58}" fill="${pnl < 0 ? "#fb7185" : "#34d399"}" font-family="Inter,Arial" font-size="22" font-weight="900">${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL</text>`);
    parts.push(`<text x="${x + 14}" y="${y + 80}" fill="#64748b" font-family="Inter,Arial" font-size="12">${d.opens} opens · ${d.closes} closes</text>`);
  });
  parts.push(`</svg>`);
  return parts.join("\n");
}

function renderHtml(data) {
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meridian Dashboard</title><style>
  :root{color-scheme:dark;--bg:#0b0c0f;--panel:#15171b;--panel2:#111317;--line:#25282f;--line2:#1d2026;--text:#dce3ee;--muted:#737b8c;--green:#13c489;--red:#ef4b5f;--accent:#b7c7d9}*{box-sizing:border-box}html,body{height:100%;overflow:hidden}body{margin:0;background:#0b0c0f;font-family:Inter,ui-sans-serif,system-ui,Arial;color:var(--text)}.app{height:100vh;max-width:1280px;margin:0 auto;padding:18px;display:grid;grid-template-rows:auto auto 1fr;gap:12px}.top{display:flex;align-items:end;justify-content:space-between;gap:16px;min-height:48px}.brand h1{margin:0;font-size:18px;letter-spacing:-.03em}.brand p{display:none}.controls{display:flex;gap:9px;flex-wrap:wrap}.field{display:grid;gap:5px}.label{font-size:10px;color:var(--muted);font-weight:800}.input,.select{background:#101217;border:1px solid var(--line);border-radius:9px;color:var(--text);padding:9px 10px;outline:none;min-width:138px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px;box-shadow:none;min-height:0}.metric{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}.value{font-size:21px;font-weight:900;margin-top:6px}.main{min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:10px;align-items:stretch}.calendarCard,.sideCard{height:100%;max-height:100%;overflow:hidden}.section-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.section-title h2{font-size:14px;margin:0}.monthbar{display:flex;align-items:center;gap:14px;margin-bottom:10px}.navbtn{border:0;background:transparent;color:#8a92a3;font-size:20px;cursor:pointer}.month{font-weight:900;font-size:15px}.pill{font-size:11px;color:#bed2e5;border:1px solid var(--line);background:#171a20;border-radius:8px;padding:6px 9px}.stats{margin-left:auto;color:var(--muted);font-size:12px}.stats b{color:var(--green)}.dow,.calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}.dow span{font-size:10px;color:#5f6674;text-align:center;font-weight:800;padding-bottom:7px}.calendarShell{height:calc(100% - 78px);display:grid;grid-template-columns:minmax(0,1fr) 90px;gap:8px}.calendar{height:100%;grid-template-rows:repeat(6,1fr);border:1px solid var(--line2);overflow:hidden}.day{border:0;border-right:1px solid var(--line2);border-bottom:1px solid var(--line2);border-radius:0;padding:9px;background:#131518;cursor:pointer;text-align:left;min-width:0;position:relative}.day:nth-child(7n){border-right:0}.day.good{background:#10241d}.day.bad{background:#2a161a}.day.muted{opacity:.45}.day.today{outline:1px solid #758195;outline-offset:-2px}.date{position:absolute;right:8px;top:7px;font-size:11px;color:#707889;font-weight:900}.share{color:#536071;font-size:12px}.pnl{font-size:17px;font-weight:950;margin-top:18px;text-align:center}.goodText{color:var(--green)}.badText{color:var(--red)}.meta{font-size:11px;color:#7d8493;margin-top:4px;text-align:center}.weeks{border-left:1px solid var(--line);display:grid;grid-template-rows:repeat(6,1fr)}.week{padding:9px 10px;border-bottom:1px solid var(--line2)}.week:last-child{border-bottom:0}.week .wlabel{font-size:11px;color:#858d9d;font-weight:900}.week .wpnl{font-size:15px;font-weight:950;margin-top:6px}.week .wdays{font-size:11px;color:#697181;margin-top:3px}.tabs{display:flex;gap:7px;margin-bottom:10px}.tab{border:1px solid var(--line);background:#111317;color:var(--muted);border-radius:999px;padding:7px 10px;cursor:pointer;font-size:11px}.tab.active{color:#e9f1fb;border-color:#5f6c7e;background:#1b2028}.panel{height:calc(100% - 42px);overflow:auto;padding-right:3px}.row{border:1px solid var(--line);border-radius:10px;padding:10px;background:#101217;margin-bottom:7px}.row strong{display:block;margin-bottom:4px;font-size:13px}.raw{white-space:pre-wrap;word-break:break-word;font-size:11px;color:#b8c2d1}.empty{color:var(--muted);padding:24px;text-align:center}@media(max-width:900px){html,body{overflow:auto}.app{height:auto}.grid,.main{grid-template-columns:1fr}.calendarShell{grid-template-columns:1fr}.weeks{display:none}.calendar{min-height:620px}.main{height:auto}.calendarCard,.sideCard{height:720px}}
  </style></head><body><div class="app"><header class="top"><div class="brand"><h1>Meridian Dashboard</h1><p>Interactive preview of generated JSON state.</p></div><div class="controls" id="controls"></div></header><section class="grid" id="metrics"></section><main class="main"><section class="card calendarCard"><div class="section-title"><h2>Realized PnL</h2><span class="meta" id="generated"></span></div><div class="monthbar"><button class="navbtn" id="prevMonth">‹</button><div class="month" id="monthLabel"></div><button class="navbtn" id="nextMonth">›</button><span class="pill">This month</span><span class="stats" id="monthStats"></span></div><div class="dow"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="calendarShell"><div class="calendar" id="calendar"></div><div class="weeks" id="weeks"></div></div></section><aside class="card sideCard"><div class="tabs" id="tabs"></div><div class="panel" id="panel"></div></aside></main></div><script>window.MERIDIAN_DATA=${json};
  const C={currency:'SOL',tab:'events',query:'',month:null};const D=window.MERIDIAN_DATA;const pad=n=>String(n).padStart(2,'0');const keyOf=d=>d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());const byDay=new Map(D.days.map(d=>[d.date,d]));const noPlus=s=>String(s).startsWith('+')?String(s).slice(1):String(s);function fmt(sol){const n=Number(sol||0);if(C.currency==='SOL')return (n>=0?'+':'')+n.toFixed(2)+' SOL';if(!D.rates||!Number.isFinite(Number(D.rates.SOL_USD)))return 'N/A';const usd=n*Number(D.rates.SOL_USD);if(C.currency==='USD')return (usd>=0?'+':'')+'$'+usd.toFixed(2);if(!Number.isFinite(Number(D.rates.SOL_IDR)))return 'N/A';const idr=n*Number(D.rates.SOL_IDR);return (idr>=0?'+':'')+'Rp '+Math.round(idr).toLocaleString('id-ID')}function el(t,c,h){const x=document.createElement(t);if(c)x.className=c;if(h!==undefined)x.innerHTML=h;return x}function control(label,node){const w=el('label','field');w.append(el('span','label',label),node);return w}function monthRef(){if(!C.month){const last=D.days.at(-1)?.date||keyOf(new Date());C.month=last.slice(0,7)}return new Date(C.month+'-01T00:00:00Z')}function drawControls(){const root=document.getElementById('controls');root.innerHTML='';const sel=el('select','select');['SOL','USD','IDR'].forEach(v=>{const o=el('option','',v);o.value=v;sel.append(o)});sel.value=C.currency;sel.onchange=()=>{C.currency=sel.value;draw()};const input=el('input','input');input.placeholder='Search';input.oninput=()=>{C.query=input.value.toLowerCase();drawPanel()};root.append(control('PnL currency',sel),control('Filter',input))}function drawMetrics(){const s=D.summary;document.getElementById('metrics').innerHTML=[['Wallet SOL',s.currentSol.toFixed(5)+' SOL'],['Realized PnL',fmt(s.realizedPnlSol)],['Open positions',s.openPositions],['Decisions',s.decisions]].map(([a,b])=>'<article class="card"><div class="metric">'+a+'</div><div class="value">'+b+'</div></article>').join('')}function drawCalendar(){const ref=monthRef();document.getElementById('monthLabel').textContent=ref.toLocaleString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});const first=new Date(Date.UTC(ref.getUTCFullYear(),ref.getUTCMonth(),1));const start=new Date(first);start.setUTCDate(1-first.getUTCDay());const root=document.getElementById('calendar');const weeks=document.getElementById('weeks');root.innerHTML='';weeks.innerHTML='';let monthly=0,active=0;const weekAgg=Array.from({length:6},()=>({pnl:0,days:0}));const today=keyOf(new Date());for(let i=0;i<42;i++){const date=new Date(start);date.setUTCDate(start.getUTCDate()+i);const key=keyOf(date);const d=byDay.get(key)||{date:key,pnlSol:0,opens:0,closes:0,deploys:0,wins:0,losses:0,positionsCount:0,events:[]};const inMonth=date.getUTCMonth()===ref.getUTCMonth();const has=inMonth&&(Number(d.deploys||0)>0||Number(d.positionsCount||0)>0||Number(d.pnlSol||0)!==0||Number(d.feesSol||0)!==0);const pnl=Number(d.pnlSol||0);if(has){monthly+=pnl;active++;weekAgg[Math.floor(i/7)].pnl+=pnl;weekAgg[Math.floor(i/7)].days++}const node=el('button','day '+(pnl<0?'bad':pnl>0?'good':'')+(inMonth?'':' muted')+(key===today?' today':''));node.innerHTML='<div class="date">'+date.getUTCDate()+'</div>'+(has?'<div class="share">↥</div><div class="pnl '+(pnl<0?'badText':'goodText')+'">'+fmt(pnl)+'</div><div class="meta">'+Number(d.deploys||0)+' deploys<br>'+((d.wins+d.losses)?((d.wins/(d.wins+d.losses))*100).toFixed(1)+'% closed win':'no closes')+'</div>':'');node.title=has?d.positionsCount+' unique positions · '+d.opens+' opens · '+d.closes+' closes':'';node.onclick=()=>{C.tab='day:'+key;drawTabs();drawPanel()};root.append(node)}document.getElementById('monthStats').innerHTML='Monthly stats: <b>'+noPlus(fmt(monthly))+'</b> &nbsp; '+active+' days';weekAgg.forEach((w,i)=>{weeks.insertAdjacentHTML('beforeend','<div class="week"><div class="wlabel">Week '+(i+1)+' ↥</div><div class="wpnl '+(w.pnl<0?'badText':'goodText')+'">'+noPlus(fmt(w.pnl))+'</div><div class="wdays">'+w.days+' days</div></div>')})}function drawTabs(){const tabs=['events','positions','decisions','raw'];const root=document.getElementById('tabs');root.innerHTML='';for(const t of tabs){const b=el('button','tab '+(C.tab===t||C.tab.startsWith('day:')&&t==='events'?'active':''),t);b.onclick=()=>{C.tab=t;drawTabs();drawPanel()};root.append(b)}}function row(title,body){return '<div class="row"><strong>'+title+'</strong><div class="meta">'+body+'</div></div>'}function drawPanel(){const p=document.getElementById('panel');let html='';if(C.tab==='positions'){html=D.openPositions.map(x=>row(x.pair||x.pool||x.position,'PnL '+fmt((x.pnl_usd||0)/D.rates.SOL_USD)+' · '+(x.in_range?'in range':'OOR')+' · '+(x.position||'').slice(0,18))).join('')}else if(C.tab==='decisions'){html=D.decisions.filter(x=>JSON.stringify(x).toLowerCase().includes(C.query)).slice(0,80).map(x=>row((x.type||'decision')+' · '+(x.pool_name||x.pool||''),(x.summary||x.reason||'').slice(0,220))).join('')}else if(C.tab==='raw'){html='<pre class="raw">'+JSON.stringify(D.raw,null,2).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))+'</pre>'}else{let list=C.tab.startsWith('day:')?(byDay.get(C.tab.slice(4))?.events||[]):D.events;html=list.filter(x=>JSON.stringify(x).toLowerCase().includes(C.query)).slice(0,100).map(x=>row((x.type||x.source||'event')+' · '+(x.pair||x.pool_name||x.pool||''),String(x.reason||x.summary||x.position||x.at||x.ts||'').slice(0,240))).join('')}p.innerHTML=html||'<div class="empty">No matching data.</div>'}function shiftMonth(n){const r=monthRef();r.setUTCMonth(r.getUTCMonth()+n);C.month=r.toISOString().slice(0,7);drawCalendar()}function draw(){document.getElementById('generated').textContent='Generated '+D.generatedAt.slice(0,19).replace('T',' ');drawControls();drawMetrics();drawCalendar();drawTabs();drawPanel();document.getElementById('prevMonth').onclick=()=>shiftMonth(-1);document.getElementById('nextMonth').onclick=()=>shiftMonth(1)}draw();</script></body></html>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rates = await fetchRates();
  const data = normalize(sourceData(), rates);
  fs.writeFileSync(SVG_PATH, renderSvg(data));
  const html = renderHtml(data);
  fs.writeFileSync(HTML_PATH, html);
  fs.writeFileSync(LEGACY_HTML_PATH, html);
  console.log(`Preview written:\n- ${path.relative(ROOT, SVG_PATH)}\n- ${path.relative(ROOT, HTML_PATH)}\n- ${path.relative(ROOT, LEGACY_HTML_PATH)}\nRates: ${rates.source}${rates.fetchedAt ? ` @ ${rates.fetchedAt}` : ""}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
