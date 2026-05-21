import fs from "fs";
import path from "path";

const LOG_DIR = "./logs";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[LOG_LEVEL] || 1;
const SECRET_KEY_RE = /(private|secret|apikey|api_key|api-key|token|walletkey|wallet_key|wallet-private-key|wallet_private_key|WALLET_PRIVATE_KEY|authorization|password|passphrase)/i;
const SECRET_VALUE_RE = /\b(?:[1-9A-HJ-NP-Za-km-z]{80,}|sk-[A-Za-z0-9_-]{16,}|or-[A-Za-z0-9_-]{16,})\b/g;

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * General log function.
 */
export function log(category, message) {
  const level = category.includes("error") ? "error"
    : category.includes("warn") ? "warn"
    : "info";

  if (LEVELS[level] < currentLevel) return;

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${category.toUpperCase()}] ${message}`;

  // Console output
  console.log(line);

  // File output (daily rotation)
  const dateStr = timestamp.split("T")[0];
  const logFile = path.join(LOG_DIR, `agent-${dateStr}.log`);
  fs.appendFileSync(logFile, line + "\n");
}

export function redactSecrets(value, depth = 0) {
  if (depth > 12) return "[REDACTED:MAX_DEPTH]";
  if (value == null) return value;
  if (typeof value === "string") return value.replace(SECRET_VALUE_RE, "[REDACTED]");
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, depth + 1));

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = SECRET_KEY_RE.test(key) ? "[REDACTED]" : redactSecrets(entry, depth + 1);
  }
  return out;
}

/**
 * Log a tool action with full details (for audit trail).
 */
function actionHint(action) {
  const a = action.args || {};
  const r = action.result || {};
  switch (action.tool) {
    case "deploy_position":   return ` ${a.pool_name || a.pool_address?.slice(0,8)} ${a.amount_sol ?? a.amount_y ?? ""} SOL`;
    case "close_position":    return ` ${a.position_address?.slice(0,8)}${r.pnl_usd != null ? ` | PnL $${r.pnl_usd >= 0 ? "+" : ""}${r.pnl_usd} (${r.pnl_pct}%)` : ""}`;
    case "claim_fees":        return ` ${a.position_address?.slice(0,8)}`;
    case "get_active_bin":    return ` bin ${r.binId ?? ""}`;
    case "get_pool_detail":   return ` ${r.name || a.pool_address?.slice(0,8) || ""}`;
    case "get_my_positions":  return ` ${r.total_positions ?? ""} positions`;
    case "get_wallet_balance":return ` ${r.sol ?? ""} SOL`;
    case "get_top_candidates":return ` ${r?.candidates?.length ?? ""} pools`;
    case "swap_token":        return ` ${a.amount} ${a.input_mint?.slice(0,6)}→SOL`;
    case "update_config":     return ` ${Object.keys(r.applied || {}).join(", ")}`;
    case "add_lesson":        return ` saved`;
    case "clear_lessons":     return ` cleared ${r.cleared ?? ""}`;
    default:                  return "";
  }
}

export function logAction(action) {
  const timestamp = new Date().toISOString();

  const entry = redactSecrets({ timestamp, ...action });

  // Console: single clean line, no raw JSON
  const status = action.success ? "✓" : "✗";
  const dur = action.duration_ms != null ? ` (${action.duration_ms}ms)` : "";
  const hint = actionHint(action);
  console.log(`[${action.tool}] ${status}${hint}${dur}`);

  // File: full JSON for audit trail
  const dateStr = timestamp.split("T")[0];
  const actionsFile = path.join(LOG_DIR, `actions-${dateStr}.jsonl`);
  fs.appendFileSync(actionsFile, JSON.stringify(entry) + "\n");
}
