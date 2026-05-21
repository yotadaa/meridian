import { MetricCard } from "./MetricCard.js";
import { Calendar } from "./Calendar.js";
import { DataTable, commonDateColumn } from "./DataTable.js";
import { Icons } from "./icons.js";
import { fmtPct, fmtSol, text } from "../lib/format.js";

function matches(row, query) {
  if (!query) return true;
  return JSON.stringify(row).toLowerCase().includes(query.toLowerCase());
}

export function Overview(data) {
  const s = data.summary;
  const cards = [
    MetricCard({ label: "Paper balance", value: `${s.currentPaperSol.toFixed(5)} SOL`, hint: `Initial ${s.initialPaperSol.toFixed(2)} SOL`, icon: Icons.chart }),
    MetricCard({ label: "Paper realized PnL", value: fmtSol(s.realizedPnlSol), hint: "From paper close records", icon: Icons.bolt }),
    MetricCard({ label: "Paper win rate", value: s.paperWinRate == null ? "—" : fmtPct(s.paperWinRate), hint: `${s.totalWins}/${s.totalClosed} paper-positive closes`, icon: Icons.shield }),
    MetricCard({ label: "Decision records", value: String(s.decisions), hint: `${s.events} combined events`, icon: Icons.book }),
  ].join("");
  return `<section class="metric-grid">${cards}</section>${Calendar(data.days)}${RecentEvents(data, "")}`;
}

export function Decisions(data, query) {
  const rows = data.decisions.filter((row) => matches(row, query)).slice(0, 300);
  return DataTable({ rows, columns: [
    commonDateColumn,
    { label: "Type", render: (r) => `<span class="pill">${text(r.type)}</span>` },
    { label: "Pool", render: (r) => text(r.pool_name || r.pool) },
    { label: "Summary", render: (r) => text(r.summary || r.reason).slice(0, 260) },
  ] });
}

export function Positions(data, query) {
  const paper = (data.paper.positions || []).map((p) => ({ source: "paper", ...p }));
  const tracked = (data.trackedPositions || []).map((p) => ({ source: "state", ...p }));
  const rows = [...paper, ...tracked].filter((row) => matches(row, query));
  return DataTable({ rows, columns: [
    { label: "Source", render: (r) => `<span class="pill">${r.source}</span>` },
    { label: "Position", render: (r) => text(r.position).slice(0, 18) },
    { label: "Pool", render: (r) => text(r.pool_name || r.pool).slice(0, 34) },
    { label: "Amount", render: (r) => `${text(r.amount_sol ?? r.amount_y)} SOL` },
    { label: "Status", render: (r) => r.closed ? "closed" : "open" },
  ] });
}

export function RecentEvents(data, query) {
  const rows = data.events.filter((row) => matches(row, query)).slice(0, 300);
  return `<section class="panel"><div class="section-heading"><h2>Recent Events</h2><p>Paper trades, decisions, performance records, and operational notes.</p></div>${DataTable({ rows, columns: [
    commonDateColumn,
    { label: "Source", render: (r) => `<span class="pill">${text(r.source)}</span>` },
    { label: "Type", render: (r) => text(r.type) },
    { label: "Detail", render: (r) => text(r.reason || r.summary || r.position || r.pool_name || r.pool).slice(0, 280) },
  ] })}</section>`;
}

export function Lessons(data, query) {
  const lessonRows = (data.lessons || []).map((row) => ({ source: "lesson", ...row }));
  const perfRows = (data.performance || []).map((row) => ({ source: "performance", ...row }));
  const rows = [...lessonRows, ...perfRows].filter((row) => matches(row, query)).slice(0, 300);
  return DataTable({ rows, columns: [
    { label: "Source", render: (r) => `<span class="pill">${text(r.source)}</span>` },
    commonDateColumn,
    { label: "Rule / Reason", render: (r) => text(r.rule || r.close_reason || r.reason).slice(0, 320) },
    { label: "Tags", render: (r) => Array.isArray(r.tags) ? r.tags.join(", ") : text(r.role || r.pool_name) },
  ] });
}

export function RawData(data, query) {
  const raw = query
    ? Object.fromEntries(Object.entries(data.raw).filter(([key, value]) => JSON.stringify({ key, value }).toLowerCase().includes(query.toLowerCase())))
    : data.raw;
  return `<pre class="raw-json">${JSON.stringify(raw, null, 2).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</pre>`;
}
