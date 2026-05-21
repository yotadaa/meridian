import { Icons } from "./icons.js";

export function SearchBar(query) {
  return `<label class="search-box">${Icons.search}<input data-action="query" value="${query.replaceAll('"', '&quot;')}" placeholder="Search decisions, pools, positions, reasons…" /></label>`;
}
