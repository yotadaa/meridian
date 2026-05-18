import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "previews");
const SVG_PATH = path.join(OUT_DIR, "meridian-pnl-calendar.svg");
const HTML_PATH = path.join(OUT_DIR, "meridian-pnl-calendar.html");

const WIDTH = 1560;
const HEIGHT = 900;
const LEFT = 24;
const TOP = 132;
const CELL_W = 202;
const CELL_H = 86;
const GRID_COLS = 7;
const GRID_ROWS = 6;
const SIDE_W = 112;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")); }
  catch { return fallback; }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function monthName(date) {
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function addDay(map, key, patch) {
  const current = map.get(key) || { pnl: 0, positions: 0, wins: 0, losses: 0, closes: 0 };
  map.set(key, { ...current, ...patch });
}

function buildData() {
  const paper = readJson("paper-trading.json", null);
  const decisions = readJson("decision-log.json", []);
  const map = new Map();

  for (const item of paper?.history || []) {
    const key = String(item.at || "").slice(0, 10);
    if (!key) continue;
    const current = map.get(key) || { pnl: 0, positions: 0, wins: 0, losses: 0, closes: 0 };
    if (item.type === "open") current.positions += 1;
    if (item.type === "close") {
      current.closes += 1;
      current.positions += 1;
      const pnl = Number(item.pnl_sol ?? item.profit_sol ?? 0);
      current.pnl += Number.isFinite(pnl) ? pnl : 0;
      if (pnl >= 0) current.wins += 1; else current.losses += 1;
    }
    map.set(key, current);
  }

  for (const d of Array.isArray(decisions) ? decisions : []) {
    const key = String(d.at || d.created_at || d.timestamp || "").slice(0, 10);
    if (!key) continue;
    const current = map.get(key) || { pnl: 0, positions: 0, wins: 0, losses: 0, closes: 0 };
    if (["deploy", "close"].includes(d.type)) current.positions += 1;
    map.set(key, current);
  }

  if (map.size === 0) {
    // Demo data makes the command useful before the agent has closed positions.
    const today = new Date();
    const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
    const samples = [0.04, 0.03, 0.07, 0.06, 0.01, 0.25, 0.54, -0.39, 0.03, 0.11, 0.31, 0.38, 0.18, 0.35, 0.39, 0.20, 0.31, 0.25, 0.25, 0.36, 0.32, 0.33];
    samples.forEach((pnl, i) => {
      const d = new Date(base + i * 86400000);
      addDay(map, ymd(d), {
        pnl,
        positions: 14 + ((i * 7) % 39),
        wins: pnl >= 0 ? 1 : 0,
        losses: pnl < 0 ? 1 : 0,
        closes: 1,
      });
    });
  }
  return map;
}

function calendarWindow(data) {
  const keys = [...data.keys()].sort();
  const ref = keys.length ? new Date(`${keys[keys.length - 1]}T00:00:00Z`) : new Date();
  const first = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return { ref, first, start };
}

function fmtSol(n) {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toFixed(2)} SOL`;
}

function winRate(day) {
  const total = Number(day.wins || 0) + Number(day.losses || 0);
  if (total > 0) return `${((day.wins / total) * 100).toFixed(1)}%`;
  if (day.positions > 0) return "paper";
  return "";
}

function renderSvg(data) {
  const { ref, start } = calendarWindow(data);
  const month = monthName(ref);
  const todayKey = ymd(new Date());
  const days = [];
  let monthly = 0;
  let activeDays = 0;
  const weeks = Array.from({ length: 6 }, () => ({ pnl: 0, days: 0 }));

  for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const key = ymd(date);
    const day = data.get(key) || { pnl: 0, positions: 0, wins: 0, losses: 0, closes: 0 };
    const inMonth = date.getUTCMonth() === ref.getUTCMonth();
    if (inMonth && day.positions > 0) { monthly += day.pnl; activeDays += 1; }
    if (inMonth && day.positions > 0) { weeks[Math.floor(i / 7)].pnl += day.pnl; weeks[Math.floor(i / 7)].days += 1; }
    days.push({ date, key, day, inMonth, week: Math.floor(i / 7), col: i % 7, row: Math.floor(i / 7) });
  }

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`);
  parts.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#18191d"/><stop offset="1" stop-color="#111216"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`);
  parts.push(`<rect width="100%" height="100%" rx="16" fill="url(#bg)"/>`);
  parts.push(`<text x="24" y="44" fill="#f2f4f8" font-family="Inter,Arial" font-size="21" font-weight="800">Realized PnL ↗</text>`);
  parts.push(`<text x="78" y="96" fill="#f2f4f8" font-family="Inter,Arial" font-size="22" font-weight="800">${esc(month)}</text>`);
  parts.push(`<rect x="230" y="70" width="104" height="32" rx="7" fill="#24262b" stroke="#363941"/><text x="244" y="92" fill="#f2f4f8" font-family="Inter,Arial" font-size="14" font-weight="700">This month</text>`);
  parts.push(`<rect x="1390" y="22" width="74" height="30" rx="6" fill="#23252b" stroke="#40434c"/><text x="1402" y="42" fill="#fff" font-family="Inter,Arial" font-size="12" font-weight="700">Only fees</text>`);
  parts.push(`<rect x="1468" y="22" width="76" height="30" rx="6" fill="#ff5b2e"/><text x="1482" y="42" fill="#fff" font-family="Inter,Arial" font-size="12" font-weight="800">Total P&amp;L</text>`);
  parts.push(`<text x="1315" y="94" fill="#8f96aa" font-family="Inter,Arial" font-size="15">Monthly stats:</text><text x="1424" y="94" fill="#16c784" font-family="Inter,Arial" font-size="15" font-weight="900">${fmtSol(monthly).replace("+", "")}</text><text x="1495" y="94" fill="#8f96aa" font-family="Inter,Arial" font-size="15">${activeDays} days</text>`);

  DAYS.forEach((d, i) => parts.push(`<text x="${LEFT + i * CELL_W + CELL_W / 2 - 14}" y="124" fill="#72788a" font-family="Inter,Arial" font-size="13" font-weight="700">${d}</text>`));

  for (const item of days) {
    const x = LEFT + item.col * CELL_W;
    const y = TOP + item.row * CELL_H;
    const pnl = Number(item.day.pnl || 0);
    const has = item.inMonth && item.day.positions > 0;
    const fill = has ? (pnl < 0 ? "#33191f" : "#102d25") : "#15161a";
    const opacity = item.inMonth ? 1 : 0.55;
    parts.push(`<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" fill="${fill}" opacity="${opacity}" stroke="#24262d"/>`);
    if (item.key === todayKey) parts.push(`<rect x="${x + 1}" y="${y + 1}" width="${CELL_W - 2}" height="${CELL_H - 2}" fill="none" stroke="#98a2b3" stroke-width="2"/>`);
    parts.push(`<text x="${x + CELL_W - 24}" y="${y + 18}" fill="#777d91" font-family="Inter,Arial" font-size="13" font-weight="700">${item.date.getUTCDate()}</text>`);
    parts.push(`<text x="${x + 12}" y="${y + 22}" fill="#657084" font-family="Inter,Arial" font-size="15">↥</text>`);
    if (has) {
      const color = pnl < 0 ? "#ff4560" : "#16c784";
      parts.push(`<text x="${x + 55}" y="${y + 45}" fill="${color}" font-family="Inter,Arial" font-size="20" font-weight="900" filter="url(#glow)">${esc(fmtSol(pnl))}</text>`);
      parts.push(`<text x="${x + 70}" y="${y + 61}" fill="#a0a7b8" font-family="Inter,Arial" font-size="12" font-weight="700">${item.day.positions} positions</text>`);
      parts.push(`<text x="${x + 84}" y="${y + 76}" fill="#8b92a4" font-family="Inter,Arial" font-size="12" font-weight="700">${winRate(item.day)}</text>`);
    }
  }

  const sideX = LEFT + GRID_COLS * CELL_W + 10;
  parts.push(`<line x1="${sideX - 8}" y1="${TOP}" x2="${sideX - 8}" y2="${TOP + GRID_ROWS * CELL_H}" stroke="#30333b"/>`);
  weeks.forEach((w, i) => {
    const y = TOP + i * CELL_H + 24;
    parts.push(`<text x="${sideX + 10}" y="${y}" fill="#7f8799" font-family="Inter,Arial" font-size="13" font-weight="800">Week ${i + 1} ↥</text>`);
    parts.push(`<text x="${sideX + 10}" y="${y + 25}" fill="${w.pnl < 0 ? "#ff4560" : "#16c784"}" font-family="Inter,Arial" font-size="18" font-weight="900">${fmtSol(w.pnl).replace("+", "")}</text>`);
    parts.push(`<text x="${sideX + 10}" y="${y + 45}" fill="#8b92a4" font-family="Inter,Arial" font-size="12" font-weight="700">${w.days} days</text>`);
  });
  parts.push(`<text x="24" y="875" fill="#4f5668" font-family="Inter,Arial" font-size="12">Generated by Meridian • ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC</text>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const svg = renderSvg(buildData());
fs.writeFileSync(SVG_PATH, svg);
fs.writeFileSync(HTML_PATH, `<!doctype html><html><head><meta charset="utf-8"><title>Meridian PnL Calendar</title><style>body{margin:0;background:#050506;display:grid;place-items:center;min-height:100vh}img{max-width:96vw;border-radius:16px;box-shadow:0 24px 80px #000}</style></head><body><img src="./${path.basename(SVG_PATH)}" alt="Meridian PnL Calendar"></body></html>`);
console.log(`Preview written:\n- ${path.relative(ROOT, SVG_PATH)}\n- ${path.relative(ROOT, HTML_PATH)}`);
