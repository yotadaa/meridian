export function fmtNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtSol(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${fmtNumber(n, digits)} SOL`;
}

export function fmtPct(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${fmtNumber(n * 100, digits)}%`;
}

export function dateShort(value) {
  if (!value) return "—";
  return String(value).replace("T", " ").slice(0, 19);
}

export function text(value, fallback = "—") {
  const s = String(value ?? "").trim();
  return s || fallback;
}
