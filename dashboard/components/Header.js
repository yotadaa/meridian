import { Icons } from "./icons.js";

export function Header({ theme, updatedAt }) {
  const nextTheme = theme === "dark" ? "light" : "dark";
  return `<header class="site-header">
    <div class="brand-mark">${Icons.chart}</div>
    <div class="brand-copy">
      <h1>Meridian Live Dashboard</h1>
      <p>Read-only operational view · refreshed from local JSON state · ${updatedAt || "loading"}</p>
    </div>
    <button class="ghost-button" data-action="refresh">${Icons.refresh}<span>Refresh</span></button>
    <button class="ghost-button" data-action="theme" data-theme="${nextTheme}">${theme === "dark" ? Icons.sun : Icons.moon}<span>${nextTheme}</span></button>
  </header>`;
}
