import { Header } from "./components/Header.js";
import { Tabs } from "./components/Tabs.js";
import { SearchBar } from "./components/SearchBar.js";
import { Overview, Decisions, Positions, RecentEvents, Lessons, RawData } from "./components/Views.js";
import { refreshData, setState, setTheme, store, subscribe } from "./lib/store.js";
import { dateShort } from "./lib/format.js";

const root = document.querySelector("#app");

function view(data, tab, query) {
  if (tab === "Decisions") return Decisions(data, query);
  if (tab === "Positions") return Positions(data, query);
  if (tab === "Events") return RecentEvents(data, query);
  if (tab === "Lessons") return Lessons(data, query);
  if (tab === "Raw Data") return RawData(data, query);
  return Overview(data);
}

function render() {
  document.documentElement.dataset.theme = store.theme;
  if (store.loading) {
    root.innerHTML = `<main class="shell"><div class="loading">Loading dashboard…</div></main>`;
    return;
  }
  if (store.error && !store.data) {
    root.innerHTML = `<main class="shell"><div class="empty-state">Dashboard error: ${store.error}</div></main>`;
    return;
  }
  const data = store.data;
  root.innerHTML = `<main class="shell">
    ${Header({ theme: store.theme, updatedAt: dateShort(data.generatedAt) })}
    <div class="toolbar">${Tabs(store.tab)}${SearchBar(store.query)}</div>
    ${store.error ? `<div class="notice">Last refresh failed: ${store.error}</div>` : ""}
    <section class="view">${view(data, store.tab, store.query)}</section>
  </main>`;
}

root.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) setState({ tab: tab.dataset.tab });
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "refresh") refreshData();
  if (action.dataset.action === "theme") setTheme(action.dataset.theme);
});

root.addEventListener("input", (event) => {
  if (event.target.matches('[data-action="query"]')) setState({ query: event.target.value });
});

subscribe(render);
setTheme(store.theme);
refreshData();
setInterval(refreshData, Number(new URLSearchParams(location.search).get("interval") || 5000));
