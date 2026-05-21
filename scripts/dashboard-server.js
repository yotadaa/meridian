import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DASHBOARD_DIR = path.join(ROOT, "dashboard");
const PORT = Number(process.env.DASHBOARD_PORT || 8787);
const HOST = process.env.DASHBOARD_HOST || "127.0.0.1";

const DATA_FILES = [
  "paper-trading.json",
  "decision-log.json",
  "state.json",
  "pool-memory.json",
  "strategy-library.json",
  "lessons.json",
  "hivemind-cache.json",
  "signal-weights.json",
  "smart-wallets.json",
  "token-blacklist.json",
  "dev-blocklist.json",
  "user-config.json",
];

const SECRET_KEY_RE = /(key|secret|token|private|password|chatid|rpcurl|apikey)/i;

function readJson(file) {
  try {
    const abs = path.join(ROOT, file);
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return file.endsWith(".json") ? {} : null;
  }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SECRET_KEY_RE.test(key) ? "[redacted]" : redact(item),
  ]));
}

function normalize(raw) {
  const paper = raw["paper-trading.json"] || {};
  const decisionRaw = raw["decision-log.json"];
  const decisions = Array.isArray(decisionRaw) ? decisionRaw : decisionRaw?.decisions || [];
  const state = raw["state.json"] || {};
  const lessons = raw["lessons.json"] || {};
  const history = Array.isArray(paper.history) ? paper.history : [];
  const openPaper = Array.isArray(paper.positions) ? paper.positions : [];
  const trackedPositions = Object.values(state.positions || {});
  const performance = Array.isArray(lessons.performance) ? lessons.performance : [];
  const lessonsList = Array.isArray(lessons.lessons) ? lessons.lessons : [];
  const events = [];
  const days = new Map();

  function day(key) {
    if (!days.has(key)) {
      days.set(key, { date: key, pnlSol: 0, feesSol: 0, opens: 0, closes: 0, deploys: 0, wins: 0, losses: 0, events: [] });
    }
    return days.get(key);
  }
  function pushEvent(event) {
    const at = event.at || event.ts || event.created_at || event.recorded_at || event.closed_at || null;
    const key = String(at || "").slice(0, 10);
    const enriched = { ...event, at };
    events.push(enriched);
    if (key) day(key).events.push(enriched);
    return key;
  }

  for (const item of history) {
    const key = pushEvent({ source: "paper", ...item });
    if (!key) continue;
    const d = day(key);
    if (item.type === "open") d.opens += 1;
    if (item.type === "close") {
      const pnl = Number(item.pnl_sol ?? item.profit_sol ?? 0) || 0;
      d.closes += 1;
      d.pnlSol += pnl;
      d.feesSol += Number(item.fees_sol || 0) || 0;
      if (pnl >= 0) d.wins += 1;
      else d.losses += 1;
    }
  }
  for (const item of decisions) {
    const key = pushEvent({ source: "decision", ...item });
    if (key && item.type === "deploy") day(key).deploys += 1;
  }
  for (const item of performance) pushEvent({ source: "performance", type: "performance", ...item });

  const totalClosed = history.filter((h) => h.type === "close").length;
  const totalWins = history.filter((h) => h.type === "close" && Number(h.pnl_sol ?? h.profit_sol ?? 0) >= 0).length;
  const realizedPnlSol = [...days.values()].reduce((sum, d) => sum + d.pnlSol, 0);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      currentPaperSol: Number(paper.sol ?? 0),
      initialPaperSol: Number(paper.initial_sol ?? 0),
      openPaperPositions: openPaper.length,
      trackedPositions: trackedPositions.length,
      decisions: decisions.length,
      events: events.length,
      totalClosed,
      totalWins,
      paperWinRate: totalClosed ? totalWins / totalClosed : null,
      realizedPnlSol,
    },
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    events: events.sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))),
    decisions: decisions.slice().sort((a, b) => String(b.ts || b.at || "").localeCompare(String(a.ts || a.at || ""))),
    paper: { ...paper, history, positions: openPaper },
    trackedPositions,
    lessons: lessonsList,
    performance,
    raw: redact(raw),
  };
}

function collectData() {
  const raw = Object.fromEntries(DATA_FILES.map((file) => [file, readJson(file)]));
  return normalize(raw);
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const abs = path.normalize(path.join(DASHBOARD_DIR, pathname));
  if (!abs.startsWith(DASHBOARD_DIR)) return send(res, 403, "Forbidden");
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return send(res, 404, "Not found");
  send(res, 200, fs.readFileSync(abs), mime[path.extname(abs)] || "application/octet-stream");
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/data") {
      return send(res, 200, JSON.stringify(collectData()), "application/json; charset=utf-8");
    }
    return serveStatic(req, res);
  } catch (error) {
    return send(res, 500, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Meridian dashboard running at http://${HOST}:${PORT}`);
  console.log("Read-only dashboard; safe to run alongside npm start.");
});
