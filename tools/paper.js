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

export function estimatePaperPosition(position, market = {}) {
  const now = Date.now();
  const openedAt = position.opened_at ? new Date(position.opened_at).getTime() : now;
  const ageMinutes = Math.max(0, Math.floor((now - openedAt) / 60000));
  const amountSol = Number(position.amount_sol || 0);
  const lowerBin = Number(position.lower_bin);
  const upperBin = Number(position.upper_bin);
  const entryBin = Number(position.entry_active_bin ?? position.active_bin ?? upperBin);
  const activeBin = Number(market.active_bin ?? position.active_bin ?? entryBin);
  const binsBelow = Math.max(1, Number(position.bins_below || (entryBin - lowerBin) || 1));
  const feeTvlRatio = Math.max(0, Number(position.fee_tvl_ratio ?? position.fee_per_tvl_24h ?? 0));
  const baseFee = Math.max(0, Number(position.base_fee ?? 0));
  const inRange = Number.isFinite(activeBin) && Number.isFinite(lowerBin) && Number.isFinite(upperBin)
    ? activeBin >= lowerBin && activeBin <= upperBin
    : true;

  // Approximate directional inventory risk for single-side SOL DLMM paper positions.
  const downsideBins = Number.isFinite(activeBin) && Number.isFinite(entryBin)
    ? Math.max(0, entryBin - activeBin)
    : 0;
  const rangeFill = Math.min(1, downsideBins / binsBelow);
  const belowRangeBins = Number.isFinite(activeBin) && Number.isFinite(lowerBin)
    ? Math.max(0, lowerBin - activeBin)
    : 0;
  const inventoryPnlPct = -(rangeFill * 6) - Math.min(30, (belowRangeBins / binsBelow) * 20);

  // Treat fee_tvl_ratio as a 24h fee yield proxy, scaled by age and base fee.
  const ageDays = ageMinutes / 1440;
  const feePct = Math.min(25, (feeTvlRatio + baseFee) * ageDays);
  const pnlPct = Math.round((inventoryPnlPct + feePct) * 100) / 100;
  const pnlSol = roundSol(amountSol * pnlPct / 100);
  const feeSol = roundSol(amountSol * feePct / 100);
  const valueSol = roundSol(amountSol + pnlSol);

  return {
    ...position,
    active_bin: Number.isFinite(activeBin) ? activeBin : position.active_bin,
    in_range: inRange,
    age_minutes: ageMinutes,
    minutes_out_of_range: inRange ? 0 : ageMinutes,
    unclaimed_fees_usd: feeSol,
    unclaimed_fees_true_usd: feeSol,
    collected_fees_usd: position.collected_fees_usd ?? 0,
    collected_fees_true_usd: position.collected_fees_true_usd ?? 0,
    total_value_usd: valueSol,
    total_value_true_usd: valueSol,
    pnl_usd: pnlSol,
    pnl_true_usd: pnlSol,
    pnl_pct: pnlPct,
    pnl_pct_derived: pnlPct,
    fee_per_tvl_24h: feeTvlRatio || null,
    paper_estimated: true,
    paper_value_sol: valueSol,
    paper_pnl_sol: pnlSol,
    paper_fee_sol: feeSol,
  };
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
    entry_active_bin: details.active_bin ?? null,
    entry_price: details.entry_price ?? null,
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
    fee_tvl_ratio: details.fee_tvl_ratio ?? null,
    volatility: details.volatility ?? null,
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
  const estimated = estimatePaperPosition(position);
  const amount = roundSol(estimated.paper_value_sol ?? position.amount_sol ?? 0);
  const now = new Date().toISOString();
  state.sol = roundSol(state.sol + amount);
  state.history.push({
    type: "close",
    at: now,
    amount_sol: amount,
    returned_sol: amount,
    pnl_sol: estimated.paper_pnl_sol ?? 0,
    pnl_pct: estimated.pnl_pct ?? 0,
    fees_sol: estimated.paper_fee_sol ?? 0,
    position: position.position,
    pool: position.pool,
    reason: reason || null,
  });
  savePaperState(state);
  return { found: true, position: estimated, returned_sol: amount, balance_sol: state.sol };
}
