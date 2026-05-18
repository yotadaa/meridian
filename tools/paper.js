import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAPER_PATH = path.join(__dirname, "../paper-trading.json");

const isDryRun = () => process.env.DRY_RUN === "true";
const roundSol = (value) => Math.round(Number(value || 0) * 1e9) / 1e9;

function configuredInitialSol() {
  const n = Number(config.management?.dryRunVirtualSol ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function newState() {
  const now = new Date().toISOString();
  const initial = configuredInitialSol();
  return { version: 1, created_at: now, updated_at: now, initial_sol: initial, sol: initial, positions: [], history: [] };
}

export function loadPaperState() {
  if (!fs.existsSync(PAPER_PATH)) return newState();
  try {
    const state = JSON.parse(fs.readFileSync(PAPER_PATH, "utf8"));
    if (!Array.isArray(state.positions)) state.positions = [];
    if (!Array.isArray(state.history)) state.history = [];
    if (!Number.isFinite(Number(state.sol))) state.sol = configuredInitialSol();
    return state;
  } catch {
    return newState();
  }
}

function savePaperState(state) {
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(PAPER_PATH, JSON.stringify(state, null, 2));
  return state;
}

export function getPaperBalance() {
  if (!isDryRun()) return null;
  return roundSol(loadPaperState().sol);
}

export function getPaperPositions() {
  if (!isDryRun()) return [];
  const now = Date.now();
  return loadPaperState().positions.map((p) => ({
    ...p,
    age_minutes: p.opened_at ? Math.floor((now - new Date(p.opened_at).getTime()) / 60000) : (p.age_minutes ?? 0),
  }));
}

export function openPaperPosition(details) {
  if (!isDryRun()) return null;
  const amount = Number(details.amount_sol || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid paper deploy amount");
  const state = loadPaperState();
  if (state.sol < amount) throw new Error(`Insufficient paper SOL: have ${roundSol(state.sol)} SOL, need ${amount} SOL.`);
  const now = new Date().toISOString();
  const position = {
    position: `paper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    pool: details.pool_address,
    pair: details.pool_name || [details.token_x_symbol, details.token_y_symbol].filter(Boolean).join("-") || details.pool_address,
    base_mint: details.base_mint || null,
    lower_bin: details.lower_bin ?? null,
    upper_bin: details.upper_bin ?? null,
    active_bin: details.active_bin ?? null,
    in_range: true,
    amount_sol: roundSol(amount),
    total_value_usd: null,
    total_value_true_usd: null,
    unclaimed_fees_usd: 0,
    unclaimed_fees_true_usd: 0,
    collected_fees_usd: 0,
    collected_fees_true_usd: 0,
    pnl_usd: 0,
    pnl_true_usd: 0,
    pnl_pct: 0,
    fee_per_tvl_24h: null,
    minutes_out_of_range: 0,
    instruction: null,
    paper: true,
    strategy: details.strategy,
    bins_below: details.bins_below,
    bins_above: details.bins_above,
    bin_step: details.bin_step,
    base_fee: details.base_fee,
    opened_at: now,
  };
  state.sol = roundSol(state.sol - amount);
  state.positions.push(position);
  state.history.push({ type: "open", at: now, amount_sol: amount, position: position.position, pool: position.pool });
  savePaperState(state);
  return { position, balance_sol: state.sol };
}

export function closePaperPosition(position_address, { reason } = {}) {
  if (!isDryRun()) return null;
  const state = loadPaperState();
  const index = state.positions.findIndex((p) => p.position === position_address);
  if (index < 0) return { found: false };
  const [position] = state.positions.splice(index, 1);
  const amount = roundSol(position.amount_sol || 0);
  const now = new Date().toISOString();
  state.sol = roundSol(state.sol + amount);
  state.history.push({ type: "close", at: now, amount_sol: amount, position: position.position, pool: position.pool, reason: reason || null });
  savePaperState(state);
  return { found: true, position, returned_sol: amount, balance_sol: state.sol };
}
