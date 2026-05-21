import { dateShort, text } from "../lib/format.js";

export function DataTable({ rows, columns, empty = "No records found." }) {
  if (!rows?.length) return `<div class="empty-state">${empty}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead><tbody>
    ${rows.map((row) => `<tr>${columns.map((c) => `<td>${c.render ? c.render(row) : text(row[c.key])}</td>`).join("")}</tr>`).join("")}
  </tbody></table></div>`;
}

export const commonDateColumn = { label: "Time", render: (row) => dateShort(row.at || row.ts || row.created_at || row.recorded_at) };
