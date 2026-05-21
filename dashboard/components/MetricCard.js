export function MetricCard({ label, value, hint = "", icon = "" }) {
  return `<article class="metric-card">
    <div class="metric-icon">${icon}</div>
    <div>
      <p>${label}</p>
      <strong>${value}</strong>
      ${hint ? `<small>${hint}</small>` : ""}
    </div>
  </article>`;
}
