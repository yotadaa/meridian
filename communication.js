import * as telegram from "./telegram.js";
import * as whatsapp from "./whatsapp.js";

function preferred() {
  return whatsapp.isEnabled() ? whatsapp : telegram;
}

function fallback(channel) {
  return channel === whatsapp ? telegram : null;
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
