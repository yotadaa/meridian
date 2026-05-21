import { fmtSol } from "../lib/format.js";

function keyOf(date) {
  return date.toISOString().slice(0, 10);
}

export function Calendar(days = []) {
  const byDay = new Map(days.map((d) => [d.date, d]));
  const last = days.at(-1)?.date || keyOf(new Date());
  const ref = new Date(`${last.slice(0, 7)}-01T00:00:00Z`);
  const start = new Date(ref);
  start.setUTCDate(1 - ref.getUTCDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const key = keyOf(date);
    const d = byDay.get(key) || { pnlSol: 0, deploys: 0, closes: 0, wins: 0, losses: 0 };
    const active = d.deploys || d.closes || Number(d.pnlSol || 0) !== 0;
    const winRate = d.closes ? `${((d.wins / d.closes) * 100).toFixed(1)}% paper-positive closes` : "no closes";
    cells.push(`<div class="day-cell ${date.getUTCMonth() === ref.getUTCMonth() ? "" : "muted"} ${Number(d.pnlSol) > 0 ? "positive" : Number(d.pnlSol) < 0 ? "negative" : ""}">
      <span class="date-num">${date.getUTCDate()}</span>
      ${active ? `<strong>${fmtSol(d.pnlSol)}</strong><small>${d.deploys || d.opens || 0} deploys · ${d.closes || 0} closes<br/>${winRate}</small>` : ""}
    </div>`);
  }
  return `<section class="panel calendar-panel"><div class="section-heading"><h2>Paper PnL Calendar</h2><p>Win rate is based on paper close records, not live exchange settlement.</p></div><div class="calendar-grid">${cells.join("")}</div></section>`;
}
