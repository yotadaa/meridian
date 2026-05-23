import * as telegram from "./telegram.js";
import * as whatsapp from "./whatsapp.js";
import fs from "fs";

const USER_CONFIG_PATH = "./user-config.json";

function loadCommsConfig() {
  try {
    if (fs.existsSync(USER_CONFIG_PATH)) return JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
  } catch { /* ignore */ }
  return {};
}

function preferredChannelName() {
  return String(loadCommsConfig().preferredChannel || process.env.PREFERRED_CHANNEL || "telegram").toLowerCase();
}

function telegramFallbackEnabled() {
  const cfg = loadCommsConfig();
  return cfg.telegramFallbackEnabled === true || process.env.TELEGRAM_FALLBACK_ENABLED === "true";
}

function preferred() {
  return preferredChannelName() === "whatsapp" ? whatsapp : telegram;
}

function fallback(channel) {
  return channel === whatsapp && telegramFallbackEnabled() ? telegram : null;
}

async function callWithFallback(method, args) {
  const channel = preferred();
  try {
    const result = await channel[method](...args);
    if (result != null || channel === telegram) return result;
  } catch {
    // Try Telegram below if WhatsApp failed. Individual channel modules log details.
  }
  const next = fallback(channel);
  return next?.isEnabled?.() ? next[method](...args) : null;
}

export const isEnabled = () => preferred().isEnabled();
export const startPolling = (handler) => preferred().startPolling(handler);
export const stopPolling = () => preferred().stopPolling?.();
export const sendMessage = (...args) => callWithFallback("sendMessage", args);
export const sendMessageWithButtons = (...args) => callWithFallback("sendMessageWithButtons", args);
export const sendHTML = (...args) => callWithFallback("sendHTML", args);
export const editMessage = (...args) => callWithFallback("editMessage", args);
export const editMessageWithButtons = (...args) => callWithFallback("editMessageWithButtons", args);
export const answerCallbackQuery = (...args) => callWithFallback("answerCallbackQuery", args);
export const createLiveMessage = (...args) => callWithFallback("createLiveMessage", args);
export const notifyDeploy = (...args) => callWithFallback("notifyDeploy", args);
export const notifyClose = (...args) => callWithFallback("notifyClose", args);
export const notifySwap = (...args) => callWithFallback("notifySwap", args);
export const notifyOutOfRange = (...args) => callWithFallback("notifyOutOfRange", args);
