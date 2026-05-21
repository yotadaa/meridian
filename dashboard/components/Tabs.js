import { Icons } from "./icons.js";

export const TABS = [
  ["Overview", Icons.chart],
  ["Decisions", Icons.bolt],
  ["Positions", Icons.shield],
  ["Events", Icons.book],
  ["Lessons", Icons.book],
  ["Raw Data", Icons.search],
];

export function Tabs(active) {
  return `<nav class="tabs">${TABS.map(([name, icon]) => `
    <button class="tab ${active === name ? "active" : ""}" data-tab="${name}">${icon}<span>${name}</span></button>
  `).join("")}</nav>`;
}
