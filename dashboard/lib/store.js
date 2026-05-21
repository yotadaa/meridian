const listeners = new Set();

export const store = {
  data: null,
  loading: true,
  error: null,
  query: "",
  tab: "Overview",
  theme: localStorage.getItem("meridian-theme") || "light",
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setState(patch) {
  Object.assign(store, patch);
  for (const listener of listeners) listener(store);
}

export async function refreshData() {
  try {
    const res = await fetch(`/api/data?ts=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setState({ data, loading: false, error: null });
  } catch (error) {
    setState({ loading: false, error: error.message });
  }
}

export function setTheme(theme) {
  localStorage.setItem("meridian-theme", theme);
  document.documentElement.dataset.theme = theme;
  setState({ theme });
}
