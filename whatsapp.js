import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "user-config.json");

let client = null;
let initializing = null;
let ready = false;
let polling = false;
let targetChatId = process.env.WHATSAPP_CHAT_ID || null;
let liveDepth = 0;
let disabledUntil = 0;
const processedMessageIds = new Set();
const recentOutboundBodies = new Map();

function rememberOutbound(body) {
  const key = String(body || "").slice(0, 4096);
  recentOutboundBodies.set(key, Date.now());
  if (recentOutboundBodies.size > 100) {
    const cutoff = Date.now() - 60_000;
    for (const [text, at] of recentOutboundBodies) {
      if (at < cutoff) recentOutboundBodies.delete(text);
    }
  }
}

function isRecentOutbound(body) {
  const key = String(body || "").slice(0, 4096);
  const at = recentOutboundBodies.get(key);
  if (!at) return false;
  if (Date.now() - at > 60_000) {
    recentOutboundBodies.delete(key);
    return false;
  }
  return true;
}

function loadConfig() {
  try {
    if (!fs.existsSync(USER_CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
  } catch (error) {
    log("whatsapp_warn", `Invalid user-config.json: ${error.message}`);
    return {};
  }
}

function saveChatId(id) {
  try {
    const cfg = loadConfig();
    cfg.whatsappChatId = id;
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (error) {
    log("whatsapp_error", `Failed to persist chat id: ${error.message}`);
  }
}

const cfg = loadConfig();
targetChatId ||= cfg.whatsappChatId || null;

export function isEnabled() {
  const fresh = loadConfig();
  return (fresh.preferredChannel || process.env.PREFERRED_CHANNEL || "telegram") === "whatsapp" && Date.now() >= disabledUntil;
}

export function hasActiveLiveMessage() {
  return liveDepth > 0;
}

async function ensureClient() {
  if (client) return client;
  if (initializing) return initializing;
  initializing = initializeClient().finally(() => { initializing = null; });
  return initializing;
}

function disableTemporarily(reason) {
  ready = false;
  client = null;
  disabledUntil = Date.now() + Number(process.env.WHATSAPP_BACKOFF_MS || 5 * 60_000);
  log("whatsapp_warn", `${reason}. WhatsApp disabled for ${Math.round((disabledUntil - Date.now()) / 1000)}s; Telegram fallback may be used if configured.`);
}

async function initializeClient() {
  const [whatsappWeb] = await Promise.all([
    import("whatsapp-web.js"),
  ]);
  const { Client, LocalAuth } = whatsappWeb.default || whatsappWeb;
  client = new Client({
    authStrategy: new LocalAuth({ clientId: "meridian" }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });
  client.on("ready", () => {
    ready = true;
    const wid = client.info?.wid?._serialized || client.info?.wid?.user || "unknown";
    log("whatsapp", `Client ready as ${wid}. Send commands from another WhatsApp account/chat to this account.`);
  });
  client.on("disconnected", (reason) => { ready = false; log("whatsapp_warn", `Disconnected: ${reason}`); client = null; });
  client.on("auth_failure", (message) => disableTemporarily(`Auth failure: ${message}`));
  try {
    await client.initialize();
  } catch (error) {
    disableTemporarily(`Failed to initialize: ${error.message}`);
    throw error;
  }
  return client;
}

export async function sendMessage(text) {
  if (!isEnabled()) return null;
  if (!targetChatId) return null;
  let c;
  try {
    c = await ensureClient();
  } catch {
    return null;
  }
  if (!ready) return null;
  const body = String(text).slice(0, 4096);
  rememberOutbound(body);
  try {
    return await c.sendMessage(targetChatId, body);
  } catch (error) {
    disableTemporarily(`sendMessage failed: ${error.message}`);
    return null;
  }
}

export async function sendHTML(html) {
  return sendMessage(String(html).replace(/<[^>]*>/g, ""));
}

export async function sendMessageWithButtons(text) {
  return sendMessage(text);
}

export async function editMessage(text) {
  return sendMessage(text);
}

export async function editMessageWithButtons(text) {
  return sendMessage(text);
}

export async function answerCallbackQuery() { return null; }

export async function createLiveMessage(title, intro = "Starting...") {
  if (!isEnabled()) return null;
  liveDepth += 1;
  const state = { title, intro, toolLines: [], footer: "" };
  const render = () => [state.title, state.intro, state.toolLines.join("\n"), state.footer].filter(Boolean).join("\n\n").slice(0, 4096);
  await sendMessage(render());
  return {
    async toolStart(name) { state.toolLines.push(`ℹ️ ${name.replace(/_/g, " ")} ...`); await sendMessage(render()); },
    async toolFinish(name, result, success) { state.toolLines.push(`${success ? "✅" : "❌"} ${name.replace(/_/g, " ")}`); await sendMessage(render()); },
    async note(text) { state.intro = text; await sendMessage(render()); },
    async finalize(text) { state.footer = text; await sendMessage(render()); liveDepth = Math.max(0, liveDepth - 1); },
    async fail(text) { state.footer = `❌ ${text}`; await sendMessage(render()); liveDepth = Math.max(0, liveDepth - 1); },
  };
}

export function startPolling(onMessage) {
  if (!isEnabled() || polling) return;
  polling = true;
  ensureClient().then((c) => {
    async function handleMessage(message, source) {
      if (!message.body) return;
      // whatsapp-web.js emits our own sent messages through message_create.
      // Never treat messages from the linked/bot account as control input;
      // commands must arrive from another WhatsApp account/chat.
      if (message.fromMe) return;
      if (isRecentOutbound(message.body)) return;
      const messageId = message.id?._serialized || message.id?.id || `${source}:${message.from}:${message.timestamp}:${message.body}`;
      if (processedMessageIds.has(messageId)) return;
      processedMessageIds.add(messageId);
      if (processedMessageIds.size > 500) processedMessageIds.clear();

      const chatId = message.from;
      if (!chatId || chatId === "status@broadcast") return;
      log("whatsapp", `Incoming (${source}) from ${chatId}: ${String(message.body).slice(0, 80)}`);

      if (!targetChatId) {
        targetChatId = chatId;
        saveChatId(targetChatId);
        await c.sendMessage(chatId, "✅ Meridian WhatsApp chat linked. Send /help for commands.");
      }
      if (chatId !== targetChatId) return;
      await onMessage({ text: message.body, chat: { id: chatId, type: "private" }, from: { id: chatId } });
    }

    c.on("message", (message) => handleMessage(message, "message").catch((error) => log("whatsapp_error", error.message)));
    c.on("message_create", (message) => handleMessage(message, "message_create").catch((error) => log("whatsapp_error", error.message)));
    log("whatsapp", "Message listeners started");
  }).catch((error) => {
    polling = false;
    disableTemporarily(`Failed to start: ${error.message}`);
  });
}

export function stopPolling() { polling = false; }

export async function notifyDeploy(args) {
  if (hasActiveLiveMessage()) return;
  await sendMessage(`✅ Deployed ${args.pair}\nAmount: ${args.amountSol} SOL\nPosition: ${args.position?.slice(0, 8)}...\nTx: ${args.tx?.slice(0, 16)}...`);
}
export async function notifyClose({ pair, pnlUsd, pnlPct }) {
  if (hasActiveLiveMessage()) return;
  const sign = pnlUsd >= 0 ? "+" : "";
  await sendMessage(`🔒 Closed ${pair}\nPnL: ${sign}$${(pnlUsd ?? 0).toFixed(2)} (${sign}${(pnlPct ?? 0).toFixed(2)}%)`);
}
export async function notifySwap({ inputSymbol, outputSymbol, amountIn, amountOut, tx }) {
  if (hasActiveLiveMessage()) return;
  await sendMessage(`🔄 Swapped ${inputSymbol} → ${outputSymbol}\nIn: ${amountIn ?? "?"} | Out: ${amountOut ?? "?"}\nTx: ${tx?.slice(0, 16)}...`);
}
export async function notifyOutOfRange({ pair, minutesOOR }) {
  if (hasActiveLiveMessage()) return;
  await sendMessage(`⚠️ Out of Range ${pair}\nBeen OOR for ${minutesOOR} minutes`);
}
